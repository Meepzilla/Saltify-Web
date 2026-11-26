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

export type SpeakerDetectionMode = 'auto' | 'single' | 'two';

export interface DiarizationResult {
  roles: SpeakerRole[];
  speakerCount: 1 | 2;
}

export interface AutoAssignSpeakersOptions {
  /**
   * 'auto' (default): detect whether the recording has 1 speaker (monologue) or 2 speakers.
   * 'single': label all utterances as Speaker 1 (monologue).
   * 'two': force a 2-speaker acoustic/linguistic split.
   */
  mode?: SpeakerDetectionMode;
  /**
   * Optional exact utterance boundaries (e.g. from Whisper chunks before [M:SS] rounding).
   * Used when its length matches the non-empty utterance count in `text`.
   */
  exactSegments?: TimedUtterance[];
}

interface SegmentAcousticFeatures {
  valid: boolean;
  core: boolean;
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
const FRAME_SIZE = 512; // 32 ms at 16 kHz (matches FFT_SIZE with zero padding artifacts)
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
 * YIN pitch estimator (75 Hz - 600 Hz) returning fundamental frequency in Hz,
 * or null if the frame is unvoiced/noisy.
 *
 * Uses DC-offset removal, strictly first-dip thresholding (avoiding global-min
 * sub-harmonic drops to F0/2 or F0/3 that create artificial octave gaps in solo speech),
 * and an explicit sub-harmonic guard.
 */
function estimatePitchYin(audio: Float32Array, frameStart: number, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 600); // 600 Hz (excited young child upper bound)
  const maxLag = Math.floor(sampleRate / 75); // 75 Hz (deep adult male lower bound)
  const windowLen = 256; // 16 ms integration window (256 + 213 = 469 <= 512)
  if (frameStart + windowLen + maxLag > audio.length) return null;

  // Remove local DC offset so low-frequency rumble does not skew difference magnitudes
  const spanLen = windowLen + maxLag;
  let dcMean = 0;
  for (let i = 0; i < spanLen; i++) {
    dcMean += audio[frameStart + i];
  }
  dcMean /= spanLen;

