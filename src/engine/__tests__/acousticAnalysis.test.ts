import { describe, expect, it } from 'vitest';
import { computeSpectrogram, trackFormants, trackPitch } from '../acousticAnalysis';

const SR = 16000;

/** Glottal-like impulse train at f0 filtered through second-order resonators at the given formants. */
function synthVowel(f0: number, formants: number[], seconds = 0.5): Float32Array {
  const n = Math.round(seconds * SR);
  let x = new Float64Array(n);
  const period = SR / f0;
  for (let k = 0; k * period < n; k++) x[Math.round(k * period)] = 1;
  // Glottal source spectral tilt (about -12 dB/octave), as in real voices
  for (let pass = 0; pass < 2; pass++) {
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = x[i] + 0.97 * (g[i - 1] ?? 0);
    x = g;
  }
  for (const F of formants) {
    const bw = 80 + F * 0.05;
    const r = Math.exp((-Math.PI * bw) / SR);
    const theta = (2 * Math.PI * F) / SR;
    const a1 = 2 * r * Math.cos(theta);
    const a2 = -r * r;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + a1 * (y[i - 1] ?? 0) + a2 * (y[i - 2] ?? 0);
    x = y;
  }
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  return Float32Array.from(x, (v) => (v / max) * 0.8);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe('acoustic analysis', () => {
  it('puts a pure tone in the right spectrogram bin', () => {
    const tone = Float32Array.from({ length: SR / 4 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
    const spec = computeSpectrogram(tone, SR, { windowSec: 0.03, maxHz: 4000 });
    const mid = Math.floor(spec.frames / 2);
    let best = 0;
    for (let b = 1; b < spec.bins; b++) {
      if (spec.db[mid * spec.bins + b] > spec.db[mid * spec.bins + best]) best = b;
    }
    expect(Math.abs(best * spec.binHz - 1000)).toBeLessThan(spec.binHz * 1.5);
  });

  it('tracks pitch of an adult and a child voice', () => {
    for (const f0 of [120, 280]) {
      const v = synthVowel(f0, [700, 1200, 2600]);
      const voiced = trackPitch(v, SR).filter((p) => p.f0 > 0).map((p) => p.f0);
      expect(voiced.length).toBeGreaterThan(10);
      expect(Math.abs(median(voiced) - f0) / f0).toBeLessThan(0.05);
    }
  });

  it('reports silence as unvoiced', () => {
    const silence = new Float32Array(SR / 2);
    expect(trackPitch(silence, SR).every((p) => p.f0 === 0)).toBe(true);
  });

  it('estimates F1–F3 of a synthetic /a/-like vowel within 12%', () => {
    const target = [800, 1300, 2900];
    const v = synthVowel(220, target);
    const frames = trackFormants(v, SR).filter((fr) => fr.f[0] !== null);
    expect(frames.length).toBeGreaterThan(10);
    target.forEach((F, k) => {
      const est = median(frames.map((fr) => fr.f[k]).filter((x): x is number => x !== null));
      expect(Math.abs(est - F) / F).toBeLessThan(0.12);
    });
  });

  it('estimates a front vowel /i/ (low F1, high F2)', () => {
    const v = synthVowel(250, [320, 2700, 3400]);
    const frames = trackFormants(v, SR).filter((fr) => fr.f[0] !== null);
    const f1 = median(frames.map((fr) => fr.f[0]!));
    const f2 = median(frames.map((fr) => fr.f[1]!).filter(Boolean));
    expect(f1).toBeLessThan(500);
    expect(f2).toBeGreaterThan(2200);
  });
});
