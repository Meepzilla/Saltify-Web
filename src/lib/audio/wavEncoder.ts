/**
 * Pure TypeScript Web Audio utilities:
 * - Audio decoding (cross-browser incl. iPad Safari webkitAudioContext)
 * - Loudness peak normalization (matching upstream pydub normalize)
 * - 16 kHz mono Float32Array resampling for on-device Whisper
 * - 16-bit PCM WAV encoding for universal download on iPad, Android, and Windows
 * - Interactive waveform peak extraction
 */

type AudioContextConstructor = typeof AudioContext;

function getAudioContextClass(): AudioContextConstructor {
  const win = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Ctor = win.AudioContext ?? win.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  return Ctor;
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctor = getAudioContextClass();
  const ctx = new Ctor();
  try {
    // Copy buffer because some Safari versions detach the input ArrayBuffer
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Peak-normalize mono audio samples to `targetPeak` (default -0.5 dB ≈ 0.94).
 */
export function normalizeSamples(samples: Float32Array, targetPeak = 0.94): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  const out = new Float32Array(samples.length);
  if (maxAbs < 1e-6) {
    out.set(samples);
    return out;
  }

  const gain = targetPeak / maxAbs;
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

/**
 * Downmix an AudioBuffer to mono Float32Array.
 */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }

  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / numberOfChannels;
    }
  }
  return mono;
}

/**
 * Pure linear resampler fallback (reliable on every iOS/iPadOS Safari version).
 */
export function linearResample(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate) {
    return new Float32Array(input);
  }
  const ratio = sourceRate / targetRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[Math.min(idx, input.length - 1)] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

/**
 * Resample any AudioBuffer to peak-normalized 16 kHz mono Float32Array required by Whisper.
 */
export async function prepareWhisperAudio(buffer: AudioBuffer): Promise<Float32Array> {
  const targetRate = 16000;
  let mono16k: Float32Array;

  if (buffer.sampleRate === targetRate) {
    mono16k = downmixToMono(buffer);
  } else if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const targetLength = Math.max(1, Math.ceil(buffer.duration * targetRate));
      const offline = new OfflineAudioContext(1, targetLength, targetRate);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      mono16k = new Float32Array(rendered.getChannelData(0));
    } catch {
      // iOS/iPadOS Safari occasionally rejects 16kHz OfflineAudioContext
      mono16k = linearResample(downmixToMono(buffer), buffer.sampleRate, targetRate);
    }
  } else {
    mono16k = linearResample(downmixToMono(buffer), buffer.sampleRate, targetRate);
  }

  return normalizeSamples(mono16k);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode mono Float32Array samples into a standard 16-bit PCM WAV Blob.
 */
export function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function encodeWavFromAudioBuffer(buffer: AudioBuffer, normalize = false): Blob {
  const mono = downmixToMono(buffer);
  const finalSamples = normalize ? normalizeSamples(mono) : mono;
  return encodeWavFromFloat32(finalSamples, buffer.sampleRate);
}

/**
 * Extract normalized peak amplitude buckets (0..1) for drawing a crisp interactive waveform.
 */
export function extractWaveformPeaks(buffer: AudioBuffer, bucketCount = 160): number[] {
  const samples = downmixToMono(buffer);
  return extractWaveformPeaksFromSamples(samples, bucketCount);
}

export function extractWaveformPeaksFromSamples(
  samples: Float32Array,
  bucketCount = 160
): number[] {
  if (samples.length === 0 || bucketCount <= 0) return [];
  const count = Math.min(bucketCount, samples.length);
  const blockSize = samples.length / count;
  const rawPeaks: number[] = [];
  let maxPeak = 0;

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * blockSize);
    const end = Math.min(samples.length, Math.floor((i + 1) * blockSize));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    rawPeaks.push(peak);
    if (peak > maxPeak) maxPeak = peak;
  }

  if (maxPeak < 1e-6) {
    return rawPeaks.map(() => 0.06);
  }
  return rawPeaks.map((p) => Math.max(0.06, p / maxPeak));
}
