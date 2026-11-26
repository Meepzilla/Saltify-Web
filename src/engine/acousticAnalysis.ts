/**
 * On-device acoustic analysis for the Spectrogram view: short-time spectrogram,
 * pitch (F0) and formant (F1–F3) tracking. Pure functions, no dependencies.
 *
 * Defaults follow common phonetics practice (Praat):
 * - Wideband spectrogram (≈5 ms window) shows formants as dark bands; narrowband (≈30 ms) shows harmonics.
 * - Formants: Burg/autocorrelation LPC on a pre-emphasized 25 ms window, 5 formants up to 8000 Hz,
 *   which is Praat's recommended ceiling for children (5000 Hz men, 5500 Hz women).
 * Formant tracking in child speech is approximate (high F0 → sparse harmonics), so values are a
 * visual aid for the clinician, not an automatic judgment.
 */

export interface SpectrogramResult {
  /** Magnitude in dB per frame (frames × bins), row-major. */
  db: Float32Array;
  frames: number;
  bins: number;
  /** Seconds per frame step. */
  hopSec: number;
  /** Hz per frequency bin. */
  binHz: number;
  /** Highest dB value (for display scaling). */
  maxDb: number;
}

export interface FormantFrame {
  /** Frame centre time in seconds (relative to the analysed segment). */
  t: number;
  /** F1, F2, F3 in Hz (null when not found). */
  f: [number | null, number | null, number | null];
}

export interface PitchFrame {
  t: number;
  /** Fundamental frequency in Hz, or 0 when unvoiced. */
  f0: number;
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function preEmphasize(x: Float32Array, sampleRate: number, fromHz = 50): Float32Array {
  const a = Math.exp((-2 * Math.PI * fromHz) / sampleRate);
  const y = new Float32Array(x.length);
  y[0] = x[0] ?? 0;
  for (let i = 1; i < x.length; i++) y[i] = x[i] - a * x[i - 1];
  return y;
}

/**
 * Short-time Fourier spectrogram up to `maxHz`.
 * `windowSec` ≈ 0.005 gives a wideband (formant) view; ≈ 0.03 gives a narrowband (harmonic) view.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  { windowSec = 0.005, hopSec = 0.002, maxHz = 6000 }: { windowSec?: number; hopSec?: number; maxHz?: number } = {}
): SpectrogramResult {
  const win = Math.max(16, Math.round(windowSec * sampleRate));
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  let nfft = 256;
  while (nfft < win * 2) nfft <<= 1;
  const binHz = sampleRate / nfft;
  const bins = Math.min(nfft / 2, Math.ceil(maxHz / binHz));
  const frames = Math.max(1, Math.floor(Math.max(0, samples.length - win) / hop) + 1);
  const db = new Float32Array(frames * bins);
  const w = hann(win);
  const x = preEmphasize(samples, sampleRate);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let maxDb = -Infinity;

  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    const start = f * hop;
    for (let i = 0; i < win; i++) re[i] = (x[start + i] ?? 0) * w[i];
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const v = 10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12);
      db[f * bins + b] = v;
      if (v > maxDb) maxDb = v;
    }
  }
  return { db, frames, bins, hopSec: hop / sampleRate, binHz, maxDb };
}

/**
 * Pitch (F0) by normalized autocorrelation with a voicing threshold.
 * Range 70–700 Hz covers adults and young children.
 */
export function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  { hopSec = 0.01, minHz = 70, maxHz = 700, windowSec = 0.04 }: { hopSec?: number; minHz?: number; maxHz?: number; windowSec?: number } = {}
): PitchFrame[] {
  const win = Math.round(windowSec * sampleRate);
  const hop = Math.round(hopSec * sampleRate);
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(win - 1, Math.ceil(sampleRate / minHz));
  const out: PitchFrame[] = [];
  let globalMaxRms = 0;
  const rmsList: number[] = [];
  for (let start = 0; start + win <= samples.length; start += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += samples[start + i] ** 2;
    const rms = Math.sqrt(e / win);
    rmsList.push(rms);
    if (rms > globalMaxRms) globalMaxRms = rms;
  }

  let frame = 0;
  for (let start = 0; start + win <= samples.length; start += hop, frame++) {
    const t = (start + win / 2) / sampleRate;
    if (rmsList[frame] < globalMaxRms * 0.06) {
      out.push({ t, f0: 0 });
      continue;
    }
    let mean = 0;
    for (let i = 0; i < win; i++) mean += samples[start + i];
    mean /= win;
    const seg = new Float64Array(win);
    for (let i = 0; i < win; i++) seg[i] = samples[start + i] - mean;
    let r0 = 0;
    for (let i = 0; i < win; i++) r0 += seg[i] * seg[i];
    let bestLag = 0;
    let best = 0;
    const corr = new Float64Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag + 1 && lag < win; lag++) {
      let s = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i + lag < win; i++) {
        s += seg[i] * seg[i + lag];
        e1 += seg[i] * seg[i];
        e2 += seg[i + lag] * seg[i + lag];
      }
      corr[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
    }
    // Pick the first strong peak (avoids octave errors that prefer longer lags)
    const globalBest = Math.max(...Array.from(corr.slice(minLag, maxLag + 1)));
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] >= 0.9 * globalBest) {
        bestLag = lag;
        best = corr[lag];
        break;
      }
    }
    if (bestLag === 0 || best < 0.5 || r0 === 0) {
      out.push({ t, f0: 0 });
      continue;
    }
    // Parabolic interpolation for sub-sample accuracy
    const y0 = corr[bestLag - 1];
    const y1 = corr[bestLag];
    const y2 = corr[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    out.push({ t, f0: sampleRate / (bestLag + shift) });
  }
  return smoothPitchTrack(out);
}

