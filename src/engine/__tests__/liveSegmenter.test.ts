import { describe, expect, it } from 'vitest';
import { createStreamingDownsampler } from '../audioProcessing';
import { LiveSegmenter } from '../liveSegmenter';

const SR = 16000;
function stream(totalSec: number, bursts: Array<[number, number]>): Float32Array {
  const x = new Float32Array(totalSec * SR);
  let s = 9;
  for (let i = 0; i < x.length; i++) x[i] = (((s = (s * 16807) % 2147483647) / 2147483647) - 0.5) * 0.002;
  for (const [a, b] of bursts) for (let i = a * SR; i < b * SR; i++) x[i] += 0.3 * Math.sin(i / 7);
  return x;
}
/** Feeds audio in 85 ms chunks (like a 4096-sample buffer at 48 kHz) and collects segments. */
function feed(seg: LiveSegmenter, x: Float32Array) {
  const out: Array<{ startSec: number; durSec: number }> = [];
  for (let i = 0; i < x.length; i += 1360) {
    seg.push(x.subarray(i, Math.min(x.length, i + 1360)));
    for (let s = seg.next(); s; s = seg.next()) out.push({ startSec: s.startSec, durSec: s.samples.length / SR });
  }
  return out;
}

describe('live segmenter', () => {
  it('cuts at a pause once enough speech has built up, never inside speech', () => {
    // continuous talk with short pauses every 6 s
    const bursts: Array<[number, number]> = [];
    for (let t = 0; t < 58; t += 6) bursts.push([t + 0.2, t + 5.2]);
    const seg = new LiveSegmenter();
    const out = feed(seg, stream(60, bursts));
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const o of out) {
      const end = o.startSec + o.durSec;
      // every cut lands in a pause (5.2–6.2 s within each 6 s cycle)
      expect(end % 6 > 5.2 || end % 6 < 0.2).toBe(true);
    }
    // the rest comes out when recording stops, and nothing is lost or repeated
    const last = seg.next(true)!;
    const covered = out.reduce((n, o) => n + o.durSec, 0) + last.samples.length / SR;
    expect(covered).toBeCloseTo(60, 3);
  });

  it('releases early when the speaker stops talking', () => {
    const seg = new LiveSegmenter();
    const out = feed(seg, stream(14, [[0.5, 9]]));
    expect(out).toHaveLength(1);
    expect(out[0].startSec).toBe(0);
    expect(out[0].durSec).toBeGreaterThan(9);
    expect(out[0].durSec).toBeLessThan(10);
  });

  it('keeps the whole recording for speaker labeling', () => {
    const seg = new LiveSegmenter();
    feed(seg, stream(20, [[1, 4]]));
    expect(seg.allAudio().length).toBe(20 * SR);
  });
});

describe('streaming downsampler', () => {
  it('turns 48 kHz into 16 kHz across chunk boundaries', () => {
    const down = createStreamingDownsampler(48000, 16000);
    let n = 0;
    for (let i = 0; i < 10; i++) n += down(new Float32Array(4096).fill(0.5)).length;
    expect(Math.abs(n - (40960 / 3))).toBeLessThanOrEqual(1);
    expect(down(new Float32Array(300).fill(0.5)).every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it('handles 44.1 kHz', () => {
    const down = createStreamingDownsampler(44100, 16000);
    let n = 0;
    for (let i = 0; i < 20; i++) n += down(new Float32Array(4096)).length;
    expect(Math.abs(n - (81920 * 16000) / 44100)).toBeLessThanOrEqual(1);
  });
});
