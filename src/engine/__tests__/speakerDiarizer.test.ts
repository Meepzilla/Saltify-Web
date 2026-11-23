import { describe, expect, it } from 'vitest';
import {
  autoAssignSpeakersInTranscript,
  diarizeSpeakerSegments,
  WHISPER_SAMPLE_RATE,
} from '../speakerDiarizer';
import { swapSpeakersInTranscript } from '../transcriptFormat';

function synthesizeVoice(
  f0Hz: number,
  durationSec: number,
  sampleRate = WHISPER_SAMPLE_RATE
): Float32Array {
  const len = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    out[i] =
      0.35 * Math.sin(2 * Math.PI * f0Hz * t) +
      0.22 * Math.sin(2 * Math.PI * f0Hz * 2 * t) +
      0.14 * Math.sin(2 * Math.PI * f0Hz * 3 * t) +
      0.08 * Math.sin(2 * Math.PI * f0Hz * 4 * t);
  }
  return out;
}

describe('speakerDiarizer & swapSpeakersInTranscript', () => {
  it('separates higher-pitched child voice (speaker1) from lower-pitched adult examiner (speaker2)', () => {
    const sr = WHISPER_SAMPLE_RATE;
    const adult1 = synthesizeVoice(125, 1.5, sr);
    const child1 = synthesizeVoice(290, 1.5, sr);
    const adult2 = synthesizeVoice(128, 1.5, sr);
    const child2 = synthesizeVoice(285, 1.5, sr);

    const combined = new Float32Array(adult1.length * 4);
    combined.set(adult1, 0);
    combined.set(child1, adult1.length);
    combined.set(adult2, adult1.length * 2);
    combined.set(child2, adult1.length * 3);

    const result = diarizeSpeakerSegments(
      combined,
      [
        { startSec: 0.0, endSec: 1.5, text: 'Tell me what happened next?' },
        { startSec: 1.5, endSec: 3.0, text: 'He walk to the store and telled a story.' },
        { startSec: 3.0, endSec: 4.5, text: 'Can you tell me more about the dog?' },
        { startSec: 4.5, endSec: 6.0, text: 'The dog goed home fast.' },
      ],
      sr
    );

    expect(result.speakerCount).toBe(2);
    expect(result.roles).toEqual(['speaker2', 'speaker1', 'speaker2', 'speaker1']);
  });

  it('auto-assigns speakers via text cues when audio is absent and swaps cleanly', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const raw = [
      '[0:00] Tell me what happened in the story?',
      '[0:05] He telled a funny story and goed home.',
    ].join('\n');

    const assigned = autoAssignSpeakersInTranscript(raw, aliases, null);
    expect(assigned.transcript).toContain('[0:00] E ');
    expect(assigned.transcript).toContain('[0:05] C ');

    const swapped = swapSpeakersInTranscript(assigned.transcript, aliases);
    expect(swapped).toContain('[0:00] C ');
    expect(swapped).toContain('[0:05] E ');
  });
});
