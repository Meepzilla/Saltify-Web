import { describe, expect, it } from 'vitest';
import {
  encodeWavFromFloat32,
  extractWaveformPeaksFromSamples,
  linearResample,
  normalizeSamples,
} from '../lib/audio/wavEncoder';

describe('Audio WAV encoder and normalization utilities', () => {
  it('peak-normalizes quiet audio without clipping', () => {
    const quiet = new Float32Array([0.1, -0.2, 0.05, -0.1]);
    const norm = normalizeSamples(quiet, 0.94);
    const maxAbs = Math.max(...Array.from(norm, (v) => Math.abs(v)));
    expect(maxAbs).toBeCloseTo(0.94, 4);
  });

  it('resamples 48kHz audio down to 16kHz cleanly', () => {
    const input = new Float32Array(48000);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const resampled = linearResample(input, 48000, 16000);
    expect(resampled.length).toBe(16000);
    expect(Math.max(...Array.from(resampled, Math.abs))).toBeGreaterThan(0.9);
  });

  it('writes a valid 16-bit mono PCM WAV header and payload', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wavBlob = encodeWavFromFloat32(samples, 16000);
    expect(wavBlob.type).toBe('audio/wav');

    const buffer = await wavBlob.arrayBuffer();
    expect(buffer.byteLength).toBe(44 + samples.length * 2);

    const view = new DataView(buffer);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sampleRate
    expect(view.getUint16(34, true)).toBe(16); // bitsPerSample
  });

  it('extracts normalized waveform amplitude buckets in [0.06, 1]', () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i / 20) * 0.5);
    const peaks = extractWaveformPeaksFromSamples(samples, 50);
    expect(peaks.length).toBe(50);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0.06);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
