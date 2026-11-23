import type { SpeakerAliases } from '../types/saltify';
import { correctSentence } from './childGrammarEngine';
import { formatTimestamp, parseUtteranceLines } from './transcriptFormat';

export const WHISPER_SAMPLE_RATE = 16000;

export interface TimedUtterance {
  startSec: number;
  endSec: number;
  text: string;
}

export type SpeakerRole = 'speaker1' | 'speaker2';

export interface DiarizationResult {
  roles: SpeakerRole[];
  speakerCount: 1 | 2;
}

interface SegmentAcousticFeatures {
  valid: boolean;
  activeFrames: number;
  voicedFrames: number;
  medianLogF0: number | null;
  meanLogCentroid: number;
  meanMfcc: Float64Array;
}

const FFT_SIZE = 512;
const HALF_FFT = FFT_SIZE / 2;
const NUM_MEL_BANDS = 20;
const NUM_MFCC = 12;
const FRAME_SIZE = 480; // 30 ms at 16 kHz
const FRAME_HOP = 240; // 15 ms hop

// Precomputed DSP lookup tables (allocated once per worker / main thread)
const HAMMING_WINDOW = (() => {
  const w = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }
  return w;
})();

const BIT_REV = (() => {
  const rev = new Uint16Array(FFT_SIZE);
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }
  return rev;
})();

const FFT_COS = (() => {
  const c = new Float64Array(HALF_FFT);
  for (let i = 0; i < HALF_FFT; i++) {
    c[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  }
  return c;
})();

const FFT_SIN = (() => {
  const s = new Float64Array(HALF_FFT);
  for (let i = 0; i < HALF_FFT; i++) {
    s[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
  }
  return s;
})();

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

const MEL_FILTERBANK: Array<{ startBin: number; weights: Float64Array }> = (() => {
  const minMel = hzToMel(80);
  const maxMel = hzToMel(7600);
  const melPoints = new Float64Array(NUM_MEL_BANDS + 2);
  for (let i = 0; i < melPoints.length; i++) {
    melPoints[i] = minMel + ((maxMel - minMel) * i) / (NUM_MEL_BANDS + 1);
  }
  const bins = Array.from(melPoints, (m) =>
    Math.min(HALF_FFT, Math.max(0, Math.floor(((FFT_SIZE + 1) * melToHz(m)) / WHISPER_SAMPLE_RATE)))
  );

  const bank: Array<{ startBin: number; weights: Float64Array }> = [];
  for (let m = 1; m <= NUM_MEL_BANDS; m++) {
    const left = bins[m - 1];
    const center = Math.max(left + 1, bins[m]);
    const right = Math.max(center + 1, bins[m + 1]);
    const clampedRight = Math.min(HALF_FFT, right);
    const len = Math.max(1, clampedRight - left + 1);
    const weights = new Float64Array(len);

    for (let k = left; k <= clampedRight; k++) {
      if (k < center) {
        weights[k - left] = (k - left) / Math.max(1, center - left);
      } else if (k <= clampedRight) {
        weights[k - left] = (clampedRight - k) / Math.max(1, clampedRight - center);
      }
    }
    bank.push({ startBin: left, weights });
  }
  return bank;
})();

// Orthonormal DCT-II matrix for MFCC c1..c12 (omitting c0 loudness component)
const DCT_MATRIX: Float64Array[] = (() => {
  const scale = Math.sqrt(2 / NUM_MEL_BANDS);
  const mat: Float64Array[] = [];
  for (let c = 1; c <= NUM_MFCC; c++) {
    const row = new Float64Array(NUM_MEL_BANDS);
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      row[m] = scale * Math.cos((Math.PI * c * (m + 0.5)) / NUM_MEL_BANDS);
    }
    mat.push(row);
  }
  return mat;
})();

// Reusable scratch buffers for zero-GC-pressure FFT & MFCC computation
const fftRe = new Float64Array(FFT_SIZE);
const fftIm = new Float64Array(FFT_SIZE);
const powerSpec = new Float64Array(HALF_FFT + 1);
const logMel = new Float64Array(NUM_MEL_BANDS);

function computeFft512InPlace(): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = BIT_REV[i];
    if (j > i) {
      const tr = fftRe[i];
      fftRe[i] = fftRe[j];
      fftRe[j] = tr;
      const ti = fftIm[i];
      fftIm[i] = fftIm[j];
      fftIm[j] = ti;
    }
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const halfSize = size >> 1;
    const step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * step;
        const wr = FFT_COS[k];
        const wi = FFT_SIN[k];
        const idx1 = i + j;
        const idx2 = idx1 + halfSize;
        const tr = wr * fftRe[idx2] - wi * fftIm[idx2];
        const ti = wr * fftIm[idx2] + wi * fftRe[idx2];
        fftRe[idx2] = fftRe[idx1] - tr;
        fftIm[idx2] = fftIm[idx1] - ti;
        fftRe[idx1] += tr;
        fftIm[idx1] += ti;
      }
    }
  }
}