  const diff = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < windowLen; j++) {
      const delta = audio[frameStart + j] - dcMean - (audio[frameStart + j + tau] - dcMean);
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

  // Strictly first-dip search (strict threshold first, then relaxed threshold — never global min)
  let bestTau = -1;
  for (const threshold of [0.15, 0.24]) {
    for (let tau = minLag; tau <= maxLag - 1; tau++) {
      if (cmndf[tau] < threshold) {
        while (tau + 1 <= maxLag - 1 && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        bestTau = tau;
        break;
      }
    }
    if (bestTau >= minLag) break;
  }

  if (bestTau < minLag) return null;

  // Sub-harmonic guard: if bestTau/2 or bestTau/3 is also a strong local dip, prefer fundamental
  for (const div of [3, 2]) {
    const cand = Math.round(bestTau / div);
    if (cand >= minLag + 1) {
      let localBest = cand;
      const lo = Math.max(minLag, cand - 2);
      const hi = Math.min(maxLag - 1, cand + 2);
      for (let t = lo; t <= hi; t++) {
        if (cmndf[t] < cmndf[localBest]) {
          localBest = t;
        }
      }
      if (cmndf[localBest] < 0.25 && cmndf[localBest] <= cmndf[bestTau] * 1.35 + 0.05) {
        bestTau = localBest;
        break;
      }
    }
  }

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
  if (!Number.isFinite(f0) || f0 < 75 || f0 > 600) return null;
  return f0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Extracts speaker-intrinsic acoustic features from VOICED speech frames only:
 * median log2(F0), un-preemphasized voiced formant centroid (100-4000 Hz),
 * and pre-emphasized voiced MFCCs (c1..c12). Excluding unvoiced fricatives/breaths
 * dramatically reduces phoneme-induced variance in single-speaker monologues.
 */
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
      core: false,
      activeFrames: 0,
      voicedFrames: 0,
      medianLogF0: null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  const totalFrames = Math.floor((length - FRAME_SIZE) / FRAME_HOP) + 1;
  // Sample slightly more frames on long segments (e.g., utterance followed by a long pause)
  const durationSec = length / sampleRate;
  const maxSampledFrames = durationSec > 8 ? 128 : 84;
  const frameStride = Math.max(1, Math.floor(totalFrames / maxSampledFrames));

  const candidateStarts: number[] = [];
  const candidateRms: number[] = [];

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
  }

  // Use 90th-percentile RMS so an isolated table bump or plosive does not mask quiet speech
  const sortedRms = [...candidateRms].sort((a, b) => a - b);
  const refRms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.9))];
  if (refRms < 0.006) {
    return {
      valid: false,
      core: false,
      activeFrames: 0,
      voicedFrames: 0,
      medianLogF0: null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  const energyFloor = Math.max(0.006, refRms * 0.18);
  const voicedLogF0s: number[] = [];
  const voicedPositions: number[] = [];
  let activeFrames = 0;

  for (let idx = 0; idx < candidateStarts.length; idx++) {
    if (candidateRms[idx] < energyFloor) continue;
    activeFrames++;
    const pos = candidateStarts[idx];
    const f0 = estimatePitchYin(audio, pos, sampleRate);
    if (f0 !== null) {
      voicedLogF0s.push(Math.log2(f0));
      voicedPositions.push(pos);
    }
  }

  const rawVoicedCount = voicedLogF0s.length;
  if (rawVoicedCount < 2) {
    return {
      valid: false,
      core: false,
      activeFrames,
      voicedFrames: rawVoicedCount,
      medianLogF0: rawVoicedCount > 0 ? median(voicedLogF0s) : null,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  const medLogF0 = median(voicedLogF0s);
  const mfccAccum = new Float64Array(NUM_MFCC);
  let centroidAccum = 0;
  let usedFrames = 0;

  const binHz = sampleRate / FFT_SIZE;
  const minCentBin = Math.max(1, Math.floor(100 / binHz));
  const maxCentBin = Math.min(HALF_FFT, Math.ceil(4000 / binHz));

  for (let i = 0; i < rawVoicedCount; i++) {
    // Discard isolated frame pitch glitches (> 7.5 semitones from the utterance median)
    if (rawVoicedCount >= 5 && Math.abs(voicedLogF0s[i] - medLogF0) * 12 > 7.5) {
      continue;
    }
    const pos = voicedPositions[i];
    usedFrames++;

    // 1. Un-preemphasized voiced formant centroid (100 - 4000 Hz)
    fftRe.fill(0);
    fftIm.fill(0);
    for (let j = 0; j < FRAME_SIZE; j++) {
      fftRe[j] = audio[pos + j] * HAMMING_WINDOW[j];
    }
    computeFft512InPlace();

    let weightedFreq = 0;
    let totalPower = 0;
    for (let k = minCentBin; k <= maxCentBin; k++) {
      const p = fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k];
      weightedFreq += p * (k * binHz);
      totalPower += p;
    }
    const centroidHz = totalPower > 1e-12 ? Math.max(120, weightedFreq / totalPower) : 1000;
    centroidAccum += Math.log2(centroidHz);

    // 2. Pre-emphasized voiced Mel filterbank + DCT -> 12 MFCCs (c1..c12)
    fftRe.fill(0);
    fftIm.fill(0);
    let prev = pos > 0 ? audio[pos - 1] : 0;
    for (let j = 0; j < FRAME_SIZE; j++) {
      const sample = audio[pos + j];
      const emphasized = sample - 0.97 * prev;
      prev = sample;
      fftRe[j] = emphasized * HAMMING_WINDOW[j];
    }
    computeFft512InPlace();

    for (let k = 0; k <= HALF_FFT; k++) {
      powerSpec[k] = fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k];
    }

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

  if (usedFrames < 2) {
    return {
      valid: false,
      core: false,
      activeFrames,
      voicedFrames: rawVoicedCount,
      medianLogF0: medLogF0,
      meanLogCentroid: Math.log2(1000),
      meanMfcc: emptyMfcc,
    };
  }

  for (let c = 0; c < NUM_MFCC; c++) {
    mfccAccum[c] /= usedFrames;
  }

  return {
    valid: true,
    core: usedFrames >= 3,
    activeFrames,
    voicedFrames: usedFrames,
    medianLogF0: medLogF0,
    meanLogCentroid: centroidAccum / usedFrames,
    meanMfcc: mfccAccum,
  };
}

// ==================== CLINICAL / CONVERSATIONAL LINGUISTIC CUES ====================

/**
 * High-precision SLP Examiner prompts and backchannels.
 * Deliberately excludes narrative story starters like "When...", "What a...",
 * "Let's see...", and "Okay, so..." so child/adult monologues are not misclassified.
 */
const STRONG_EXAMINER_PATTERNS: RegExp[] = [
  /^(?:tell me|can you tell|could you tell|will you tell|show me|look at|try to|say that)\b/i,
  /\b(?:tell me what|what happened next|what else|anything else|do you remember|can you say|can you tell me)\b/i,
  /^(?:oh really|good job|nice job|great job|very good|uh[- ]?huh|mm[- ]?hmm|mhm)\b/i,
  /^(?:okay|alright|all right),?\s+(?:tell me|can you|what|let's|show me|now tell)\b/i,
];

const EXAMINER_PROMPT_HANDOFF_PATTERNS: RegExp[] = [
  /^(?:tell me|can you tell|could you tell|will you tell|show me|look at|try to|say that)\b/i,
  /^(?:okay|alright|all right),?\s+(?:tell me|can you|what|let's|show me|now tell)\b/i,
  /^(?:oh really|good job|nice job|great job|very good|uh[- ]?huh|mm[- ]?hmm|mhm)\b/i,
];

const DIRECT_SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;
const INTERROGATIVE_START_RE =
  /^(?:what|where|why|who|how|which|did|do|does|have|has|can|could|are|is|was|were|would|will)\b/i;
const QUOTED_SPEECH_RE =
  /["“”]|(?:^|\b)(?:he|she|they|it|boy|girl|dog|frog|man|woman|mom|dad|kid|child)\s+(?:said|asked|yelled|shouted|cried|whispered|called|thought)\b/i;

function isExaminerTurnHandoff(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  return EXAMINER_PROMPT_HANDOFF_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Positive score favors Examiner (speaker2); negative favors Child (speaker1).
 */
function scoreExaminerLinguisticLikelihood(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 0;
  const isQuoted = QUOTED_SPEECH_RE.test(trimmed);
  const isQuestion = trimmed.endsWith('?');

  if (!isQuoted) {
    for (const pattern of STRONG_EXAMINER_PATTERNS) {
      if (pattern.test(trimmed)) {
        score += 1.4;
        break;
      }
    }

    if (isQuestion) {
      if (DIRECT_SECOND_PERSON_RE.test(trimmed) || score > 0) {
        score += 1.3;
      } else if (INTERROGATIVE_START_RE.test(trimmed)) {
        // Bare unquoted question without "you" or SLP prompt may be rhetorical in a monologue
        score += 0.55;
      } else {
        score += 0.35;
      }
    }
  }

  // Child language grammar patterns (overgeneralizations, omitted 3s, pronoun errors, mazes)
  if (correctSentence(trimmed) !== trimmed) {
    score -= 1.15;
  }

  return score;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ==================== STATISTICAL CLUSTERING & 1-vs-2 SPEAKER SELECTION ====================

// Physical single-speaker utterance-level baseline scales for vocal-tract features:
// [voicedCentroid_semitones, mfcc1..mfcc12].
// Note: mfcc1 (spectral slope) is downweighted so head turns / mic-distance tilt do not split a solo speaker.
const VT_SCALES = [2.6, 1.35, 0.75, 0.75, 0.75, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85];
const VT_WEIGHTS = [0.9, 0.35, 1.0, 0.95, 0.8, 0.65, 0.65, 0.8, 0.8, 0.7, 0.7, 0.8, 0.8];
const VT_DIM = VT_SCALES.length;

function buildVocalTractVector(f: SegmentAcousticFeatures): Float64Array {
  const v = new Float64Array(VT_DIM);
  v[0] = ((f.meanLogCentroid * 12) / VT_SCALES[0]) * VT_WEIGHTS[0];
  for (let c = 0; c < NUM_MFCC; c++) {
    v[1 + c] = (f.meanMfcc[c] / VT_SCALES[1 + c]) * VT_WEIGHTS[1 + c];
  }
  return v;
}

/**
 * Computes the weighted 1st Principal Component axis of `vecs` via deterministic
 * power iteration (zero label leakage, zero randomness).
 */
function computeFirstPrincipalAxis(
  vecs: Float64Array[],
  weights: number[]
): { mean: Float64Array; axis: Float64Array; projections: number[] } {
  const n = vecs.length;
  const dim = vecs[0].length;
  const mean = new Float64Array(dim);
  let wSum = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    wSum += w;
    const v = vecs[i];
    for (let d = 0; d < dim; d++) mean[d] += v[d] * w;
  }
  for (let d = 0; d < dim; d++) mean[d] /= Math.max(1e-9, wSum);

  // Deterministic non-degenerate initial direction: point farthest from the mean
  let maxNormSq = -1;
  let farthestIdx = 0;
  for (let i = 0; i < n; i++) {
    let normSq = 0;
    const v = vecs[i];
    for (let d = 0; d < dim; d++) {
      const diff = v[d] - mean[d];
      normSq += diff * diff;
    }
    if (normSq > maxNormSq) {
      maxNormSq = normSq;
      farthestIdx = i;
    }
  }

  const axis = new Float64Array(dim);
  if (maxNormSq > 1e-12) {
    const invNorm = 1 / Math.sqrt(maxNormSq);
    for (let d = 0; d < dim; d++) {
      axis[d] = (vecs[farthestIdx][d] - mean[d]) * invNorm;
    }
  } else {
    axis[0] = 1;
  }

  for (let iter = 0; iter < 25; iter++) {
    const next = new Float64Array(dim);
    for (let i = 0; i < n; i++) {
      const v = vecs[i];
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += (v[d] - mean[d]) * axis[d];
      const wd = weights[i] * dot;
      for (let d = 0; d < dim; d++) next[d] += wd * (v[d] - mean[d]);
    }
    let normSq = 0;
    for (let d = 0; d < dim; d++) normSq += next[d] * next[d];
    const norm = Math.sqrt(normSq);
    if (norm < 1e-12) break;
    for (let d = 0; d < dim; d++) axis[d] = next[d] / norm;
  }

  const projections = vecs.map((v) => {
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += (v[d] - mean[d]) * axis[d];
    return dot;
  });

  return { mean, axis, projections };
}

interface Gmm1DResult {
  twoDeltaLL: number;
  gap: number;
  std: number;
  d: number;
  valid: boolean;
}

/**
 * Unsupervised weighted 1D 2-component shared-variance EM Gaussian Mixture vs
 * 1-component Gaussian. Because it operates on an unsupervised 1D projection,
 * it is immune to 2D correlation artifacts and post-clustering label leakage.
 */
function fitGmm1D(vals: number[], weights: number[], minStd: number): Gmm1DResult {
  const n = vals.length;
  const minCount = n >= 6 ? 2 : 1;
  let wSum = 0;
  for (let i = 0; i < n; i++) wSum += weights[i];
  const avgW = wSum / n;

  let mu1 = 0;
  for (let i = 0; i < n; i++) mu1 += weights[i] * vals[i];
  mu1 /= wSum;

  let var1 = 0;
  for (let i = 0; i < n; i++) var1 += weights[i] * (vals[i] - mu1) ** 2;
  const minVar = minStd * minStd;
  var1 = Math.max(minVar, var1 / wSum);

  let ll1 = 0;
  const log2Pi = Math.log(2 * Math.PI);
  for (let i = 0; i < n; i++) {
    ll1 += (weights[i] / avgW) * (-0.5 * (log2Pi + Math.log(var1) + (vals[i] - mu1) ** 2 / var1));
  }

  const ord = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const seeds: Array<[number, number, number]> = [
    [ord[Math.floor(n * 0.15)], ord[Math.min(n - 1, Math.floor(n * 0.85))], 0.5],
    [ord[0], ord[Math.min(n - 1, Math.floor(n * 0.65))], 0.2],
    [ord[Math.floor(n * 0.35)], ord[n - 1], 0.8],
    [ord[Math.floor(n * 0.25)], ord[Math.min(n - 1, Math.floor(n * 0.75))], 0.5],
  ];

  let bestLL = ll1;
  let bestMA = mu1;
  let bestMB = mu1;
  let bestV = var1;
  let bestValid = false;

  for (const [iA, iB, initPi] of seeds) {
    if (iA === iB || Math.abs(vals[iA] - vals[iB]) < 1e-6) continue;
    let mA = vals[iA];
    let mB = vals[iB];
    let v = Math.max(minVar, var1 * 0.35);
    let piA = initPi;
    let ll = ll1;
    let ok = true;
    const resp = new Array<number>(n).fill(0.5);

    for (let iter = 0; iter < 40; iter++) {
      ll = 0;
      const logPiA = Math.log(Math.max(1e-6, piA));
      const logPiB = Math.log(Math.max(1e-6, 1 - piA));
      const normConst = -0.5 * (log2Pi + Math.log(v));

      for (let i = 0; i < n; i++) {
        const lA = logPiA + normConst - (0.5 * (vals[i] - mA) ** 2) / v;
        const lB = logPiB + normConst - (0.5 * (vals[i] - mB) ** 2) / v;
        const mx = Math.max(lA, lB);
        const den = mx + Math.log(Math.exp(lA - mx) + Math.exp(lB - mx));
        ll += (weights[i] / avgW) * den;
        resp[i] = Math.exp(lA - den);
      }

      let wA = 0;
      let wB = 0;
      let sA = 0;
      let sB = 0;
      let cA = 0;
      let cB = 0;
      for (let i = 0; i < n; i++) {
        const rA = resp[i];
        const rB = 1 - rA;
        const w = weights[i];
        wA += w * rA;
        wB += w * rB;
        sA += w * rA * vals[i];
        sB += w * rB * vals[i];
        if (rA >= 0.5) cA++;
        else cB++;
      }
      if (cA < minCount || cB < minCount || wA < 1e-6 || wB < 1e-6) {
        ok = false;
        break;
      }
      mA = sA / wA;
      mB = sB / wB;
      piA = clamp(wA / wSum, 0.06, 0.94);

      let sv = 0;
      for (let i = 0; i < n; i++) {
        sv += weights[i] * (resp[i] * (vals[i] - mA) ** 2 + (1 - resp[i]) * (vals[i] - mB) ** 2);
      }
      v = Math.max(minVar, sv / wSum);
    }

    if (ok && ll > bestLL) {
      let cA = 0;
      let cB = 0;
      for (let i = 0; i < n; i++) {
        if (resp[i] >= 0.5) cA++;
        else cB++;
      }
      if (cA >= minCount && cB >= minCount) {
        bestLL = ll;
        bestMA = mA;
        bestMB = mB;
        bestV = v;
        bestValid = true;
      }
    }
  }

  const gap = Math.abs(bestMA - bestMB);
  const std = Math.sqrt(bestV);
  return {
    twoDeltaLL: Math.max(0, 2 * (bestLL - ll1)),
    gap,
    std,
    d: std > 1e-9 ? gap / std : 0,
    valid: bestValid,
  };
}

interface Cluster2DGmmResult {
  resp: number[];
  mA: [number, number];
  mB: [number, number];
  v: [number, number];
  piA: number;
}

/**
 * Weighted 2D diagonal shared-variance 2-component EM-GMM in [F0_semitones, VT_PC1].
 * Keeps glottal source (F0) and vocal-tract filter (VT_PC1) balanced 1:1 and uses
 * mixing proportions (piA) to cleanly handle both balanced and asymmetric (e.g. 20:3) sessions.
 */
function cluster2DDiagGmm(
  pts: Array<[number, number]>,
  weights: number[],
  minStds: [number, number],
  allowSingleton = false
): Cluster2DGmmResult | null {
  const n = pts.length;
  const minCount = allowSingleton ? 1 : n >= 6 ? 2 : 1;
  const minV0 = minStds[0] * minStds[0];
  const minV1 = minStds[1] * minStds[1];
  let wSum = 0;
  for (let i = 0; i < n; i++) wSum += weights[i];
  const avgW = wSum / n;

  let mu0 = 0;
  let mu1 = 0;
  for (let i = 0; i < n; i++) {
    mu0 += weights[i] * pts[i][0];
    mu1 += weights[i] * pts[i][1];
  }
  mu0 /= wSum;
  mu1 /= wSum;

  let var0 = 0;
  let var1 = 0;
  for (let i = 0; i < n; i++) {
    var0 += weights[i] * (pts[i][0] - mu0) ** 2;
    var1 += weights[i] * (pts[i][1] - mu1) ** 2;
  }
  var0 = Math.max(minV0, var0 / wSum);
  var1 = Math.max(minV1, var1 / wSum);
  const std0 = Math.sqrt(var0);
  const std1 = Math.sqrt(var1);

  const by0 = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0]);
  const by1 = pts.map((_, i) => i).sort((a, b) => pts[a][1] - pts[b][1]);
  const bySum = pts
    .map((_, i) => i)
    .sort((a, b) => pts[a][0] / std0 + pts[a][1] / std1 - (pts[b][0] / std0 + pts[b][1] / std1));
  const byDiff = pts
    .map((_, i) => i)
    .sort((a, b) => pts[a][0] / std0 - pts[a][1] / std1 - (pts[b][0] / std0 - pts[b][1] / std1));

  const seeds: Array<[number, number, number]> = [];
  for (const ord of [by0, by1, bySum, byDiff]) {
    seeds.push([ord[Math.floor(n * 0.15)], ord[Math.min(n - 1, Math.floor(n * 0.85))], 0.5]);
    if (n >= 8) {
      seeds.push([ord[0], ord[Math.floor(n * 0.65)], 0.16]);
      seeds.push([ord[Math.floor(n * 0.35)], ord[n - 1], 0.84]);
    }
  }

  const log2Pi2 = 2 * Math.log(2 * Math.PI);
  let bestLL = Number.NEGATIVE_INFINITY;
  let best: Cluster2DGmmResult | null = null;

  for (const [iA, iB, initPi] of seeds) {
    if (iA === iB) continue;
    let mA0 = pts[iA][0];
    let mA1 = pts[iA][1];
    let mB0 = pts[iB][0];
    let mB1 = pts[iB][1];
    let v0 = Math.max(minV0, var0 * 0.45);
    let v1 = Math.max(minV1, var1 * 0.45);
    let piA = initPi;
    let ll = Number.NEGATIVE_INFINITY;
    let ok = true;
    const resp = new Array<number>(n).fill(0.5);

    for (let iter = 0; iter < 40; iter++) {
      ll = 0;
      const logPiA = Math.log(Math.max(1e-6, piA));
      const logPiB = Math.log(Math.max(1e-6, 1 - piA));
      const normConst = -0.5 * (log2Pi2 + Math.log(v0) + Math.log(v1));

      for (let i = 0; i < n; i++) {
        const p0 = pts[i][0];
        const p1 = pts[i][1];
        const lA = logPiA + normConst - 0.5 * ((p0 - mA0) ** 2 / v0 + (p1 - mA1) ** 2 / v1);
        const lB = logPiB + normConst - 0.5 * ((p0 - mB0) ** 2 / v0 + (p1 - mB1) ** 2 / v1);
        const mx = Math.max(lA, lB);
        const den = mx + Math.log(Math.exp(lA - mx) + Math.exp(lB - mx));
        ll += (weights[i] / avgW) * den;
        resp[i] = Math.exp(lA - den);
      }

      let wA = 0;
      let wB = 0;
      let cA = 0;
      let cB = 0;
      let sA0 = 0;
      let sA1 = 0;
      let sB0 = 0;
      let sB1 = 0;
      for (let i = 0; i < n; i++) {
        const rA = resp[i];
        const rB = 1 - rA;
        const w = weights[i];
        wA += w * rA;
        wB += w * rB;
        if (rA >= 0.5) cA++;
        else cB++;
        sA0 += w * rA * pts[i][0];
        sA1 += w * rA * pts[i][1];
        sB0 += w * rB * pts[i][0];
        sB1 += w * rB * pts[i][1];
      }

      if (cA < minCount || cB < minCount || wA < 1e-6 || wB < 1e-6) {
        ok = false;
        break;
      }

      mA0 = sA0 / wA;
      mA1 = sA1 / wA;
      mB0 = sB0 / wB;
      mB1 = sB1 / wB;
      piA = clamp(wA / wSum, 0.06, 0.94);

      let sv0 = 0;
      let sv1 = 0;
      for (let i = 0; i < n; i++) {
        const rA = resp[i];
        const rB = 1 - rA;
        const w = weights[i];
        sv0 += w * (rA * (pts[i][0] - mA0) ** 2 + rB * (pts[i][0] - mB0) ** 2);
        sv1 += w * (rA * (pts[i][1] - mA1) ** 2 + rB * (pts[i][1] - mB1) ** 2);
      }
      v0 = Math.max(minV0, sv0 / wSum);
      v1 = Math.max(minV1, sv1 / wSum);
    }

    if (ok && ll > bestLL) {
      let cA = 0;
      let cB = 0;
      for (let i = 0; i < n; i++) {
        if (resp[i] >= 0.5) cA++;
        else cB++;
      }
      if (cA >= minCount && cB >= minCount) {
        bestLL = ll;
        best = {
          resp: [...resp],
          mA: [mA0, mA1],
          mB: [mB0, mB1],
          v: [v0, v1],
          piA,
        };
      }
    }
  }

  return best;
}

function posteriorCluster02DGmm(pt: [number, number], model: Cluster2DGmmResult): number {
  const lA =
    Math.log(Math.max(1e-6, model.piA)) -
    0.5 * ((pt[0] - model.mA[0]) ** 2 / model.v[0] + (pt[1] - model.mA[1]) ** 2 / model.v[1]);
  const lB =
    Math.log(Math.max(1e-6, 1 - model.piA)) -
    0.5 * ((pt[0] - model.mB[0]) ** 2 / model.v[0] + (pt[1] - model.mB[1]) ** 2 / model.v[1]);
  const mx = Math.max(lA, lB);
  const den = mx + Math.log(Math.exp(lA - mx) + Math.exp(lB - mx));
  return Math.exp(lA - den);
}

/**
 * Automatically assign Speaker 1 (Child) vs Speaker 2 (Examiner) to timestamped
 * utterances using on-device voiced acoustic clustering (YIN F0 pitch + voiced formant
 * centroid + 12 voiced MFCCs via 2D EM-GMM) with unsupervised 1D bimodality verification
 * so 1-speaker monologues are not split into spurious speaker turns.
 */
export function diarizeSpeakerSegments(
  audio: Float32Array,
  segments: TimedUtterance[],
  sampleRate = WHISPER_SAMPLE_RATE,
  mode: SpeakerDetectionMode = 'auto'
): DiarizationResult {
  const n = segments.length;
  if (n === 0) {
    return { roles: [], speakerCount: 1 };
  }
  if (mode === 'single') {
    return { roles: new Array<SpeakerRole>(n).fill('speaker1'), speakerCount: 1 };
  }
  if (n === 1) {
    const role: SpeakerRole =
      scoreExaminerLinguisticLikelihood(segments[0].text) >= 1.4 ? 'speaker2' : 'speaker1';
    return { roles: [role], speakerCount: 1 };
  }

  const features = segments.map((seg) =>
    extractSegmentFeatures(audio, seg.startSec, seg.endSec, sampleRate)
  );

  // Prefer segments with >= 3 voiced frames for estimating speaker models; fall back to >= 2 if sparse
  let coreIndices = features.map((f, idx) => (f.core ? idx : -1)).filter((idx) => idx >= 0);
  if (coreIndices.length < 2) {
    coreIndices = features.map((f, idx) => (f.valid ? idx : -1)).filter((idx) => idx >= 0);
  }

  if (coreIndices.length < 2) {
    const roles = assignRolesFromTextList(
      segments.map((s) => s.text),
      mode
    );
    const unique = new Set(roles);
    return {
      roles,
      speakerCount: unique.size > 1 ? 2 : 1,
    };
  }

  const m = coreIndices.length;
  const segWeights = coreIndices.map((idx) => Math.min(24, Math.max(1, features[idx].voicedFrames)));
  const f0Vals = coreIndices.map((idx) => (features[idx].medianLogF0 ?? Math.log2(200)) * 12);

  // Unsupervised vocal-tract PC1 across voiced centroid + voiced MFCCs
  const vtVecs = coreIndices.map((idx) => buildVocalTractVector(features[idx]));
  const vtPca = computeFirstPrincipalAxis(vtVecs, segWeights);
  const vtPc1 = vtPca.projections;

  const pts2D: Array<[number, number]> = coreIndices.map((_, i) => [f0Vals[i], vtPc1[i]]);
  let clusterModel = cluster2DDiagGmm(pts2D, segWeights, [2.0, 1.75], false);

  // If the user explicitly forced 2-speaker mode and EM collapsed, fall back to a clean median split along joint PC1
  if (!clusterModel && mode === 'two') {
    clusterModel = cluster2DDiagGmm(pts2D, segWeights, [1.2, 1.2], true);
  }

  if (!clusterModel) {
    if (mode === 'two') {
      const roles = assignRolesFromTextList(
        segments.map((s) => s.text),
        'two'
      );
      return { roles, speakerCount: new Set(roles).size > 1 ? 2 : 1 };
    }
    const avgExaminer =
      segments.reduce((s, seg) => s + scoreExaminerLinguisticLikelihood(seg.text), 0) / n;
    const soloRole: SpeakerRole = avgExaminer >= 1.35 ? 'speaker2' : 'speaker1';
    return { roles: new Array<SpeakerRole>(n).fill(soloRole), speakerCount: 1 };
  }

  const c0Local: number[] = [];
  const c1Local: number[] = [];
  for (let i = 0; i < m; i++) {
    if (clusterModel.resp[i] >= 0.5) c0Local.push(i);
    else c1Local.push(i);
  }

  if (c0Local.length === 0 || c1Local.length === 0) {
    return { roles: new Array<SpeakerRole>(n).fill('speaker1'), speakerCount: 1 };
  }

  const f0Med0 = median(c0Local.map((i) => f0Vals[i]));
  const f0Med1 = median(c1Local.map((i) => f0Vals[i]));
  const f0Gap = Math.abs(f0Med0 - f0Med1);
  const vtGap = Math.abs(
    median(c0Local.map((i) => vtPc1[i])) - median(c1Local.map((i) => vtPc1[i]))
  );

  let hasTwoSpeakers = mode === 'two';

  if (mode === 'auto') {
    const minClusterSize = Math.min(c0Local.length, c1Local.length);
    const minRequiredCount = m >= 4 ? 2 : 1;

    // Unsupervised 1D projections (immune to 2D correlation artifacts & clustering label leakage)
    const joint2D = coreIndices.map(
      (_, i) => new Float64Array([(f0Vals[i] / 2.6) * 1.4, vtPc1[i] / 2.2])
    );
    const jointPc1 = computeFirstPrincipalAxis(joint2D, segWeights).projections;
    const gmmJoint = fitGmm1D(jointPc1, segWeights, 1.25);
    const gmmF0 = fitGmm1D(f0Vals, segWeights, 2.0);

    // Check whether clinical SLP linguistic cues align with the lower-pitched (Examiner) cluster
    const lowerLocal = f0Med0 <= f0Med1 ? c0Local : c1Local;
    const higherLocal = f0Med0 <= f0Med1 ? c1Local : c0Local;
    const lowExAvg =
      lowerLocal.reduce(
        (s, i) => s + scoreExaminerLinguisticLikelihood(segments[coreIndices[i]].text),
        0
      ) / lowerLocal.length;
    const highExAvg =
      higherLocal.reduce(
        (s, i) => s + scoreExaminerLinguisticLikelihood(segments[coreIndices[i]].text),
        0
      ) / higherLocal.length;
    const lingAlign = lowExAvg - highExAvg;

    // BIC-aware log-likelihood threshold scales cleanly with ln(m) across short and long recordings
    const llThresh = Math.max(3.8, 1.85 * Math.log(m));
    const voiceContrastLLThresh = Math.max(1.8, 0.85 * Math.log(m));

    // 1. Clear unsupervised bimodality along combined [F0, vocal-tract] PC1 with meaningful F0 separation
    const bimodalJoint =
      minClusterSize >= minRequiredCount &&
      gmmJoint.valid &&
      gmmJoint.twoDeltaLL >= llThresh &&
      gmmJoint.d >= 3.2 &&
      f0Gap >= 3.8;

    // 2. Large vocal-register contrast (e.g., Male vs Female or Child vs Male) confirmed by both 1D F0 and joint PC1
    const strongVoiceContrast =
      minClusterSize >= minRequiredCount &&
      f0Gap >= 6.5 &&
      gmmF0.valid &&
      gmmF0.twoDeltaLL >= voiceContrastLLThresh &&
      gmmF0.d >= 3.0 &&
      gmmJoint.valid &&
      gmmJoint.twoDeltaLL >= voiceContrastLLThresh &&
      gmmJoint.d >= 3.0;

    // 3. Very short clips (2-5 utterances) where asymptotic BIC has low statistical power
    const shortClipStrong =
      m <= 5 &&
      minClusterSize >= minRequiredCount &&
      f0Gap >= 5.8 &&
      (vtGap >= 2.5 || f0Gap >= 8.5 || lingAlign >= 1.0);

    // 4. Close-voice clinical SLP pairs (e.g., Child + Female SLP):
    //    Moderate acoustic separation in BOTH pitch & vocal tract reinforced by real SLP prompts in the lower-F0 cluster
    const clinicalAligned =
      minClusterSize >= minRequiredCount &&
      lowExAvg >= 0.8 &&
      lingAlign >= 0.85 &&
      f0Gap >= 3.0 &&
      vtGap >= 2.0 &&
      (gmmJoint.d >= 1.9 || (f0Gap >= 4.0 && vtGap >= 2.5));

    hasTwoSpeakers = bimodalJoint || strongVoiceContrast || shortClipStrong || clinicalAligned;
  }

  if (!hasTwoSpeakers) {
    const avgExaminer =
      segments.reduce((s, seg) => s + scoreExaminerLinguisticLikelihood(seg.text), 0) / n;
    const soloRole: SpeakerRole = avgExaminer >= 1.35 ? 'speaker2' : 'speaker1';
    return { roles: new Array<SpeakerRole>(n).fill(soloRole), speakerCount: 1 };
  }

  // Decide which cluster is Speaker 1 (Child) vs Speaker 2 (Examiner)
  // Higher pitch (F0) + brighter voiced formant resonance + child-speech grammar -> Child (speaker1)
  // Questions & SLP prompts -> Examiner (speaker2)
  const c0Members = c0Local.map((i) => coreIndices[i]);
  const c1Members = c1Local.map((i) => coreIndices[i]);

  const c0MedCent = median(c0Members.map((idx) => features[idx].meanLogCentroid));
  const c1MedCent = median(c1Members.map((idx) => features[idx].meanLogCentroid));

  const c0ExaminerAvg =
    c0Members.reduce((s, idx) => s + scoreExaminerLinguisticLikelihood(segments[idx].text), 0) /
    c0Members.length;
  const c1ExaminerAvg =
    c1Members.reduce((s, idx) => s + scoreExaminerLinguisticLikelihood(segments[idx].text), 0) /
    c1Members.length;

  const pitchAdvantageForC0 = clamp((f0Med0 - f0Med1) / 2.5, -3.5, 3.5) * 1.4;
  const centroidAdvantageForC0 = clamp(((c0MedCent - c1MedCent) * 12) / 3.0, -2.5, 2.5) * 0.85;
  const linguisticAdvantageForC0 = clamp(c1ExaminerAvg - c0ExaminerAvg, -2.5, 2.5) * 1.35;

  const c0ChildScore = pitchAdvantageForC0 + centroidAdvantageForC0 + linguisticAdvantageForC0;
  const childCluster: 0 | 1 = c0ChildScore >= 0 ? 0 : 1;

  const childExAvg = childCluster === 0 ? c0ExaminerAvg : c1ExaminerAvg;
  const examinerExAvg = childCluster === 0 ? c1ExaminerAvg : c0ExaminerAvg;
  // Only apply gentle linguistic tie-breaking when the confirmed 2-speaker session exhibits
  // genuine clinical Examiner/Child role asymmetry (leaves non-clinical 2-speaker audio 100% acoustic).
  const lingTieBreakWeight = examinerExAvg - childExAvg >= 0.5 ? 0.85 : 0;

  const coreIndexToLocal = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    coreIndexToLocal.set(coreIndices[i], i);
  }

  const roles: Array<SpeakerRole | null> = new Array(n).fill(null);

  const assignFromChildPosterior = (
    idx: number,
    pChildAcoustic: number,
    text: string
  ): SpeakerRole => {
    const p = clamp(pChildAcoustic, 1e-4, 1 - 1e-4);
    const acousticLogOdds = Math.log(p / (1 - p));
    if (lingTieBreakWeight <= 0) {
      return acousticLogOdds >= 0 ? 'speaker1' : 'speaker2';
    }
    const textScore = scoreExaminerLinguisticLikelihood(text);
    const lingAdj = -lingTieBreakWeight * clamp(textScore, -2.0, 2.5);
    const followsExaminerPrompt =
      idx > 0 &&
      roles[idx - 1] === 'speaker2' &&
      isExaminerTurnHandoff(segments[idx - 1].text) &&
      textScore <= 0.1;
    const handoffAdj = followsExaminerPrompt ? 0.85 : 0;
    return acousticLogOdds + lingAdj + handoffAdj >= 0 ? 'speaker1' : 'speaker2';
  };

  // Assign core and remaining valid voiced utterances in chronological order so
  // borderline responses immediately following an Examiner prompt get turn context.
  for (let idx = 0; idx < n; idx++) {
    const localIdx = coreIndexToLocal.get(idx);
    if (localIdx !== undefined) {
      const pChild =
        childCluster === 0 ? clusterModel.resp[localIdx] : 1 - clusterModel.resp[localIdx];
      roles[idx] = assignFromChildPosterior(idx, pChild, segments[idx].text);
      continue;
    }

    const f = features[idx];
    if (f.valid && f.medianLogF0 !== null) {
      const vtVec = buildVocalTractVector(f);
      let vtProj = 0;
      for (let d = 0; d < VT_DIM; d++) {
        vtProj += (vtVec[d] - vtPca.mean[d]) * vtPca.axis[d];
      }
      const p0 = posteriorCluster02DGmm([f.medianLogF0 * 12, vtProj], clusterModel);
      const pChild = childCluster === 0 ? p0 : 1 - p0;
      roles[idx] = assignFromChildPosterior(idx, pChild, segments[idx].text);
    }
  }

  // Fill any unvoiced/very short utterances using strict clinical cues & conversational turn context
  for (let i = 0; i < n; i++) {
    if (roles[i] !== null) continue;
    const textScore = scoreExaminerLinguisticLikelihood(segments[i].text);
    if (textScore >= 1.2) {
      roles[i] = 'speaker2';
    } else if (textScore <= -0.8) {
      roles[i] = 'speaker1';
    } else if (i > 0 && roles[i - 1] !== null) {
      const prevRole = roles[i - 1]!;
      const prevHandoff = prevRole === 'speaker2' && isExaminerTurnHandoff(segments[i - 1].text);
      const prevQuestion = segments[i - 1].text.trim().endsWith('?');
      roles[i] =
        prevHandoff || prevQuestion ? (prevRole === 'speaker1' ? 'speaker2' : 'speaker1') : prevRole;
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
 *
 * In 'auto' mode, avoids splitting a 1-speaker monologue into spurious examiner turns when
 * there are no genuine SLP examiner prompts/direct-address questions.
 */
export function assignRolesFromTextList(
  lines: string[],
  mode: SpeakerDetectionMode = 'auto'
): SpeakerRole[] {
  const n = lines.length;
  if (n === 0) return [];
  if (mode === 'single') {
    return new Array<SpeakerRole>(n).fill('speaker1');
  }

  const scores = lines.map((line) => scoreExaminerLinguisticLikelihood(line));
  const strongExaminerFlags = lines.map((line, i) => {
    const t = line.trim();
    const isQuoted = QUOTED_SPEECH_RE.test(t);
    const hasExplicitPrompt = !isQuoted && STRONG_EXAMINER_PATTERNS.some((p) => p.test(t));
    return scores[i] >= 1.2 || hasExplicitPrompt;
  });

  if (mode === 'auto') {
    const strongExaminerCount = strongExaminerFlags.filter(Boolean).length;
    const nonExaminerCount = scores.filter((s) => s <= 0.25).length;

    // If no clear examiner prompts exist at all, treat as a 1-speaker monologue
    if (strongExaminerCount === 0) {
      return new Array<SpeakerRole>(n).fill('speaker1');
    }
    // If every utterance is an examiner prompt, treat as a 1-speaker examiner clip
    if (nonExaminerCount === 0) {
      return new Array<SpeakerRole>(n).fill('speaker2');
    }
  }

  const roles: SpeakerRole[] = [];
  let currentRole: SpeakerRole = 'speaker1';

  for (let i = 0; i < n; i++) {
    const score = scores[i];

    if (strongExaminerFlags[i]) {
      currentRole = 'speaker2';
    } else if (score <= -0.8) {
      currentRole = 'speaker1';
    } else if (i > 0 && roles[i - 1] === 'speaker2' && isExaminerTurnHandoff(lines[i - 1])) {
      // Response following an examiner question, prompt ("Tell me..."), or backchannel belongs to Speaker 1
      currentRole = 'speaker1';
    } else if (i > 0 && lines[i - 1].trim().endsWith('?') && roles[i - 1] === 'speaker1') {
      // Only flip after a Speaker 1 question if we are in explicit 2-speaker conversation context
      currentRole = mode === 'two' ? 'speaker2' : 'speaker1';
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
 * Builds non-overlapping TimedUtterance ranges from parsed transcript lines.
 * Consecutive lines that share the exact same `[M:SS]` timestamp (e.g., multiple
 * sentences split from a single Whisper chunk) are distributed proportionally across
 * the span until the next distinct timestamp instead of colliding on the first 0.6 s.
 */
function buildTimedUtterancesFromLines(
  nonEmpty: Array<{ timestampSec: number | null; body: string }>,
  totalDuration: number
): TimedUtterance[] {
  const count = nonEmpty.length;
  const timed: TimedUtterance[] = new Array(count);

  let i = 0;
  while (i < count) {
    const startTs = nonEmpty[i].timestampSec;
    if (startTs === null) {
      const startSec = (i / count) * totalDuration;
      const endSec = Math.min(totalDuration, Math.max(startSec + 0.6, ((i + 1) / count) * totalDuration));
      timed[i] = { startSec, endSec, text: nonEmpty[i].body };
      i++;
      continue;
    }

    // Group any consecutive lines that share this exact timestamp
    let j = i + 1;
    while (j < count && nonEmpty[j].timestampSec === startTs) {
      j++;
    }

    const nextTs =
      j < count && nonEmpty[j].timestampSec !== null ? nonEmpty[j].timestampSec! : totalDuration;
    const groupStart = Math.max(0, Math.min(totalDuration, startTs));
    const groupEnd = Math.min(totalDuration, Math.max(groupStart + 0.6, nextTs));
    const groupSpan = Math.max(0.25, groupEnd - groupStart);

    if (j - i === 1) {
      timed[i] = { startSec: groupStart, endSec: groupEnd, text: nonEmpty[i].body };
    } else {
      const weights: number[] = [];
      let totalWeight = 0;
      for (let k = i; k < j; k++) {
        const w = Math.max(4, nonEmpty[k].body.replace(/\s+/g, '').length);
        weights.push(w);
        totalWeight += w;
      }
      let cursor = groupStart;
      for (let k = i; k < j; k++) {
        const frac = weights[k - i] / totalWeight;
        const subEnd = k === j - 1 ? groupEnd : cursor + groupSpan * frac;
        timed[k] = {
          startSec: cursor,
          endSec: Math.min(totalDuration, Math.max(cursor + 0.25, subEnd)),
          text: nonEmpty[k].body,
        };
        cursor = subEnd;
      }
    }

    i = j;
  }

  return timed;
}

/**
 * Auto-assign speaker labels across an existing transcript string, using acoustic
 * diarization when 16 kHz audio and timestamps are available, or clinical text heuristics otherwise.
 */
export function autoAssignSpeakersInTranscript(
  text: string,
  aliases: SpeakerAliases,
  audio16k?: Float32Array | null,
  sampleRate = WHISPER_SAMPLE_RATE,
  options?: AutoAssignSpeakersOptions
): { transcript: string; speakerCount: 1 | 2; method: 'acoustic' | 'text' } {
  const parsed = parseUtteranceLines(text, aliases);
  const nonEmpty = parsed.filter((line) => line.raw.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { transcript: text, speakerCount: 1, method: 'text' };
  }

  const mode: SpeakerDetectionMode = options?.mode ?? 'auto';
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  if (mode === 'single') {
    const updated = parsed
      .map((line) => {
        if (!line.raw.trim()) return line.raw;
        const tsLabel = line.timestampStr ? `[${line.timestampStr}]` : null;
        return [tsLabel, s1, line.body].filter(Boolean).join(' ');
      })
      .join('\n');
    return { transcript: updated, speakerCount: 1, method: 'text' };
  }

  const hasExactSegments = Boolean(
    options?.exactSegments && options.exactSegments.length === nonEmpty.length
  );
  const hasAudioAndTimestamps =
    Boolean(audio16k && audio16k.length >= FRAME_SIZE * 2) &&
    (hasExactSegments ||
      nonEmpty.filter((l) => l.timestampSec !== null).length >= Math.ceil(nonEmpty.length * 0.5));

  let assignedRoles: SpeakerRole[];
  let speakerCount: 1 | 2;
  let method: 'acoustic' | 'text';

  if (hasAudioAndTimestamps && audio16k) {
    const totalDuration = audio16k.length / sampleRate;
    const timed: TimedUtterance[] = hasExactSegments
      ? options!.exactSegments!.map((seg, i) => ({
          startSec: Math.max(0, Math.min(totalDuration, seg.startSec)),
          endSec: Math.max(
            Math.max(0, Math.min(totalDuration, seg.startSec)) + 0.25,
            Math.min(totalDuration, seg.endSec)
          ),
          text: nonEmpty[i].body,
        }))
      : buildTimedUtterancesFromLines(nonEmpty, totalDuration);

    const result = diarizeSpeakerSegments(audio16k, timed, sampleRate, mode);
    assignedRoles = result.roles;
    speakerCount = result.speakerCount;
    method = 'acoustic';
  } else {
    assignedRoles = assignRolesFromTextList(
      nonEmpty.map((l) => l.body),
      mode
    );
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