/**
 * Removes octave jumps and single-frame spikes: each voiced frame is compared with the median
 * of its voiced neighbours (±3 frames); frames more than 1.6× away are corrected by halving /
 * doubling when that fits, otherwise marked unvoiced.
 */
function smoothPitchTrack(frames: PitchFrame[]): PitchFrame[] {
  const local = frames.map((fr, i) => {
    if (fr.f0 <= 0) return fr;
    const neighbors: number[] = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(frames.length - 1, i + 3); j++) {
      if (j !== i && frames[j].f0 > 0) neighbors.push(frames[j].f0);
    }
    if (neighbors.length < 2) return neighbors.length === 0 ? { t: fr.t, f0: 0 } : fr;
    neighbors.sort((a, b) => a - b);
    const med = neighbors[Math.floor(neighbors.length / 2)];
    const ratio = fr.f0 / med;
    if (ratio < 1.6 && ratio > 1 / 1.6) return fr;
    for (const k of [0.5, 2, 1 / 3, 3]) {
      const candidate = fr.f0 * k;
      if (candidate / med < 1.25 && candidate / med > 0.8) return { t: fr.t, f0: candidate };
    }
    return { t: fr.t, f0: 0 };
  });

  // Second pass against the utterance's overall median: within one utterance a speaker's pitch
  // rarely strays beyond ~2× either side, so clusters of onset/offset octave errors are fixed too.
  const voiced = local.filter((f) => f.f0 > 0).map((f) => f.f0).sort((a, b) => a - b);
  if (voiced.length < 5) return local;
  const globalMed = voiced[Math.floor(voiced.length / 2)];
  return local.map((fr) => {
    if (fr.f0 <= 0) return fr;
    const r = fr.f0 / globalMed;
    if (r <= 2 && r >= 0.5) return fr;
    for (const k of [0.5, 2, 1 / 3, 3, 0.25, 4]) {
      const c = fr.f0 * k;
      if (c / globalMed <= 1.6 && c / globalMed >= 0.625) return { t: fr.t, f0: c };
    }
    return { t: fr.t, f0: 0 };
  });
}

/** Autocorrelation LPC via Levinson–Durbin. Returns [1, a1..ap]. */
function lpc(frame: Float64Array, order: number): Float64Array | null {
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frame.length; i++) s += frame[i] * frame[i + lag];
    r[lag] = s;
  }
  if (r[0] <= 0) return null;
  r[0] *= 1 + 1e-9; // tiny white-noise correction for stability
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

/** Complex roots of z^p + a1 z^(p-1) + … + ap by Durand–Kerner iteration. */
function polynomialRoots(a: Float64Array): Array<[number, number]> {
  const p = a.length - 1;
  const re = new Float64Array(p);
  const im = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    const ang = (2 * Math.PI * i) / p + 0.4;
    re[i] = 0.9 * Math.cos(ang);
    im[i] = 0.9 * Math.sin(ang);
  }
  const evalPoly = (zr: number, zi: number): [number, number] => {
    let vr = 1;
    let vi = 0;
    for (let k = 1; k <= p; k++) {
      const nr = vr * zr - vi * zi + a[k];
      vi = vr * zi + vi * zr;
      vr = nr;
    }
    return [vr, vi];
  };
  for (let iter = 0; iter < 300; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < p; i++) {
      const [nr, ni] = evalPoly(re[i], im[i]);
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const xr = re[i] - re[j];
        const xi = im[i] - im[j];
        const tr = dr * xr - di * xi;
        di = dr * xi + di * xr;
        dr = tr;
      }
      const den = dr * dr + di * di || 1e-30;
      const qr = (nr * dr + ni * di) / den;
      const qi = (ni * dr - nr * di) / den;
      re[i] -= qr;
      im[i] -= qi;
      maxDelta = Math.max(maxDelta, Math.abs(qr) + Math.abs(qi));
    }
    if (maxDelta < 1e-10) break;
  }
  return Array.from({ length: p }, (_, i) => [re[i], im[i]] as [number, number]);
}

