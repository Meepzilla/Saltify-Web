import { describe, expect, it } from 'vitest';
import { buildSpeechSlices, detectSpeechRegions, packSpeechWindows, packedToSourceTime, recheckReplaces, sparseChunks, uncoveredPieces } from '../speechChunking';

const SR = 16000;
/** Tone bursts ("speech") at the given [start, end] seconds over faint noise. */
function synth(totalSec: number, bursts: Array<[number, number]>): Float32Array {
  const x = new Float32Array(totalSec * SR);
  let s = 3;
  for (let i = 0; i < x.length; i++) x[i] = (((s = (s * 16807) % 2147483647) / 2147483647) - 0.5) * 0.002;
  for (const [a, b] of bursts) for (let i = a * SR; i < b * SR; i++) x[i] += 0.3 * Math.sin(i / 7);
  return x;
}

describe('speech chunking', () => {
  it('finds speech regions and skips silence', () => {
    const regions = detectSpeechRegions(synth(20, [[1, 3], [10, 12.5]]));
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeCloseTo(0.75, 1);
    expect(regions[0].end).toBeCloseTo(3.25, 1);
    expect(regions[1].start).toBeCloseTo(9.75, 1);
  });

  it('bridges short pauses inside an utterance', () => {
    expect(detectSpeechRegions(synth(6, [[1, 2], [2.2, 3]]))).toHaveLength(1);
  });

  it('packs regions into windows and maps times back to the recording', () => {
    const x = synth(60, [[1, 3], [10, 12], [40, 44]]);
    const windows = packSpeechWindows(x, detectSpeechRegions(x), SR, 28);
    expect(windows).toHaveLength(1);
    const w = windows[0];
    expect(w.samples.length / SR).toBeLessThan(12); // 60 s recording → ~10 s of audio to transcribe
    // A word 0.5 s into the second piece is 0.5 s into that region in the recording
    const second = w.pieces[1];
    expect(packedToSourceTime(w, second.packedStart + 0.5)).toBeCloseTo(second.srcStart + 0.5, 5);
    expect(packedToSourceTime(w, 0)).toBeCloseTo(w.pieces[0].srcStart, 5);
  });

  it('starts a new window when the next region would not fit, and splits very long speech', () => {
    const x = synth(80, [[0, 20], [30, 45], [50, 80]]);
    const windows = packSpeechWindows(x, detectSpeechRegions(x), SR, 28);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) expect(w.samples.length / SR).toBeLessThanOrEqual(28.01);
  });

  it('treats a recording with no speech/noise contrast as all speech', () => {
    const x = synth(5, [[0, 5]]);
    expect(detectSpeechRegions(x)).toEqual([{ start: 0, end: 5 }]);
  });

  it('finds speech that no transcribed text covers (dropped phrases)', () => {
    const x = synth(40, [[1, 3], [10, 12], [20, 23]]);
    const [slice] = buildSpeechSlices(x, SR, 28);
    expect(slice.pieces).toHaveLength(3);
    const third = slice.pieces[2];
    // Whisper covered the first two pieces and stopped before the third
    const chunks: Array<{ timestamp: [number, number | null] }> = [
      { timestamp: [0, slice.pieces[1].packedStart + 1.5] },
    ];
    expect(uncoveredPieces(slice, chunks)).toEqual([third]);
    expect(uncoveredPieces(slice, [{ timestamp: [0, null] }])).toEqual([]);
    // Slice times map back to the recording
    expect(slice.toSource(third.packedStart + 1)).toBeCloseTo(third.srcStart + 1, 5);
  });

  it('flags a segment whose text is too short for the speech it covers', () => {
    const x = synth(40, [[1, 4], [10, 14], [20, 23]]);
    const [slice] = buildSpeechSlices(x, SR, 28);
    const end = slice.samples.length / SR;
    const ok = [{ timestamp: [0, end] as [number, number | null], text: ' I saw a big dog at the park and it ran to me very fast today.' }];
    expect(sparseChunks(slice, ok)).toEqual([]);
    const skipped = [{ timestamp: [0, end] as [number, number | null], text: ' I saw a dog.' }];
    const flagged = sparseChunks(slice, skipped);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].pieces).toHaveLength(3);
  });

  it('ignores digital silence when judging background noise', () => {
    // speech, exact-zero gap, 10 s of quiet room noise, exact-zero gap, speech
    const x = new Float32Array(20 * SR);
    for (let i = 0; i < 2 * SR; i++) x[i] = 0.3 * Math.sin(i / 7);
    let s = 5;
    for (let i = 4 * SR; i < 14 * SR; i++) x[i] = (((s = (s * 16807) % 2147483647) / 2147483647) - 0.5) * 0.006;
    for (let i = 16 * SR; i < 18 * SR; i++) x[i] = 0.3 * Math.sin(i / 7);
    const regions = detectSpeechRegions(x);
    expect(regions).toHaveLength(2);
    expect(regions.every((r) => r.end - r.start < 3)).toBe(true);
  });

  it('lets a re-check fill in a skipped phrase but never swap good text for a different guess', () => {
    // fills in the skipped middle, keeps the original words
    expect(recheckReplaces('I saw a dog.', 'I saw a big brown dog at the park.')).toBe(true);
    // more words, but mostly different ones: keep the original
    expect(recheckReplaces('I saw a dog.', 'Why so the frog went over there today?')).toBe(false);
    // not clearly more words
    expect(recheckReplaces('I saw a dog.', 'I saw a big dog.')).toBe(false);
  });
});
