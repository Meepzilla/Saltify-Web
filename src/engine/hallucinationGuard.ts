/**
 * Guards against Whisper's best-known failure modes:
 *  - repetition loops ("What? What? What? …" once per second, or "the the the the …"), and
 *  - text produced over silence / room noise.
 * Pure functions so they are unit-testable.
 */

export interface TimedChunk {
  timestamp: [number, number | null];
  text: string;
}

export function normalizeChunkText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Runs (inclusive index ranges) of at least `minRun` consecutive chunks with the same text. */
export function findRepeatedRuns(chunks: TimedChunk[], minRun = 3): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= chunks.length; i++) {
    const same =
      i < chunks.length &&
      normalizeChunkText(chunks[i].text) !== '' &&
      normalizeChunkText(chunks[i].text) === normalizeChunkText(chunks[start].text);
    if (!same) {
      if (i - start >= minRun && normalizeChunkText(chunks[start].text) !== '') runs.push([start, i - 1]);
      start = i;
    }
  }
  return runs;
}

/** Collapses a phrase of 1–4 words repeated 4+ times in a row inside one text ("no no no no no"). */
export function collapseRepeatedPhrase(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return text;
  const norm = words.map((w) => normalizeChunkText(w));
  for (let size = 1; size <= 4; size++) {
    for (let i = 0; i + size * 4 <= words.length; i++) {
      let reps = 1;
      while (
        i + (reps + 1) * size <= words.length &&
        norm.slice(i, i + size).join(' ') === norm.slice(i + reps * size, i + (reps + 1) * size).join(' ')
      ) {
        reps++;
      }
      if (reps >= 4) {
        const kept = [...words.slice(0, i + size), ...words.slice(i + reps * size)];
        return collapseRepeatedPhrase(kept.join(' '));
      }
    }
  }
  return text;
}

/** True when a segment's output looks like a repetition loop. */
export function looksLikeRepetitionLoop(chunks: TimedChunk[]): boolean {
  if (findRepeatedRuns(chunks).length > 0) return true;
  const words = chunks.flatMap((c) => normalizeChunkText(c.text).split(' ').filter(Boolean));
  if (words.length >= 12 && new Set(words).size / words.length < 0.25) return true;
  return chunks.some((c) => collapseRepeatedPhrase(c.text) !== c.text);
}

/**
 * Keeps one chunk of each run of 3+ identical chunks (real speakers do not say the same
 * phrase on every second for 15 seconds) and collapses in-chunk phrase loops.
 */
export function collapseRepetitions(chunks: TimedChunk[]): TimedChunk[] {
  const runs = findRepeatedRuns(chunks);
  const drop = new Set<number>();
  for (const [a, b] of runs) for (let i = a + 1; i <= b; i++) drop.add(i);
  return chunks
    .filter((_, i) => !drop.has(i))
    .map((c) => {
      const text = collapseRepeatedPhrase(c.text);
      return text === c.text ? c : { ...c, text: c.text.startsWith(' ') ? ` ${text}` : text };
    });
}

/** RMS per 20 ms frame. */
export function frameRms(samples: Float32Array, sampleRate = 16000, frameSec = 0.02): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * frameSec));
  const frames = Math.floor(samples.length / size);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
    out[f] = Math.sqrt(sum / size);
  }
  return out;
}

/**
 * Drops chunks whose audio is essentially silent: their loudest 20 ms frame is below
 * `ratio` (default 6%, about −24 dB) of the recording's speech level (95th-percentile frame).
 * Quiet speech stays well above this; Whisper's text over silence does not.
 */
export function dropSilentChunks(
  chunks: TimedChunk[],
  samples: Float32Array,
  sampleRate = 16000,
  ratio = 0.06
): TimedChunk[] {
  const rms = frameRms(samples, sampleRate);
  if (rms.length === 0) return chunks;
  const sorted = Float32Array.from(rms).sort();
  const speechLevel = sorted[Math.floor(sorted.length * 0.95)];
  if (!(speechLevel > 0)) return chunks;
  const frameSec = 0.02;
  return chunks.filter((c) => {
    const start = Math.max(0, Math.floor(c.timestamp[0] / frameSec));
    const endSec = c.timestamp[1] ?? c.timestamp[0] + 2;
    const end = Math.min(rms.length, Math.max(start + 1, Math.ceil(endSec / frameSec)));
    if (start >= rms.length) return true; // no audio to judge; keep
    let peak = 0;
    for (let f = start; f < end; f++) if (rms[f] > peak) peak = rms[f];
    return peak >= speechLevel * ratio;
  });
}

/**
 * Whisper's best-known invented phrases: produced over background noise, movement or silence
 * (trained on subtitled video). Matched against whole utterances only.
 */
const STOCK_PHRASES = new Set([
  'thank you',
  'thank you so much',
  'thank you very much',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thanks for listening',
  'thank you for listening',
  'please subscribe',
  'subscribe',
  'bye',
  'bye bye',
  'you',
]);

export interface TimedUtterance {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Removes likely invented utterances:
 *  - a stock phrase ("Thank you.") that stands alone 3+ times in the sample, or once over audio
 *    too quiet to be clear speech (loudest 20 ms frame under 25% of the recording's speech level);
 *  - an exact repeat of the previous utterance starting within 2 s of it (the same words cannot
 *    be spoken twice at the same moment; this comes from overlapping chunk boundaries).
 */
export function dropInventedUtterances<T extends TimedUtterance>(
  utterances: T[],
  samples?: Float32Array,
  sampleRate = 16000
): T[] {
  const counts = new Map<string, number>();
  for (const u of utterances) {
    const n = normalizeChunkText(u.text);
    if (STOCK_PHRASES.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let rms: Float32Array | null = null;
  let speechLevel = 0;
  if (samples && samples.length > 0) {
    rms = frameRms(samples, sampleRate);
    const sorted = Float32Array.from(rms).sort();
    speechLevel = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }
  const quiet = (u: T) => {
    if (!rms || !(speechLevel > 0)) return false;
    const a = Math.max(0, Math.floor(u.startSec / 0.02));
    const b = Math.min(rms.length, Math.max(a + 1, Math.ceil(u.endSec / 0.02)));
    let peak = 0;
    for (let f = a; f < b; f++) if (rms[f] > peak) peak = rms[f];
    return peak < speechLevel * 0.25;
  };
  const out: T[] = [];
  for (const u of utterances) {
    const n = normalizeChunkText(u.text);
    if (STOCK_PHRASES.has(n) && ((counts.get(n) ?? 0) >= 3 || quiet(u))) continue;
    const prev = out[out.length - 1];
    if (prev && n !== '' && normalizeChunkText(prev.text) === n && u.startSec - prev.startSec < 2) continue;
    out.push(u);
  }
  return out;
}
