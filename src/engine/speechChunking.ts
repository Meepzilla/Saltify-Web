/**
 * Speech-aware chunking for Whisper.
 *
 * Whisper pads every input to 30 s, so each chunk costs a full encoder pass no matter how
 * short it is. Speed therefore comes from not transcribing silence, not from smaller
 * chunks. This module finds the speech in a recording (energy-based voice activity
 * detection) and packs it into windows of up to ~28 s with long pauses shortened, keeping a
 * map back to the original timeline for timestamps. Long silences are also where Whisper
 * hallucinates ("Thank you.", "What? What? …"), so removing them helps accuracy too.
 */

export interface SpeechRegion {
  /** Seconds in the original recording. */
  start: number;
  end: number;
}

export interface VadOptions {
  frameSec?: number;
  /** Threshold between noise floor and speech level (0–1). */
  thresholdRatio?: number;
  /** Speech shorter than this is ignored (clicks, bumps). */
  minSpeechSec?: number;
  /** Gaps shorter than this are bridged (stops, short pauses within a word or phrase). */
  bridgeGapSec?: number;
  /** Padding kept around each region so word edges are not clipped. */
  padSec?: number;
}

/** Energy-based voice activity detection with an adaptive threshold. */
export function detectSpeechRegions(samples: Float32Array, sampleRate = 16000, opts: VadOptions = {}): SpeechRegion[] {
  const frameSec = opts.frameSec ?? 0.02;
  const thresholdRatio = opts.thresholdRatio ?? 0.1;
  const minSpeechSec = opts.minSpeechSec ?? 0.12;
  const bridgeGapSec = opts.bridgeGapSec ?? 0.35;
  const padSec = opts.padSec ?? 0.25;
  const durationSec = samples.length / sampleRate;

  const size = Math.max(1, Math.round(sampleRate * frameSec));
  const frames = Math.floor(samples.length / size);
  if (frames === 0) return [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
    db[f] = 10 * Math.log10(sum / size + 1e-10);
  }
  // Digital silence (exact zeros from noise gates, edits or generated audio) is not the room's
  // background level: estimate the noise floor from audible frames only.
  const audible = Float32Array.from(db.filter((d) => d > -80)).sort();
  if (audible.length === 0) return [];
  const sorted = audible.length >= frames * 0.1 ? audible : Float32Array.from(db).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.98)];
  // Recordings with no clear speech/noise contrast: treat everything as speech
  if (peak - floor < 6) return [{ start: 0, end: durationSec }];
  const threshold = floor + thresholdRatio * (peak - floor) + 3;

  const raw: SpeechRegion[] = [];
  let start = -1;
  for (let f = 0; f <= frames; f++) {
    const on = f < frames && db[f] >= threshold;
    if (on && start < 0) start = f;
    if (!on && start >= 0) {
      raw.push({ start: start * frameSec, end: f * frameSec });
      start = -1;
    }
  }

  // Bridge short gaps, then drop blips
  const bridged: SpeechRegion[] = [];
  for (const r of raw) {
    const last = bridged[bridged.length - 1];
    if (last && r.start - last.end <= bridgeGapSec) last.end = r.end;
    else bridged.push({ ...r });
  }
  const kept = bridged.filter((r) => r.end - r.start >= minSpeechSec);

  // Pad and merge overlaps
  const out: SpeechRegion[] = [];
  for (const r of kept) {
    const padded = { start: Math.max(0, r.start - padSec), end: Math.min(durationSec, r.end + padSec) };
    const last = out[out.length - 1];
    if (last && padded.start <= last.end) last.end = Math.max(last.end, padded.end);
    else out.push(padded);
  }
  return out;
}

export interface PackedPiece {
  /** Original-recording seconds. */
  srcStart: number;
  srcEnd: number;
  /** Seconds within the packed window where this piece starts. */
  packedStart: number;
}

export interface PackedWindow {
  samples: Float32Array;
  pieces: PackedPiece[];
  /** Original-recording span covered (for progress / display). */
  startSec: number;
  endSec: number;
}

