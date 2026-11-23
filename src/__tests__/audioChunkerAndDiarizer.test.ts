import { afterEach, describe, expect, it } from 'vitest';
import {
  splitAudioIntoSegments,
  splitChunkIntoUtterances,
  WHISPER_SAMPLE_RATE,
  type TimedUtterance,
} from '../lib/audio/audioChunker';
import {
  autoAssignSpeakersInTranscript,
  diarizeSpeakerSegments,
  formatDiarizedTranscript,
} from '../lib/audio/speakerDiarizer';
import { resolveSafeWhisperModel } from '../lib/storage/sessionStore';

/**
 * Synthesize a realistic harmonic voice signal with specified F0 (fundamental frequency)
 * and formant spectral emphasis into a slice of a 16 kHz mono PCM buffer.
 */
function writeSyntheticVoice(
  buffer: Float32Array,
  startSec: number,
  endSec: number,
  f0Hz: number,
  formantPeakHz: number,
  amplitude = 0.55
): void {
  const sr = WHISPER_SAMPLE_RATE;
  const start = Math.max(0, Math.floor(startSec * sr));
  const end = Math.min(buffer.length, Math.floor(endSec * sr));
  const maxHarmonics = Math.min(18, Math.floor(7000 / f0Hz));

  for (let i = start; i < end; i++) {
    const t = i / sr;
    let sum = 0;
    let norm = 0;
    for (let h = 1; h <= maxHarmonics; h++) {
      const freq = f0Hz * h;
      // Gaussian formant resonance envelope around formantPeakHz + gentle spectral roll-off
      const dist = (freq - formantPeakHz) / 550;
      const weight = (1 / Math.pow(h, 0.75)) * (0.35 + Math.exp(-0.5 * dist * dist));
      sum += weight * Math.sin(2 * Math.PI * freq * t);
      norm += weight;
    }
    buffer[i] = (sum / Math.max(1e-6, norm)) * amplitude;
  }
}

describe('Silence-aware audio chunking for memory-safe Whisper transcription', () => {
  it('keeps short recordings in a single segment', () => {
    const audio = new Float32Array(12 * WHISPER_SAMPLE_RATE);
    writeSyntheticVoice(audio, 0.5, 11.5, 220, 1200);
    const segments = splitAudioIntoSegments(audio, {
      targetSegmentSec: 16,
      minSegmentSec: 10,
      maxSegmentSec: 20,
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].startSec).toBe(0);
    expect(segments[0].endSec).toBeCloseTo(12, 2);
    expect(segments[0].isSilent).toBe(false);
  });

  it('cuts long audio at natural silence pauses instead of mid-utterance', () => {
    const totalSec = 36;
    const audio = new Float32Array(totalSec * WHISPER_SAMPLE_RATE);
    // Speech from 0..15.0s, silence gap 15.0..16.2s, speech from 16.2..35.0s
    writeSyntheticVoice(audio, 0.2, 15.0, 260, 1600);
    writeSyntheticVoice(audio, 16.2, 35.0, 260, 1600);

    const segments = splitAudioIntoSegments(audio, {
      targetSegmentSec: 16,
      minSegmentSec: 10,
      maxSegmentSec: 20,
    });

    expect(segments.length).toBeGreaterThanOrEqual(2);
    // First split must land inside the 15.0..16.2s silence gap!
    expect(segments[0].endSec).toBeGreaterThanOrEqual(14.9);
    expect(segments[0].endSec).toBeLessThanOrEqual(16.3);
    for (const seg of segments) {
      expect(seg.endSec - seg.startSec).toBeLessThanOrEqual(20.1);
    }
  });

  it('flags dead-air segments as silent', () => {
    const audio = new Float32Array(10 * WHISPER_SAMPLE_RATE);
    const segments = splitAudioIntoSegments(audio);
    expect(segments).toHaveLength(1);
    expect(segments[0].isSilent).toBe(true);
  });

  it('splits multi-sentence Whisper chunks with proportionally interpolated timestamps and drops artifacts', () => {
    const utts = splitChunkIntoUtterances(
      'Tell me what happened. The dog ran outside! Did he come back?',
      10,
      19
    );
    expect(utts).toHaveLength(3);
    expect(utts[0].startSec).toBeCloseTo(10, 2);
    expect(utts[1].startSec).toBeGreaterThan(utts[0].startSec);
    expect(utts[2].startSec).toBeGreaterThan(utts[1].startSec);
    expect(utts[2].endSec).toBeCloseTo(19, 2);

    expect(splitChunkIntoUtterances('[BLANK_AUDIO]', 0, 5)).toHaveLength(0);
  });
});

