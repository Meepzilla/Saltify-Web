import { describe, expect, it } from 'vitest';
import {
  collapseRepeatedPhrase,
  collapseRepetitions,
  dropInventedUtterances,
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

  it('removes repeated stock phrases and same-moment duplicates, keeps real speech', () => {
    const u = (t: number, text: string) => ({ startSec: t, endSec: t + 1.5, text });
    const transcript = [
      u(236, "Elijah, we'll go take a nap, wake up, it'll be dinner."),
      u(236.4, "Elijah, we'll go take a nap, wake up, it'll be dinner."),
      u(252, 'Thank you.'),
      u(260, 'Look at that dinosaur'),
      u(265, 'Thank you.'),
      u(268, 'Bye!'),
      u(300, 'Thank you.'),
      u(329, "I'm going to do it."),
      u(336, "I'm going to do it."),
    ];
    expect(dropInventedUtterances(transcript).map((x) => x.text)).toEqual([
      "Elijah, we'll go take a nap, wake up, it'll be dinner.",
      'Look at that dinosaur',
      'Bye!',
      "I'm going to do it.",
      "I'm going to do it.",
    ]);
  });

  it('keeps a single clearly spoken "Thank you." but drops one over near-quiet audio', () => {
    const sr = 16000;
    const audio = new Float32Array(sr * 10);
    for (let i = 0; i < sr * 2; i++) audio[i] = 0.3 * Math.sin(i / 5); // speech 0-2 s
    for (let i = sr * 5; i < sr * 6; i++) audio[i] = 0.02 * Math.sin(i / 5); // faint noise 5-6 s
    const spoken = [{ startSec: 0, endSec: 2, text: 'Thank you.' }];
    expect(dropInventedUtterances(spoken, audio, sr)).toHaveLength(1);
    const overNoise = [{ startSec: 5, endSec: 6, text: 'Thank you.' }];
    expect(dropInventedUtterances(overNoise, audio, sr)).toHaveLength(0);
  });
});
