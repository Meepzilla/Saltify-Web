/**
 * Cross-platform on-device audio DSP helpers for Android, Windows, and iPadOS Safari.
 * Decodes WAV/MP3/M4A/MP4/WEBM/OGG via Web Audio API, performs peak loudness
 * normalization, resamples to 16 kHz mono Float32 for Whisper, encodes 16-bit
 * PCM WAV for universal download/playback, and extracts compact waveform peaks.
 */

export interface DecodedAudioResult {
  mono16k: Float32Array;
  duration: number;
  originalSampleRate: number;
  waveformPeaks: number[];
  wavBlob: Blob;
}

/**
 * Peak-normalizes a Float32 PCM signal to a target peak (default 0.92, ~ -0.7 dBFS),
 * mirroring pydub.effects.normalize() in oss-slu/SpeechTranscription audio.py.
 */
export function normalizeFloat32Audio(
  samples: Float32Array,
  targetPeak = 0.92
): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  if (maxAbs < 1e-5) {
    return new Float32Array(samples);
  }

  const gain = targetPeak / maxAbs;
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    output[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return output;
}

/**
 * Smooth soft-knee peak limiter. Transparent below `threshold`, smoothly
 * compresses peaks asymptotically toward `ceiling` (< 1.0) so loud coughs or
 * mic bumps never cause harsh digital clipping when boosting quiet child speech.
 */
export function softLimitSample(
  sample: number,
  threshold = 0.78,
  ceiling = 0.97
): number {
  const abs = Math.abs(sample);
  if (abs <= threshold) return sample;
  const headroom = Math.max(0.01, ceiling - threshold);
  const limited = threshold + headroom * Math.tanh((abs - threshold) / headroom);
  return sample < 0 ? -limited : limited;
}

/**
 * Applies a linear gain multiplier with smooth soft-knee limiting so boosted
 * audio stays loud and clear without harsh clipping.
 */
export function applySoftLimitedGain(
  samples: Float32Array,
  gain: number
): Float32Array {
  const output = new Float32Array(samples.length);
  if (gain <= 0) return output;
  for (let i = 0; i < samples.length; i++) {
    output[i] = softLimitSample(samples[i] * gain);
  }
  return output;
}

/**
 * Clinical speech-loudness normalizer using active-frame RMS leveling + soft limiter.
 * Unlike peak-only normalization (where a single table bump or plosive leaves a
 * soft-spoken child barely audible), this measures active speech energy across
 * 50 ms frames, lifts typical speech to ~ -13 dBFS (targetRms = 0.22), and
 * gently soft-limits transient spikes.
 */
export function normalizeSpeechLoudness(
  samples: Float32Array,
  sampleRate = 16000,
  targetRms = 0.22,
  maxGain = 16
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);

  const frameSize = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms frames
  const frameRms: number[] = [];
  let maxFrameRms = 0;

  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / (end - start));
    frameRms.push(rms);
    if (rms > maxFrameRms) maxFrameRms = rms;
  }

  if (maxFrameRms < 1e-5) {
    return new Float32Array(samples);
  }

  // Keep non-silent speech frames (> 12% of loudest frame and above noise floor)
  const activityFloor = Math.max(1e-4, maxFrameRms * 0.12);
  const activeFrames = frameRms.filter((r) => r >= activityFloor).sort((a, b) => a - b);

  // Use 65th-percentile active frame RMS so neither silence nor isolated clicks dominate
  const referenceRms =
    activeFrames.length > 0
      ? activeFrames[Math.min(activeFrames.length - 1, Math.floor(activeFrames.length * 0.65))]
      : maxFrameRms;

  if (referenceRms < 1e-5) {
    return new Float32Array(samples);
  }

  const rawGain = targetRms / referenceRms;
  const clampedGain = Math.max(0.25, Math.min(maxGain, rawGain));
  return applySoftLimitedGain(samples, clampedGain);
}

/**
 * Extracts downsampled peak amplitudes (0..1) for smooth high-DPI canvas rendering.
 */
export function extractWaveformPeaks(
  samples: Float32Array,
  numBars = 280
): number[] {
  if (samples.length === 0) return [];
  const count = Math.min(numBars, samples.length);
  const blockSize = samples.length / count;
  const peaks: number[] = new Array(count);
  let maxPeak = 0.001;

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * blockSize);
    const end = Math.min(samples.length, Math.floor((i + 1) * blockSize));
    let peak = 0;
    // Stride sampling for huge buffers to keep UI snappy on mobile/iPad
    const stride = Math.max(1, Math.floor((end - start) / 256));
    for (let j = start; j < end; j += stride) {
      const abs = Math.abs(samples[j]);
      if (abs > peak) peak = abs;
    }
    peaks[i] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }

  return peaks.map((p) => Number((p / maxPeak).toFixed(4)));
}

/**
 * Mixes multi-channel AudioBuffer into a single mono Float32Array.
 */
export function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }
  const mono = new Float32Array(length);
  const scale = 1 / numberOfChannels;
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] * scale;
    }
  }
  return mono;
}