describe('On-device automatic speaker diarization (Child vs Examiner)', () => {
  it('separates Child (higher pitch/formants) and Adult Male Examiner accurately', () => {
    const totalSec = 20;
    const audio = new Float32Array(totalSec * WHISPER_SAMPLE_RATE);

    // Examiner (adult male: 125 Hz, lower formants) asks prompts
    writeSyntheticVoice(audio, 0.2, 3.2, 125, 950);
    // Child (young child: 315 Hz, higher formants) tells the story
    writeSyntheticVoice(audio, 3.6, 7.6, 315, 2200);
    writeSyntheticVoice(audio, 8.0, 11.4, 305, 2150);
    // Examiner follow-up
    writeSyntheticVoice(audio, 12.0, 14.8, 130, 980);
    // Child replies
    writeSyntheticVoice(audio, 15.2, 19.2, 320, 2250);

    const segments: TimedUtterance[] = [
      { startSec: 0.2, endSec: 3.2, text: 'Tell me what happened in the story.' },
      { startSec: 3.6, endSec: 7.6, text: 'The little boy goed to the store.' },
      { startSec: 8.0, endSec: 11.4, text: 'He walk to the shelf.' },
      { startSec: 12.0, endSec: 14.8, text: 'Oh really? What did he do next?' },
      { startSec: 15.2, endSec: 19.2, text: 'The dog runned real fast outside.' },
    ];

    const result = diarizeSpeakerSegments(audio, segments);
    expect(result.speakerCount).toBe(2);
    expect(result.roles).toEqual(['speaker2', 'speaker1', 'speaker1', 'speaker2', 'speaker1']);

    const formatted = formatDiarizedTranscript(segments, result.roles, {
      speaker1: 'C',
      speaker2: 'E',
    });
    expect(formatted).toContain('[0:00] E Tell me what happened in the story.');
    expect(formatted).toContain('[0:03] C The little boy goed to the store.');
    expect(formatted).toContain('[0:12] E Oh really? What did he do next?');
  });

  it('separates Child and Adult Female Examiner using pitch + vocal-tract formant cues', () => {
    const totalSec = 16;
    const audio = new Float32Array(totalSec * WHISPER_SAMPLE_RATE);

    writeSyntheticVoice(audio, 0.2, 3.2, 195, 1200); // Female SLP
    writeSyntheticVoice(audio, 3.6, 7.2, 320, 2400); // Child
    writeSyntheticVoice(audio, 7.8, 10.6, 200, 1250); // Female SLP
    writeSyntheticVoice(audio, 11.2, 15.2, 310, 2350); // Child

    const segments: TimedUtterance[] = [
      { startSec: 0.2, endSec: 3.2, text: 'What happened next?' },
      { startSec: 3.6, endSec: 7.2, text: 'They played with the puppy.' },
      { startSec: 7.8, endSec: 10.6, text: 'Good job, tell me more.' },
      { startSec: 11.2, endSec: 15.2, text: 'And then the puppy jumped in the pool.' },
    ];

    const result = diarizeSpeakerSegments(audio, segments);
    expect(result.speakerCount).toBe(2);
    expect(result.roles).toEqual(['speaker2', 'speaker1', 'speaker2', 'speaker1']);
  });

  it('recognizes a single-speaker monologue and assigns Speaker 1 consistently', () => {
    const totalSec = 12;
    const audio = new Float32Array(totalSec * WHISPER_SAMPLE_RATE);
    writeSyntheticVoice(audio, 0.2, 3.8, 285, 1900);
    writeSyntheticVoice(audio, 4.2, 7.8, 290, 1920);
    writeSyntheticVoice(audio, 8.2, 11.6, 280, 1880);

    const segments: TimedUtterance[] = [
      { startSec: 0.2, endSec: 3.8, text: 'The boy found a frog by the pond.' },
      { startSec: 4.2, endSec: 7.8, text: 'He put the frog inside a big jar.' },
      { startSec: 8.2, endSec: 11.6, text: 'The frog hopped out at night.' },
    ];

    const result = diarizeSpeakerSegments(audio, segments);
    expect(result.speakerCount).toBe(1);
    expect(result.roles).toEqual(['speaker1', 'speaker1', 'speaker1']);
  });

  it('auto-assigns speakers from text alone when no audio is attached', () => {
    const unlabeled = [
      '[0:00] Tell me what happened in the story?',
      '[0:04] The boy goed to the park.',
      '[0:09] He played on the swings.',
      '[0:14] What did he do next?',
      '[0:18] He went home for dinner.',
    ].join('\n');

    const res = autoAssignSpeakersInTranscript(unlabeled, { speaker1: 'C', speaker2: 'E' });
    expect(res.method).toBe('text');
    expect(res.speakerCount).toBe(2);
    expect(res.transcript).toBe(
      [
        '[0:00] E Tell me what happened in the story?',
        '[0:04] C The boy goed to the park.',
        '[0:09] C He played on the swings.',
        '[0:14] E What did he do next?',
        '[0:18] C He went home for dinner.',
      ].join('\n')
    );
  });
});

describe('iPad memory-safe Whisper model selection', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  it('routes 240 MB Whisper Small to memory-safe Distil-Small on iPadOS Safari', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      },
      configurable: true,
    });

    expect(resolveSafeWhisperModel('Xenova/whisper-small.en')).toBe(
      'onnx-community/distil-small.en'
    );
    expect(resolveSafeWhisperModel('Xenova/whisper-base.en')).toBe('Xenova/whisper-base.en');
  });

  it('preserves full Whisper Small on desktop browsers', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0',
        platform: 'Win32',
        maxTouchPoints: 0,
      },
      configurable: true,
    });

    expect(resolveSafeWhisperModel('Xenova/whisper-small.en')).toBe('Xenova/whisper-small.en');
  });
});