/**
 * Packs speech regions into windows of at most `maxSec`, joining regions with a short
 * silence (`gapSec`) so Whisper still hears an utterance boundary. A region longer than
 * `maxSec` is split at its quietest point.
 */
export function packSpeechWindows(
  samples: Float32Array,
  regions: SpeechRegion[],
  sampleRate = 16000,
  maxSec = 28,
  gapSec = 0.4,
  /** Fill joins with background noise at the recording's noise floor (instead of digital silence). */
  noiseFill = true
): PackedWindow[] {
  let floorRms = 0;
  if (noiseFill) {
    const size = Math.round(sampleRate * 0.02);
    const rms: number[] = [];
    for (let i = 0; i + size <= samples.length; i += size) {
      let e = 0;
      for (let j = i; j < i + size; j++) e += samples[j] * samples[j];
      rms.push(Math.sqrt(e / size));
    }
    rms.sort((a, b) => a - b);
    floorRms = rms[Math.floor(rms.length * 0.1)] ?? 0;
  }
  let seed = 12345;
  const gauss = () => {
    seed = (seed * 16807) % 2147483647;
    const u = seed / 2147483647;
    seed = (seed * 16807) % 2147483647;
    const v = seed / 2147483647;
    return Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
  };
  // Split over-long regions at their quietest 100 ms (searching the middle third onwards)
  const pieces: SpeechRegion[] = [];
  const queue = [...regions];
  while (queue.length) {
    const r = queue.shift()!;
    if (r.end - r.start <= maxSec) {
      pieces.push(r);
      continue;
    }
    const frame = Math.round(sampleRate * 0.1);
    const from = Math.round((r.start + (maxSec * 2) / 3) * sampleRate);
    const to = Math.round((r.start + maxSec) * sampleRate);
    let best = to;
    let bestE = Infinity;
    for (let p = from; p + frame <= to; p += frame) {
      let e = 0;
      for (let i = p; i < p + frame; i++) e += samples[i] * samples[i];
      if (e < bestE) {
        bestE = e;
        best = p + Math.floor(frame / 2);
      }
    }
    const cut = best / sampleRate;
    pieces.push({ start: r.start, end: cut });
    queue.unshift({ start: cut, end: r.end });
  }

  const windows: PackedWindow[] = [];
  let current: SpeechRegion[] = [];
  let length = 0;
  const flush = () => {
    if (current.length === 0) return;
    const gap = Math.round(gapSec * sampleRate);
    const total =
      current.reduce((n, r) => n + Math.round(r.end * sampleRate) - Math.round(r.start * sampleRate), 0) +
      gap * (current.length - 1);
    const buf = new Float32Array(total);
    const packedPieces: PackedPiece[] = [];
    let offset = 0;
    current.forEach((r, k) => {
      if (k > 0) {
        if (floorRms > 0) for (let i = offset; i < offset + gap; i++) buf[i] = gauss() * floorRms;
        offset += gap;
      }
      const a = Math.round(r.start * sampleRate);
      const b = Math.round(r.end * sampleRate);
      buf.set(samples.subarray(a, b), offset);
      packedPieces.push({ srcStart: r.start, srcEnd: r.end, packedStart: offset / sampleRate });
      offset += b - a;
    });
    windows.push({ samples: buf, pieces: packedPieces, startSec: current[0].start, endSec: current[current.length - 1].end });
    current = [];
    length = 0;
  };
  for (const p of pieces) {
    const add = (current.length > 0 ? gapSec : 0) + (p.end - p.start);
    if (length + add > maxSec) flush();
    current.push(p);
    length += (current.length > 1 ? gapSec : 0) + (p.end - p.start);
  }
  flush();
  return windows;
}

/** Maps a time inside a packed window back to the original recording. */
export function packedToSourceTime(window: PackedWindow, t: number): number {
  let piece = window.pieces[0];
  for (const p of window.pieces) {
    if (p.packedStart <= t + 1e-6) piece = p;
    else break;
  }
  const offset = Math.max(0, t - piece.packedStart);
  return Math.min(piece.srcEnd, piece.srcStart + offset);
}