/**
 * YIN pitch estimator (75 Hz - 500 Hz) returning fundamental frequency in Hz,
 * or null if the frame is unvoiced/noisy.
 */
function estimatePitchYin(audio: Float32Array, frameStart: number, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 500); // 500 Hz (young child upper bound)
  const maxLag = Math.floor(sampleRate / 75); // 75 Hz (adult male lower bound)
  const windowLen = 240; // 15 ms integration window (240 + 213 <= 480)
  if (frameStart + windowLen + maxLag > audio.length) return null;

  const diff = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < windowLen; j++) {
      const delta = audio[frameStart + j] - audio[frameStart + j + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  const cmndf = new Float64Array(maxLag + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? (diff[tau] * tau) / runningSum : 1;
  }

  // Prefer the first dip below strict periodicity threshold (avoids sub-harmonic octave drops)
  let bestTau = -1;
  const threshold = 0.2;
  for (let tau = minLag; tau <= maxLag - 1; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 <= maxLag - 1 && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) {
    let minVal = 0.3;
    for (let tau = minLag; tau <= maxLag - 1; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau < minLag) return null;

  // Parabolic interpolation for sub-sample pitch accuracy
  let refinedTau = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * s1 - s2 - s0;
    if (Math.abs(denom) > 1e-9) {
      refinedTau = bestTau + (s2 - s0) / (2 * denom);
    }
  }

  const f0 = sampleRate / refinedTau;
  if (!Number.isFinite(f0) || f0 < 75 || f0 > 500) return null;
  return f0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function extractSegmentFeatures(
  audio: Float32Array,
  startSec: number,
  endSec: number,
  sampleRate = WHISPER_SAMPLE_RATE
): SegmentAcousticFeatures {
  const emptyMfcc = new Float64Array(NUM_MFCC);
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(audio.length, Math.ceil(endSec * sampleRate));
  const length = endSample - startSample;

  if (length < FRAME_SIZE) {
    return {
      valid: false,
      activeFrames: 0,
      voicedFrames: 0,
      medianLogF0: null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  const totalFrames = Math.floor((length - FRAME_SIZE) / FRAME_HOP) + 1;
  const maxSampledFrames = 72;
  const frameStride = Math.max(1, Math.floor(totalFrames / maxSampledFrames));

  const candidateStarts: number[] = [];
  const candidateRms: number[] = [];
  let maxRms = 0;

  for (let f = 0; f < totalFrames; f += frameStride) {
    const pos = startSample + f * FRAME_HOP;
    let sumSq = 0;
    for (let i = 0; i < FRAME_SIZE; i += 2) {
      const v = audio[pos + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / (FRAME_SIZE / 2));
    candidateStarts.push(pos);
    candidateRms.push(rms);
    if (rms > maxRms) maxRms = rms;
  }

  if (maxRms < 0.008) {
    return {
      valid: false,
      activeFrames: 0,
      voicedFrames: 0,
      medianLogF0: null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  const energyFloor = Math.max(0.01, maxRms * 0.25);
  const logF0Values: number[] = [];
  const mfccAccum = new Float64Array(NUM_MFCC);
  let centroidAccum = 0;
  let activeFrames = 0;

  const binHz = sampleRate / FFT_SIZE;
  const minCentBin = Math.max(1, Math.floor(100 / binHz));
  const maxCentBin = Math.min(HALF_FFT, Math.ceil(6000 / binHz));

  for (let idx = 0; idx < candidateStarts.length; idx++) {
    if (candidateRms[idx] < energyFloor) continue;
    const pos = candidateStarts[idx];
    activeFrames++;

    // 1. Pitch F0 on raw frame
    const f0 = estimatePitchYin(audio, pos, sampleRate);
    if (f0 !== null) {
      logF0Values.push(Math.log2(f0));
    }

    // 2. Pre-emphasis + Hamming window + 512-pt FFT
    fftRe.fill(0);
    fftIm.fill(0);
    let prev = pos > 0 ? audio[pos - 1] : 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const sample = audio[pos + i];
      const emphasized = sample - 0.97 * prev;
      prev = sample;
      fftRe[i] = emphasized * HAMMING_WINDOW[i];
    }
    computeFft512InPlace();

    for (let k = 0; k <= HALF_FFT; k++) {
      powerSpec[k] = fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k];
    }

    // 3. Spectral centroid (formant / vocal-tract brightness)
    let weightedFreq = 0;
    let totalPower = 0;
    for (let k = minCentBin; k <= maxCentBin; k++) {
      const p = powerSpec[k];
      weightedFreq += p * (k * binHz);
      totalPower += p;
    }
    const centroidHz = totalPower > 1e-12 ? Math.max(120, weightedFreq / totalPower) : 1000;
    centroidAccum += Math.log2(centroidHz);

    // 4. Mel filterbank + relative dynamic-range floor (~40 dB) + DCT -> 12 MFCCs (c1..c12)
    let maxBandEnergy = 0;
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      const { startBin, weights } = MEL_FILTERBANK[m];
      let bandEnergy = 0;
      for (let j = 0; j < weights.length; j++) {
        bandEnergy += powerSpec[startBin + j] * weights[j];
      }
      logMel[m] = bandEnergy;
      if (bandEnergy > maxBandEnergy) maxBandEnergy = bandEnergy;
    }
    const melFloor = Math.max(1e-6, maxBandEnergy * 1e-4);
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      logMel[m] = Math.log(Math.max(melFloor, logMel[m]));
    }

    for (let c = 0; c < NUM_MFCC; c++) {
      const row = DCT_MATRIX[c];
      let sum = 0;
      for (let m = 0; m < NUM_MEL_BANDS; m++) {
        sum += logMel[m] * row[m];
      }
      mfccAccum[c] += sum;
    }
  }

  if (activeFrames < 2) {
    return {
      valid: false,
      activeFrames,
      voicedFrames: logF0Values.length,
      medianLogF0: logF0Values.length > 0 ? median(logF0Values) : null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  for (let c = 0; c < NUM_MFCC; c++) {
    mfccAccum[c] /= activeFrames;
  }

  return {
    valid: true,
    activeFrames,
    voicedFrames: logF0Values.length,
    medianLogF0: logF0Values.length >= 2 ? median(logF0Values) : null,
    meanLogCentroid: centroidAccum / activeFrames,
    meanMfcc: mfccAccum,
  };
}

// ==================== CLINICAL / CONVERSATIONAL LINGUISTIC CUES ====================

const EXAMINER_PROMPT_PATTERNS: RegExp[] = [
  /^(?:tell me|can you tell|could you tell|will you tell|let's|show me|look at|try to|say that)/i,
  /^(?:what|where|when|why|who|how|which|did you|do you|have you|can you|are you|is it|was it|were they)\b/i,
  /^(?:oh really|good job|nice job|great job|very good|awesome|uh[- ]?huh|mm[- ]?hmm|mhm|okay,?\s+(?:tell|what|now|let's|so|and))/i,
  /\b(?:tell me what|what happened|what did|what else|anything else|do you remember|can you say)\b/i,
];

/**
 * Positive score favors Examiner (speaker2); negative favors Child (speaker1).
 */
function scoreExaminerLinguisticLikelihood(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 0;
  if (trimmed.endsWith('?')) {
    score += 1.4;
  }

  for (const pattern of EXAMINER_PROMPT_PATTERNS) {
    if (pattern.test(trimmed)) {
      score += 1.1;
      break;
    }
  }

  // Child language grammar patterns (overgeneralizations, omitted 3s, pronoun errors, mazes)
  if (correctSentence(trimmed) !== trimmed) {
    score -= 1.25;
  }

  return score;
}

function sqDist(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Feature weights: [logF0, logCentroid, mfcc1..mfcc12]
const FEATURE_WEIGHTS = [
  2.2, // Pitch F0 (strongest Child vs Adult / Male vs Female cue)
  1.3, // Spectral centroid (vocal-tract formant brightness)
  1.1,
  1.1,
  1.1,
  1.1,
  1.0,
  1.0,
  0.8,
  0.8,
  0.7,
  0.7,
  0.6,
  0.6,
];

const FEATURE_DIM = FEATURE_WEIGHTS.length;

/**
 * Automatically assign Speaker 1 (Child) vs Speaker 2 (Examiner) to timestamped
 * utterances using on-device acoustic clustering (YIN F0 pitch + spectral centroid
 * + 12 MFCCs) combined with clinical SLP conversational cues.
 */
export function diarizeSpeakerSegments(
  audio: Float32Array,
  segments: TimedUtterance[],
  sampleRate = WHISPER_SAMPLE_RATE
): DiarizationResult {
  const n = segments.length;
  if (n === 0) {
    return { roles: [], speakerCount: 1 };
  }
  if (n === 1) {
    const role: SpeakerRole =
      scoreExaminerLinguisticLikelihood(segments[0].text) >= 1.5 ? 'speaker2' : 'speaker1';
    return { roles: [role], speakerCount: 1 };
  }

  const features = segments.map((seg) =>
    extractSegmentFeatures(audio, seg.startSec, seg.endSec, sampleRate)
  );
  const validIndices = features
    .map((f, idx) => (f.valid ? idx : -1))
    .filter((idx) => idx >= 0);

  if (validIndices.length < 2) {
    return {
      roles: assignRolesFromTextList(segments.map((s) => s.text)),
      speakerCount: 1,
    };
  }

  // Fallback median F0 for active-but-mostly-unvoiced segments
  const knownLogF0s = validIndices
    .map((idx) => features[idx].medianLogF0)
    .filter((v): v is number => v !== null);
  const globalMedianLogF0 = knownLogF0s.length > 0 ? median(knownLogF0s) : Math.log2(200);

  // Build raw feature matrices for valid segments
  const rawVectors = new Map<number, Float64Array>();
  for (const idx of validIndices) {
    const f = features[idx];
    const vec = new Float64Array(FEATURE_DIM);
    vec[0] = f.medianLogF0 ?? globalMedianLogF0;
    vec[1] = f.meanLogCentroid;
    for (let c = 0; c < NUM_MFCC; c++) {
      vec[2 + c] = f.meanMfcc[c];
    }
    rawVectors.set(idx, vec);
  }

  // Standardize each feature dimension (z-score) and apply speaker-discriminative weights
  const means = new Float64Array(FEATURE_DIM);
  const stds = new Float64Array(FEATURE_DIM);
  for (const idx of validIndices) {
    const vec = rawVectors.get(idx)!;
    for (let d = 0; d < FEATURE_DIM; d++) means[d] += vec[d];
  }
  for (let d = 0; d < FEATURE_DIM; d++) means[d] /= validIndices.length;

  for (const idx of validIndices) {
    const vec = rawVectors.get(idx)!;
    for (let d = 0; d < FEATURE_DIM; d++) {
      const diff = vec[d] - means[d];
      stds[d] += diff * diff;
    }
  }
  for (let d = 0; d < FEATURE_DIM; d++) {
    stds[d] = Math.sqrt(stds[d] / validIndices.length);
  }

  const weightedVectors = new Map<number, Float64Array>();
  for (const idx of validIndices) {
    const raw = rawVectors.get(idx)!;
    const wv = new Float64Array(FEATURE_DIM);
    for (let d = 0; d < FEATURE_DIM; d++) {
      // Avoid amplifying near-constant dimensions (e.g., identical pitch in solo speech)
      const minScale = d === 0 ? 0.08 : d === 1 ? 0.12 : 0.35;
      const denom = Math.max(stds[d], minScale);
      wv[d] = ((raw[d] - means[d]) / denom) * FEATURE_WEIGHTS[d];
    }
    weightedVectors.set(idx, wv);
  }

  // Deterministic farthest-pair initialization for 2-cluster K-Means
  let seedA = validIndices[0];
  let seedB = validIndices[1];
  let maxPairDist = -1;
  for (let i = 0; i < validIndices.length; i++) {
    const aIdx = validIndices[i];
    const va = weightedVectors.get(aIdx)!;
    for (let j = i + 1; j < validIndices.length; j++) {
      const bIdx = validIndices[j];
      const d = sqDist(va, weightedVectors.get(bIdx)!);
      if (d > maxPairDist) {
        maxPairDist = d;
        seedA = aIdx;
        seedB = bIdx;
      }
    }
  }

  const centroid0 = new Float64Array(weightedVectors.get(seedA)!);
  const centroid1 = new Float64Array(weightedVectors.get(seedB)!);
  const clusterOf = new Map<number, 0 | 1>();

  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (const idx of validIndices) {
      const v = weightedVectors.get(idx)!;
      const assigned: 0 | 1 = sqDist(v, centroid0) <= sqDist(v, centroid1) ? 0 : 1;
      if (clusterOf.get(idx) !== assigned) {
        clusterOf.set(idx, assigned);
        changed = true;
      }
    }
    if (!changed && iter > 0) break;

    const sum0 = new Float64Array(FEATURE_DIM);
    const sum1 = new Float64Array(FEATURE_DIM);
    let w0 = 0;
    let w1 = 0;
    for (const idx of validIndices) {
      const v = weightedVectors.get(idx)!;
      const weight = Math.min(24, Math.max(1, features[idx].activeFrames));
      if (clusterOf.get(idx) === 0) {
        for (let d = 0; d < FEATURE_DIM; d++) sum0[d] += v[d] * weight;
        w0 += weight;
      } else {
        for (let d = 0; d < FEATURE_DIM; d++) sum1[d] += v[d] * weight;
        w1 += weight;
      }
    }
    if (w0 > 0) {
      for (let d = 0; d < FEATURE_DIM; d++) centroid0[d] = sum0[d] / w0;
    }
    if (w1 > 0) {
      for (let d = 0; d < FEATURE_DIM; d++) centroid1[d] = sum1[d] / w1;
    }
  }

  const c0Members = validIndices.filter((idx) => clusterOf.get(idx) === 0);
  const c1Members = validIndices.filter((idx) => clusterOf.get(idx) === 1);

  if (c0Members.length === 0 || c1Members.length === 0) {
    return { roles: new Array<SpeakerRole>(n).fill('speaker1'), speakerCount: 1 };
  }

  // Evaluate 1-speaker vs 2-speaker acoustic separation
  const c0F0s = c0Members
    .map((idx) => features[idx].medianLogF0)
    .filter((v): v is number => v !== null);
  const c1F0s = c1Members
    .map((idx) => features[idx].medianLogF0)
    .filter((v): v is number => v !== null);
  const c0MedF0 = c0F0s.length > 0 ? median(c0F0s) : globalMedianLogF0;
  const c1MedF0 = c1F0s.length > 0 ? median(c1F0s) : globalMedianLogF0;
  const semitoneGap = Math.abs(c0MedF0 - c1MedF0) * 12;

  const c0Centroids = c0Members.map((idx) => features[idx].meanLogCentroid);
  const c1Centroids = c1Members.map((idx) => features[idx].meanLogCentroid);
  const c0MedCent = median(c0Centroids);
  const c1MedCent = median(c1Centroids);
  const centroidSemitoneGap = Math.abs(c0MedCent - c1MedCent) * 12;

  // Physical un-normalized MFCC distance between cluster centroids (avoids z-score noise amplification)
  const c0MeanMfcc = new Float64Array(NUM_MFCC);
  const c1MeanMfcc = new Float64Array(NUM_MFCC);
  for (const idx of c0Members) {
    const m = features[idx].meanMfcc;
    for (let c = 0; c < NUM_MFCC; c++) c0MeanMfcc[c] += m[c] / c0Members.length;
  }
  for (const idx of c1Members) {
    const m = features[idx].meanMfcc;
    for (let c = 0; c < NUM_MFCC; c++) c1MeanMfcc[c] += m[c] / c1Members.length;
  }
  const rawMfccDist = Math.sqrt(sqDist(c0MeanMfcc, c1MeanMfcc));

  // Mean silhouette score over valid segments (singleton clusters have silhouette 0 by definition)
  let silSum = 0;
  for (const idx of validIndices) {
    const v = weightedVectors.get(idx)!;
    const own = clusterOf.get(idx) === 0 ? c0Members : c1Members;
    const other = clusterOf.get(idx) === 0 ? c1Members : c0Members;

    if (own.length <= 1) {
      continue;
    }

    let aDist = 0;
    for (const o of own) {
      if (o !== idx) aDist += Math.sqrt(sqDist(v, weightedVectors.get(o)!));
    }
    aDist /= own.length - 1;

    let bDist = 0;
    for (const o of other) {
      bDist += Math.sqrt(sqDist(v, weightedVectors.get(o)!));
    }
    bDist /= other.length;

    const denom = Math.max(aDist, bDist, 1e-6);
    silSum += (bDist - aDist) / denom;
  }
  const meanSilhouette = silSum / validIndices.length;

  // Distinguish genuine 2-speaker conversation from 1-speaker monologue using physical acoustic gaps
  const hasTwoSpeakers =
    semitoneGap >= 2.8 ||
    centroidSemitoneGap >= 3.0 ||
    (rawMfccDist >= 2.8 && meanSilhouette >= 0.25);

  if (!hasTwoSpeakers) {
    const avgExaminer =
      segments.reduce((s, seg) => s + scoreExaminerLinguisticLikelihood(seg.text), 0) / n;
    const soloRole: SpeakerRole = avgExaminer >= 1.2 ? 'speaker2' : 'speaker1';
    return { roles: new Array<SpeakerRole>(n).fill(soloRole), speakerCount: 1 };
  }

  // Decide which cluster is Speaker 1 (Child) vs Speaker 2 (Examiner)
  // Higher pitch (F0) + higher vocal tract resonance (centroid) + child-speech patterns -> Child (speaker1)
  // Questions & SLP prompts -> Examiner (speaker2)
  const c0ExaminerAvg =
    c0Members.reduce((s, idx) => s + scoreExaminerLinguisticLikelihood(segments[idx].text), 0) /
    c0Members.length;
  const c1ExaminerAvg =
    c1Members.reduce((s, idx) => s + scoreExaminerLinguisticLikelihood(segments[idx].text), 0) /
    c1Members.length;

  const pitchAdvantageForC0 = clamp(((c0MedF0 - c1MedF0) * 12) / 2.5, -3.5, 3.5) * 1.4;
  const centroidAdvantageForC0 = clamp(((c0MedCent - c1MedCent) * 12) / 3.0, -2.5, 2.5) * 0.85;
  const linguisticAdvantageForC0 = clamp(c1ExaminerAvg - c0ExaminerAvg, -2.5, 2.5) * 1.25;

  const c0ChildScore = pitchAdvantageForC0 + centroidAdvantageForC0 + linguisticAdvantageForC0;
  const childCluster: 0 | 1 = c0ChildScore >= 0 ? 0 : 1;

  const roles: Array<SpeakerRole | null> = new Array(n).fill(null);
  for (const idx of validIndices) {
    roles[idx] = clusterOf.get(idx) === childCluster ? 'speaker1' : 'speaker2';
  }

  // Fill any unvoiced/very short utterances using conversational turn context
  for (let i = 0; i < n; i++) {
    if (roles[i] !== null) continue;
    const textScore = scoreExaminerLinguisticLikelihood(segments[i].text);
    if (textScore >= 1.0) {
      roles[i] = 'speaker2';
    } else if (textScore <= -0.8) {
      roles[i] = 'speaker1';
    } else if (i > 0 && roles[i - 1] !== null) {
      const prevRole = roles[i - 1]!;
      const prevEndedWithQuestion = segments[i - 1].text.trim().endsWith('?');
      roles[i] = prevEndedWithQuestion ? (prevRole === 'speaker1' ? 'speaker2' : 'speaker1') : prevRole;
    } else {
      const nextAssigned = roles.find((r): r is SpeakerRole => r !== null);
      roles[i] = nextAssigned ?? 'speaker1';
    }
  }

  return {
    roles: roles.map((r) => r ?? 'speaker1'),
    speakerCount: 2,
  };
}

/**
 * Conversational + clinical text-only speaker assignment fallback when no audio is available
 * (e.g., pasted or manually typed transcripts).
 */
export function assignRolesFromTextList(lines: string[]): SpeakerRole[] {
  const roles: SpeakerRole[] = [];
  let currentRole: SpeakerRole = 'speaker1';

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    const score = scoreExaminerLinguisticLikelihood(text);

    if (score >= 1.0) {
      currentRole = 'speaker2';
    } else if (score <= -0.8) {
      currentRole = 'speaker1';
    } else if (i > 0 && lines[i - 1].trim().endsWith('?')) {
      // Answer immediately following an examiner question belongs to the other speaker
      currentRole = roles[i - 1] === 'speaker2' ? 'speaker1' : 'speaker2';
    } else if (i === 0) {
      currentRole = 'speaker1';
    }

    roles.push(currentRole);
  }

  return roles;
}

/**
 * Format diarized utterances as `[m:ss] <Speaker> <Text>` lines using session speaker aliases.
 */
export function formatDiarizedTranscript(
  segments: TimedUtterance[],
  roles: SpeakerRole[],
  aliases: SpeakerAliases
): string {
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  return segments
    .map((seg, idx) => {
      const ts = formatTimestamp(seg.startSec);
      const label = roles[idx] === 'speaker2' ? s2 : s1;
      return `[${ts}] ${label} ${seg.text}`;
    })
    .join('\n');
}

/**
 * Auto-assign speaker labels across an existing transcript string, using acoustic
 * diarization when 16 kHz audio and timestamps are available, or clinical text heuristics otherwise.
 */
export function autoAssignSpeakersInTranscript(
  text: string,
  aliases: SpeakerAliases,
  audio16k?: Float32Array | null,
  sampleRate = WHISPER_SAMPLE_RATE
): { transcript: string; speakerCount: 1 | 2; method: 'acoustic' | 'text' } {
  const parsed = parseUtteranceLines(text, aliases);
  const nonEmpty = parsed.filter((line) => line.raw.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { transcript: text, speakerCount: 1, method: 'text' };
  }

  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  const hasAudioAndTimestamps =
    Boolean(audio16k && audio16k.length >= FRAME_SIZE * 2) &&
    nonEmpty.filter((l) => l.timestampSec !== null).length >= Math.ceil(nonEmpty.length * 0.5);

  let assignedRoles: SpeakerRole[];
  let speakerCount: 1 | 2;
  let method: 'acoustic' | 'text';

  if (hasAudioAndTimestamps && audio16k) {
    const totalDuration = audio16k.length / sampleRate;
    const timed: TimedUtterance[] = nonEmpty.map((line, i) => {
      const startSec = line.timestampSec ?? (i / nonEmpty.length) * totalDuration;
      const nextTs =
        i + 1 < nonEmpty.length && nonEmpty[i + 1].timestampSec !== null
          ? nonEmpty[i + 1].timestampSec!
          : totalDuration;
      const endSec = Math.min(totalDuration, Math.max(startSec + 0.6, nextTs));
      return { startSec, endSec, text: line.body };
    });

    const result = diarizeSpeakerSegments(audio16k, timed, sampleRate);
    assignedRoles = result.roles;
    speakerCount = result.speakerCount;
    method = 'acoustic';
  } else {
    assignedRoles = assignRolesFromTextList(nonEmpty.map((l) => l.body));
    const unique = new Set(assignedRoles);
    speakerCount = unique.size > 1 ? 2 : 1;
    method = 'text';
  }

  let nonEmptyCursor = 0;
  const updated = parsed
    .map((line) => {
      if (!line.raw.trim()) return line.raw;
      const role = assignedRoles[nonEmptyCursor++] ?? 'speaker1';
      const label = role === 'speaker2' ? s2 : s1;
      const tsLabel = line.timestampStr ? `[${line.timestampStr}]` : null;
      return [tsLabel, label, line.body].filter(Boolean).join(' ');
    })
    .join('\n');

  return { transcript: updated, speakerCount, method };
}
