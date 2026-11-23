/**
 * Silence-aware audio segmentation for memory-safe, chunk-by-chunk Whisper transcription.
 * Cutting at natural speech pauses avoids splitting words across chunk boundaries,
 * eliminates overlapping-window double computation, keeps peak memory constant O(1)
 * regardless of recording length, and provides accurate progress updates per segment.
 */

export const WHISPER_SAMPLE_RATE = 16000;

export interface AudioSegment {
  startSample: number;
  endSample: number;
  startSec: number;
  endSec: number;
  isSilent: boolean;
}

export interface AudioChunkOptions {
  sampleRate?: number;
  /** Preferred chunk length in seconds (must stay <= 29s for a single Whisper 30s window). */
  targetSegmentSec?: number;
  /** Earliest offset within a chunk to search for a silence pause. */
  minSegmentSec?: number;
  /** Maximum chunk length in seconds (clamped to <= 29s). */
  maxSegmentSec?: number;
  /** RMS threshold below which a segment is considered pure silence. */
  silenceRmsThreshold?: number;
}

export interface TimedUtterance {
  startSec: number;
  endSec: number;
  text: string;
}

function computeWindowRms(audio: Float32Array, start: number, end: number): number {
  const s = Math.max(0, start);
  const e = Math.min(audio.length, end);
  const count = e - s;
  if (count <= 0) return 0;

  let sumSq = 0;
  for (let i = s; i < e; i++) {
    const v = audio[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / count);
}

function isSegmentSilent(
  audio: Float32Array,
  start: number,
  end: number,
  rmsThreshold: number
): boolean {
  const s = Math.max(0, start);
  const e = Math.min(audio.length, end);
  const count = e - s;
  if (count <= 0) return true;

  let sumSq = 0;
  let peak = 0;
  // Stride by 2 samples for fast scanning on long audio with negligible precision loss
  let sampled = 0;
  for (let i = s; i < e; i += 2) {
    const v = audio[i];
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSq += v * v;
    sampled++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, sampled));
  return rms < rmsThreshold && peak < rmsThreshold * 3.5;
}

/**
 * Split a 16 kHz mono Float32Array into Whisper-sized segments (<= 29s each),
 * placing split points at the quietest pause near `targetSegmentSec`.
 */
export function splitAudioIntoSegments(
  audio: Float32Array,
  options: AudioChunkOptions = {}
): AudioSegment[] {
  const sr = options.sampleRate ?? WHISPER_SAMPLE_RATE;
  if (audio.length === 0) return [];

  const maxSegmentSec = Math.min(29, Math.max(10, options.maxSegmentSec ?? 25));
  const targetSegmentSec = Math.min(maxSegmentSec - 1, Math.max(8, options.targetSegmentSec ?? 20));
  const minSegmentSec = Math.min(targetSegmentSec - 2, Math.max(5, options.minSegmentSec ?? 12));
  const silenceRmsThreshold = options.silenceRmsThreshold ?? 0.006;

  const maxSamples = Math.floor(maxSegmentSec * sr);
  const targetSamples = Math.floor(targetSegmentSec * sr);
  const minSamples = Math.floor(minSegmentSec * sr);

  if (audio.length <= maxSamples) {
    return [
      {
        startSample: 0,
        endSample: audio.length,
        startSec: 0,
        endSec: audio.length / sr,
        isSilent: isSegmentSilent(audio, 0, audio.length, silenceRmsThreshold),
      },
    ];
  }

  const windowSamples = Math.floor(0.12 * sr); // 120 ms energy probe window
  const stepSamples = Math.floor(0.04 * sr); // 40 ms step
  const pauseRmsCeiling = 0.025;

  const segments: AudioSegment[] = [];
  let cursor = 0;

  while (cursor < audio.length) {
    const remaining = audio.length - cursor;
    if (remaining <= maxSamples) {
      segments.push({
        startSample: cursor,
        endSample: audio.length,
        startSec: cursor / sr,
        endSec: audio.length / sr,
        isSilent: isSegmentSilent(audio, cursor, audio.length, silenceRmsThreshold),
      });
      break;
    }

    const searchStart = cursor + minSamples;
    const searchEnd = Math.min(audio.length - windowSamples, cursor + maxSamples);
    const idealCut = cursor + targetSamples;

    let bestCut = idealCut;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let pos = searchStart; pos <= searchEnd; pos += stepSamples) {
      const rms = computeWindowRms(audio, pos, pos + windowSamples);
      const midpoint = pos + Math.floor(windowSamples / 2);
      const distPenalty = Math.abs(midpoint - idealCut) / (maxSamples - minSamples);

      // Strongly prefer genuine pauses (RMS below pauseRmsCeiling) near idealCut;
      // otherwise pick the lowest-energy dip between words.
      const effectiveRms = rms <= pauseRmsCeiling ? rms * 0.4 : rms;
      const score = effectiveRms + distPenalty * 0.012;

      if (score < bestScore) {
        bestScore = score;
        bestCut = midpoint;
      }
    }

    const endSample = Math.max(cursor + minSamples, Math.min(audio.length, bestCut));
    segments.push({
      startSample: cursor,
      endSample,
      startSec: cursor / sr,
      endSec: endSample / sr,
      isSilent: isSegmentSilent(audio, cursor, endSample, silenceRmsThreshold),
    });
    cursor = endSample;
  }

  return segments;
}

/**
 * Clean a Whisper chunk string and split multi-sentence chunks into individual
 * SALT utterance segments with proportionally interpolated start/end timestamps.
 */
export function splitChunkIntoUtterances(
  rawText: string,
  startSec: number,
  endSec: number
): TimedUtterance[] {
  const cleaned = rawText.replace(/\.\.\./g, '').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // Filter out common Whisper bracketed non-speech artifacts like [BLANK_AUDIO] or (music)
  if (/^\[(?:blank_audio|silence|music|inaudible|no_speech)\]$/i.test(cleaned)) {
    return [];
  }

  const sentences = cleaned
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [];
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 0.4, endSec);

  if (sentences.length === 1) {
    return [{ startSec: safeStart, endSec: safeEnd, text: sentences[0] }];
  }

  const totalChars = sentences.reduce((sum, s) => sum + Math.max(1, s.length), 0);
  const span = safeEnd - safeStart;
  const results: TimedUtterance[] = [];
  let offset = 0;

  for (const sentence of sentences) {
    const frac = Math.max(1, sentence.length) / totalChars;
    const uttStart = safeStart + offset * span;
    offset += frac;
    const uttEnd = Math.max(uttStart + 0.35, safeStart + offset * span);
    results.push({
      startSec: uttStart,
      endSec: Math.min(safeEnd, uttEnd),
      text: sentence,
    });
  }

  return results;
}
