/**
 * Cuts a live 16 kHz audio stream into segments for transcription while recording.
 *
 * A segment is released at a natural pause: once enough speech has built up (or the speaker has
 * stopped talking for a moment), it is cut in the middle of the last clear gap, so no word is
 * split. Pure and synchronous so it can be unit-tested.
 */
import { detectSpeechRegions } from './speechChunking';

export interface LiveSegment {
  /** Start of the segment in the recording (seconds). */
  startSec: number;
  samples: Float32Array;
}

export interface LiveSegmenterOptions {
  sampleRate?: number;
  /** Cut at the last pause once this much audio is pending (seconds). */
  targetSec?: number;
  /** Never let a segment grow past this (seconds); cut at the quietest point if no pause. */
  maxSec?: number;
  /** Release early when the speaker has been quiet this long (seconds)… */
  idleSec?: number;
  /** …and at least this much audio is pending (seconds). */
  minIdleSegmentSec?: number;
  /** Minimum gap between (padded) speech regions that counts as a pause; 0.3 s ≈ a 0.8 s real pause. */
  minGapSec?: number;
}

export class LiveSegmenter {
  private readonly rate: number;
  private readonly opts: Required<Omit<LiveSegmenterOptions, 'sampleRate'>>;
  private chunks: Float32Array[] = [];
  private total = 0; // samples received
  private cut = 0; // samples already released

  constructor(options: LiveSegmenterOptions = {}) {
    this.rate = options.sampleRate ?? 16000;
    this.opts = {
      targetSec: options.targetSec ?? 24,
      maxSec: options.maxSec ?? 40,
      idleSec: options.idleSec ?? 2.5,
      minIdleSegmentSec: options.minIdleSegmentSec ?? 8,
      minGapSec: options.minGapSec ?? 0.3,
    };
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.total += samples.length;
  }

  /** Seconds received so far. */
  get durationSec(): number {
    return this.total / this.rate;
  }

  /** The whole recording so far (for speaker labeling at the end). */
  allAudio(): Float32Array {
    const out = new Float32Array(this.total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.chunks = [out];
    return out;
  }

  /**
   * The next segment ready for transcription, or null. With `final`, everything not yet
   * released is returned (when recording stops).
   */
  next(final = false): LiveSegment | null {
    const pendingLen = this.total - this.cut;
    if (pendingLen <= 0) return null;
    const pendingSec = pendingLen / this.rate;
    if (final) return this.release(this.total);
    if (pendingSec < Math.min(this.opts.minIdleSegmentSec, this.opts.targetSec)) return null;

    const pending = this.slice(this.cut, this.total);
    const regions = detectSpeechRegions(pending, this.rate);
    if (regions.length === 0) {
      // Nothing but silence/noise for a long time: release it so memory and latency stay bounded
      return pendingSec >= this.opts.maxSec ? this.release(this.total) : null;
    }

    // Speaker paused: release up to just after the last speech
    const last = regions[regions.length - 1];
    if (pendingSec - last.end >= this.opts.idleSec && pendingSec >= this.opts.minIdleSegmentSec) {
      return this.release(this.cut + Math.round(Math.min(pendingSec, last.end + 0.3) * this.rate));
    }

    if (pendingSec < this.opts.targetSec) return null;
    // Enough built up: cut in the middle of the last clear pause (not too close to the start)
    for (let k = regions.length - 1; k > 0; k--) {
      const gapStart = regions[k - 1].end;
      const gapEnd = regions[k].start;
      const mid = (gapStart + gapEnd) / 2;
      if (gapEnd - gapStart >= this.opts.minGapSec && mid >= this.opts.targetSec / 3) {
        return this.release(this.cut + Math.round(mid * this.rate));
      }
    }
    if (pendingSec >= this.opts.maxSec) {
      // No pause at all: cut at the quietest 100 ms in the last third
      const frame = Math.round(this.rate * 0.1);
      const from = Math.floor(pendingLen * 0.66);
      let best = pendingLen - frame;
      let bestE = Infinity;
      for (let p = from; p + frame <= pendingLen; p += frame) {
        let e = 0;
        for (let i = p; i < p + frame; i++) e += pending[i] * pending[i];
        if (e < bestE) {
          bestE = e;
          best = p + Math.floor(frame / 2);
        }
      }
      return this.release(this.cut + best);
    }
    return null;
  }

  private release(endSample: number): LiveSegment {
    const startSec = this.cut / this.rate;
    const samples = this.slice(this.cut, endSample);
    this.cut = endSample;
    return { startSec, samples };
  }

  private slice(a: number, b: number): Float32Array {
    const out = new Float32Array(Math.max(0, b - a));
    let pos = 0;
    let o = 0;
    for (const c of this.chunks) {
      const cs = pos;
      const ce = pos + c.length;
      pos = ce;
      if (ce <= a || cs >= b) continue;
      const from = Math.max(a, cs) - cs;
      const to = Math.min(b, ce) - cs;
      out.set(c.subarray(from, to), o);
      o += to - from;
    }
    return out;
  }
}
