import { describe, expect, it } from 'vitest';
import {
  encodeWavBlob,
  extractWaveformPeaks,
  normalizeFloat32Audio,
  sliceAudioIntoPauseAwareChunks,
} from '../audioProcessing';

describe('audioProcessing', () => {
  it('peak-normalizes quiet audio without clipping', () => {
    const quiet = new Float32Array([0.05, -0.1, 0.02, -0.05]);
    const norm = normalizeFloat32Audio(quiet, 0.9);
    const maxAbs = Math.max(...Array.from(norm, (v) => Math.abs(v)));
    expect(maxAbs).toBeCloseTo(0.9, 3);
  });

  it('encodes a valid RIFF/WAVE 16-bit PCM WAV blob', async () => {
    const samples = new Float32Array(1600); // 0.1s at 16kHz
    const blob = encodeWavBlob(samples, 16000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 1600 * 2);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const wave = String.fromCharCode(...bytes.slice(8, 12));
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
  });

  it('extracts normalized waveform peaks in 0..1 range', () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i * 0.1) * 0.5);
    const peaks = extractWaveformPeaks(samples, 50);
    expect(peaks.length).toBe(50);
    expect(Math.max(...peaks)).toBeCloseTo(1, 2);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
  });

  it('slices long audio at quiet pause boundaries', () => {
    const sr = 16000;
    // 55s signal with clear silence gap around 24.0s
    const samples = new Float32Array(55 * sr).fill(0.4);
    for (let i = 23.5 * sr; i < 24.5 * sr; i++) {
      samples[i] = 0.0;
    }
    const chunks = sliceAudioIntoPauseAwareChunks(samples, sr, 26, 18, 29);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBeGreaterThanOrEqual(23.4);
    expect(chunks[0].endSec).toBeLessThanOrEqual(24.6);
    expect(chunks[chunks.length - 1].endSec).toBeCloseTo(55, 1);
  });
});
