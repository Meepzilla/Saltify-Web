import { describe, expect, it } from 'vitest';
import {
  collapseRepeatedPhrase,
  collapseRepetitions,
  dropSilentChunks,
  looksLikeRepetitionLoop,
  type TimedChunk,
} from '../hallucinationGuard';

const c = (s: number, text: string): TimedChunk => ({ timestamp: [s, s + 1], text });

describe('hallucination guard', () => {
  it('collapses a "What? What? What?…" loop to one utterance', () => {
    const chunks = [c(6, ' Is he eating?'), c(7, " I don't know."), ...Array.from({ length: 16 }, (_, i) => c(8 + i, ' What?'))];
    expect(looksLikeRepetitionLoop(chunks)).toBe(true);
    expect(collapseRepetitions(chunks).map((x) => x.text)).toEqual([' Is he eating?', " I don't know.", ' What?']);
  });

  it('keeps natural repetition (twice) and normal speech', () => {
    const chunks = [c(0, ' What?'), c(1, ' What?'), c(2, ' The dog ran home.')];
    expect(looksLikeRepetitionLoop(chunks)).toBe(false);
    expect(collapseRepetitions(chunks)).toEqual(chunks);
  });

  it('collapses phrase loops inside one chunk', () => {
    expect(collapseRepeatedPhrase('and then the the the the the dog')).toBe('and then the dog');
    expect(collapseRepeatedPhrase('I like it I like it I like it I like it a lot')).toBe('I like it a lot');
    expect(collapseRepeatedPhrase('no no no')).toBe('no no no');
  });

  it('drops text over silence but keeps quiet speech', () => {
    const sr = 16000;
    const audio = new Float32Array(sr * 6);
    for (let i = 0; i < sr * 2; i++) audio[i] = 0.3 * Math.sin(i / 5); // loud speech 0–2 s
    for (let i = sr * 2; i < sr * 3; i++) audio[i] = 0.04 * Math.sin(i / 5); // quiet speech 2–3 s
    for (let i = sr * 3; i < sr * 6; i++) audio[i] = 0.002 * Math.sin(i / 3); // near-silence 3–6 s
    const kept = dropSilentChunks([c(0, 'loud'), c(2, 'quiet'), c(4, 'What?')], audio, sr);
    expect(kept.map((x) => x.text)).toEqual(['loud', 'quiet']);
  });
});