/**
 * Formant tracking (F1–F3) with LPC on voiced, sufficiently loud frames.
 * `maxFormantHz` 8000 suits children; use 5500 for adult women, 5000 for men.
 */
export function trackFormants(
  samples: Float32Array,
  sampleRate: number,
  {
    hopSec = 0.01,
    windowSec = 0.025,
    maxFormantHz = 8000,
    numFormants = 5,
    voicedTimes,
  }: { hopSec?: number; windowSec?: number; maxFormantHz?: number; numFormants?: number; voicedTimes?: (t: number) => boolean } = {}
): FormantFrame[] {
  // Analysis band is 0..maxFormantHz; at 16 kHz with an 8000 Hz ceiling no resampling is needed
  const fs = sampleRate;
  const nyquistLimit = Math.min(maxFormantHz, fs / 2);
  // Praat-style Gaussian window: physical length is twice the effective window length
  const win = Math.round(2 * windowSec * fs);
  const hop = Math.round(hopSec * fs);
  const order = 2 * numFormants;
  const x = preEmphasize(samples, fs);
  const w = new Float64Array(win);
  const edge = Math.exp(-12);
  for (let i = 0; i < win; i++) {
    const u = i / (win - 1) - 0.5;
    w[i] = (Math.exp(-12 * u * u) - edge) / (1 - edge);
  }

  let maxEnergy = 0;
  const energies: number[] = [];
  for (let start = 0; start + win <= x.length; start += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += samples[start + i] ** 2;
    energies.push(e);
    if (e > maxEnergy) maxEnergy = e;
  }

  const out: FormantFrame[] = [];
  let fi = 0;
  for (let start = 0; start + win <= x.length; start += hop, fi++) {
    const t = (start + win / 2) / fs;
    const quiet = energies[fi] < maxEnergy * 1e-3; // more than 30 dB below the loudest frame
    if (quiet || (voicedTimes && !voicedTimes(t))) {
      out.push({ t, f: [null, null, null] });
      continue;
    }
    const frame = new Float64Array(win);
    for (let i = 0; i < win; i++) frame[i] = x[start + i] * w[i];
    const a = lpc(frame, order);
    if (!a) {
      out.push({ t, f: [null, null, null] });
      continue;
    }
    const candidates: number[] = [];
    for (const [zr, zi] of polynomialRoots(a)) {
      if (zi <= 0) continue;
      const mag = Math.hypot(zr, zi);
      const freq = (Math.atan2(zi, zr) * fs) / (2 * Math.PI);
      const bw = (-Math.log(Math.max(mag, 1e-9)) * fs) / Math.PI;
      if (freq > 90 && freq < nyquistLimit - 50 && bw < 1200) candidates.push(freq);
    }
    candidates.sort((p, q) => p - q);
    // Assign F1–F3 within plausible ranges (wide enough for children): F1 150–1500 Hz,
    // F2 up to 4000 Hz, F3 up to 5500 Hz, each at least 150 Hz above the previous formant.
    const limits: Array<[number, number]> = [
      [150, 1500],
      [0, 4000],
      [0, 5500],
    ];
    const picked: FormantFrame['f'] = [null, null, null];
    let floor = 0;
    let ci = 0;
    for (let k = 0; k < 3; k++) {
      while (ci < candidates.length) {
        const c = candidates[ci++];
        if (c >= Math.max(limits[k][0], floor) && c <= limits[k][1]) {
          picked[k] = c;
          floor = c + 150;
          break;
        }
      }
      if (picked[k] === null) break;
    }
    out.push({ t, f: picked });
  }
  return smoothFormantTracks(out);
}

/** 5-frame median smoothing per formant, which removes single-frame jumps (common with high F0). */
function smoothFormantTracks(frames: FormantFrame[]): FormantFrame[] {
  return frames.map((frame, idx) => {
    if (frame.f[0] === null) return frame;
    const f = frame.f.map((_, k) => {
      const neighborhood: number[] = [];
      for (let j = Math.max(0, idx - 2); j <= Math.min(frames.length - 1, idx + 2); j++) {
        const v = frames[j].f[k];
        if (v !== null) neighborhood.push(v);
      }
      if (neighborhood.length === 0) return null;
      neighborhood.sort((a, b) => a - b);
      return neighborhood[Math.floor(neighborhood.length / 2)];
    }) as FormantFrame['f'];
    return { t: frame.t, f };
  });
}
