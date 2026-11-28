import { describe, expect, it } from 'vitest';
import { alignWordSequences, annotateDisagreements, replaceWordInBody, shapeLike } from '../modelFusion';
import { buildWordConfidenceMap, flaggedWordsForLine, resolveFlagInMap } from '../wordConfidence';

describe('second-opinion comparison', () => {
  it('aligns word sequences with substitutions, insertions and deletions', () => {
    expect(alignWordSequences(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 1 },
      { a: 2, b: 2 },
      { a: null, b: 3 },
    ]);
  });

  it('annotates disagreements and boosts agreed words', () => {
    const out = annotateDisagreements(
      [
        { word: 'symbolize', p: 0.7 },
        { word: 'drawn', p: 0.5 },
        { word: 'today.', p: 0.6 },
      ],
      [
        { word: 'similes', p: 0.8 },
        { word: 'drawn', p: 0.95 },
      ]
    );
    expect(out[0]).toEqual({ word: 'symbolize', p: 0.7, alt: 'similes', altP: 0.8 });
    expect(out[1]).toEqual({ word: 'drawn', p: 0.95 });
    expect(out[2]).toEqual({ word: 'today.', p: 0.6, alt: '', altP: 0 });
  });

  it('flags disagreements unless the main model was very sure', () => {
    const words = annotateDisagreements(
      [
        { word: 'The', p: 0.99 },
        { word: 'wabbit', p: 0.75 },
        { word: 'ran.', p: 0.95 },
      ],
      [
        { word: 'The', p: 0.99 },
        { word: 'rabbit', p: 0.7 },
        { word: 'run.', p: 0.4 },
      ]
    );
    const flags = flaggedWordsForLine('The wabbit ran.', buildWordConfidenceMap('[0:00] The wabbit ran.', words));
    expect(flags.get(1)).toMatchObject({ w: 'wabbit', a: 'rabbit' });
    expect(flags.has(2)).toBe(false); // main model 95% sure: no flag despite disagreement
  });

  it('replaces or removes a word, keeping punctuation and case', () => {
    expect(shapeLike('Wabbit,', 'rabbit')).toBe('Rabbit,');
    expect(replaceWordInBody('He saw the wabbit.', 3, 'rabbit')).toBe('He saw the rabbit.');
    expect(replaceWordInBody('He went home now.', 3, '')).toBe('He went home.');
    // "Insert after" = replace the word with itself plus the new word(s); punctuation stays at the end
    expect(replaceWordInBody('He went home.', 2, 'home now')).toBe('He went home now.');
    expect(replaceWordInBody('Dog ran.', 0, 'Dog quickly')).toBe('Dog quickly ran.');
    expect(replaceWordInBody('Um he went.', 0, '')).toBe('He went.');
    expect(replaceWordInBody('i think so.', 0, 'I')).toBe('I think so.');
  });

  it('re-keys the confidence map after a word is resolved', () => {
    const map = { 'the wabbit ran fast': [{ i: 1, w: 'wabbit', p: 0.5, a: 'rabbit', ap: 0.7 }, { i: 3, w: 'fast', p: 0.4 }] };
    const next = resolveFlagInMap(map, 'The wabbit ran fast.', 'The rabbit ran fast.', 1);
    expect(flaggedWordsForLine('The rabbit ran fast.', next).get(3)?.w).toBe('fast');
    expect(flaggedWordsForLine('The rabbit ran fast.', next).has(1)).toBe(false);
    const removed = resolveFlagInMap(map, 'The wabbit ran fast.', 'The ran fast.', 1);
    expect(flaggedWordsForLine('The ran fast.', removed).get(2)?.w).toBe('fast');
    // Multi-word replacement shifts later flags forward
    const longer = resolveFlagInMap(map, 'The wabbit ran fast.', 'The little rabbit ran fast.', 1);
    expect(flaggedWordsForLine('The little rabbit ran fast.', longer).get(4)?.w).toBe('fast');
  });

  it('applies live flag thresholds to stored words', () => {
    const map = { 'he goed home': [{ i: 1, w: 'goed', p: 0.7 }, { i: 2, w: 'home', p: 0.93, a: 'hum', ap: 0.6 }] };
    expect(flaggedWordsForLine('He goed home.', map).size).toBe(0); // defaults: 60% / 90%
    const strict = { uncertainBelow: 0.8, disagreementBelow: 0.95 };
    expect([...flaggedWordsForLine('He goed home.', map, strict).keys()]).toEqual([1, 2]);
  });
});