/**
 * Resamples mono Float32 PCM to targetSampleRate (16,000 Hz for Whisper)
 * using OfflineAudioContext when available, with a clean linear-interpolation
 * fallback for headless/test environments.
 */
export async function resampleMono(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(samples);
  }

  const targetLength = Math.max(
    1,
    Math.round((samples.length * targetSampleRate) / sourceSampleRate)
  );

  // Prefer OfflineAudioContext for high-quality anti-aliased resampling on iPad/Android/Windows
  const OfflineCtx =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
      : undefined;

  if (OfflineCtx) {
    try {
      const offline = new OfflineCtx(1, targetLength, targetSampleRate);
      const buffer = offline.createBuffer(1, samples.length, sourceSampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      return new Float32Array(rendered.getChannelData(0));
    } catch {
      // Fall through to deterministic linear resampler
    }
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const output = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = samples[idx] ?? 0;
    const s1 = samples[Math.min(idx + 1, samples.length - 1)] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

/**
 * Encodes mono Float32 PCM (-1..1) into a standard 16-bit PCM WAV Blob.
 * Guarantees 100% playback & download compatibility across iPadOS, Android, and Windows.
 */
export function encodeWavBlob(
  samples: Float32Array,
  sampleRate: number
): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(int16), true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decodes any browser-supported audio Blob/File (WAV, MP3, M4A, MP4, WebM, OGG)
 * into normalized 16 kHz mono PCM, waveform peaks, and a universal WAV Blob.
 */
export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudioResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error('Web Audio API is not available in this browser.');
  }

  const ctx = new AudioCtx();
  try {
    // Copy buffer because Safari detaches ArrayBuffer inside decodeAudioData
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.duration <= 0) {
      throw new Error('The audio file appears to be empty.');
    }

    const monoOriginal = mixToMono(audioBuffer);
    const mono16kRaw = await resampleMono(monoOriginal, audioBuffer.sampleRate, 16000);
    const mono16k = normalizeSpeechLoudness(mono16kRaw, 16000);
    const waveformPeaks = extractWaveformPeaks(mono16k, 280);
    const wavBlob = encodeWavBlob(mono16k, 16000);

    return {
      mono16k,
      duration: audioBuffer.duration,
      originalSampleRate: audioBuffer.sampleRate,
      waveformPeaks,
      wavBlob,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('empty')) {
      throw err;
    }
    throw new Error(
      'Could not decode this audio file. Try a WAV, MP3, M4A, or WebM recording.'
    );
  } finally {
    await ctx.close().catch(() => {});
  }
}

export interface AudioChunkSlice {
  startSec: number;
  endSec: number;
  samples: Float32Array;
}

/**
 * Splits a 16 kHz mono PCM buffer into low-memory chunks (~26s target, max 30s)
 * preferring natural quiet pauses near chunk boundaries so child utterances
 * are not sliced mid-word. Keeps RAM low on iPadOS Safari & Android devices.
 */
export function sliceAudioIntoPauseAwareChunks(
  samples16k: Float32Array,
  sampleRate = 16000,
  targetChunkSec = 26,
  minChunkSec = 18,
  maxChunkSec = 29
): AudioChunkSlice[] {
  const totalSamples = samples16k.length;
  if (totalSamples === 0) return [];

  const maxSamples = maxChunkSec * sampleRate;
  if (totalSamples <= maxSamples) {
    return [
      {
        startSec: 0,
        endSec: totalSamples / sampleRate,
        samples: samples16k,
      },
    ];
  }

  const chunks: AudioChunkSlice[] = [];
  let cursor = 0;
  const frameSize = Math.floor(sampleRate * 0.1); // 100ms RMS window

  while (cursor < totalSamples) {
    const remaining = totalSamples - cursor;
    if (remaining <= maxSamples) {
      chunks.push({
        startSec: cursor / sampleRate,
        endSec: totalSamples / sampleRate,
        samples: samples16k.subarray(cursor, totalSamples),
      });
      break;
    }

    const searchStart = cursor + minChunkSec * sampleRate;
    const searchEnd = Math.min(totalSamples, cursor + maxSamples);
    const idealPoint = cursor + targetChunkSec * sampleRate;

    // Find lowest-energy 100ms window near targetChunkSec
    let bestSplit = idealPoint;
    let lowestScore = Number.POSITIVE_INFINITY;

    for (let pos = searchStart; pos + frameSize <= searchEnd; pos += frameSize) {
      let sumSq = 0;
      for (let j = pos; j < pos + frameSize; j++) {
        const s = samples16k[j];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / frameSize);
      const distancePenalty = Math.abs(pos - idealPoint) / (sampleRate * 40);
      const score = rms + distancePenalty * 0.02;
      if (score < lowestScore) {
        lowestScore = score;
        bestSplit = pos + Math.floor(frameSize / 2);
      }
    }

    chunks.push({
      startSec: cursor / sampleRate,
      endSec: bestSplit / sampleRate,
      samples: samples16k.subarray(cursor, bestSplit),
    });

    cursor = bestSplit;
  }

  return chunks;
}