export interface TranscriptionSlice {
  /** Original-recording span covered. */
  startSec: number;
  endSec: number;
  samples: Float32Array;
  /** Maps a time within `samples` back to the original recording. */
  toSource: (t: number) => number;
  /** The speech regions packed into this slice. */
  pieces: PackedPiece[];
}

/**
 * Speech-packed slices for transcription: silence is skipped, long pauses are shortened, and
 * timestamps map back to the recording. Recordings without clear pauses become plain
 * contiguous windows.
 */
export function buildSpeechSlices(samples: Float32Array, sampleRate = 16000, maxSec = 28): TranscriptionSlice[] {
  const regions = detectSpeechRegions(samples, sampleRate);
  if (regions.length === 0) return [];
  return packSpeechWindows(samples, regions, sampleRate, maxSec).map((w) => ({
    startSec: w.startSec,
    endSec: w.endSec,
    samples: w.samples,
    toSource: (t: number) => packedToSourceTime(w, t),
    pieces: w.pieces,
  }));
}

/**
 * Speech pieces of a slice that no transcribed chunk overlaps (Whisper sometimes stops early
 * and silently drops the last phrase of a window). Chunk times are within the slice.
 */
export function uncoveredPieces(
  slice: Pick<TranscriptionSlice, 'pieces' | 'samples'>,
  chunks: Array<{ timestamp: [number, number | null] }>,
  sampleRate = 16000,
  minSec = 0.5
): PackedPiece[] {
  const sliceEnd = slice.samples.length / sampleRate;
  return slice.pieces.filter((p) => {
    const a = p.packedStart;
    const b = p.packedStart + (p.srcEnd - p.srcStart);
    if (b - a < minSec) return false;
    return !chunks.some((c) => {
      const s = c.timestamp[0];
      const e = c.timestamp[1] ?? sliceEnd;
      return Math.min(b, e) - Math.max(a, s) >= Math.min(0.2, (b - a) / 2);
    });
  });
}

/**
 * Chunks whose text is too short for the speech they cover (Whisper skipped part of a phrase
 * inside a segment). Returns, per suspicious chunk index, the speech pieces under it. Normal
 * speech runs ~1.5–3 words per second, even for young children; below `minWordsPerSec` over at
 * least `minSpeechSec` of detected speech, words were probably skipped.
 */
export function sparseChunks(
  slice: Pick<TranscriptionSlice, 'pieces' | 'samples'>,
  chunks: Array<{ timestamp: [number, number | null]; text: string }>,
  sampleRate = 16000,
  minWordsPerSec = 0.7,
  minSpeechSec = 2
): Array<{ index: number; pieces: PackedPiece[] }> {
  const sliceEnd = slice.samples.length / sampleRate;
  const out: Array<{ index: number; pieces: PackedPiece[] }> = [];
  chunks.forEach((c, index) => {
    const s = c.timestamp[0];
    const e = c.timestamp[1] ?? sliceEnd;
    let speech = 0;
    const under: PackedPiece[] = [];
    for (const p of slice.pieces) {
      const a = p.packedStart;
      const b = p.packedStart + (p.srcEnd - p.srcStart);
      const overlap = Math.min(b, e) - Math.max(a, s);
      if (overlap > 0.1) {
        speech += overlap;
        under.push(p);
      }
    }
    const words = c.text.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (speech >= minSpeechSec && words / speech < minWordsPerSec) out.push({ index, pieces: under });
  });
  return out;
}

const wordsOf = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether a re-checked transcription should replace the original text of a segment: it must
 * add clearly more words AND keep most of the original's words (in order), so a re-check can
 * fill in a skipped phrase but never trade good text for a different guess.
 */
export function recheckReplaces(original: string, recheck: string, minKeptShare = 0.75): boolean {
  const a = wordsOf(original);
  const b = wordsOf(recheck);
  if (b.length < a.length * 1.3 + 2) return false;
  if (a.length === 0) return true;
  // longest common subsequence length = original words kept in order
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length] / a.length >= minKeptShare;
}
