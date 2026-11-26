import { describe, expect, it } from 'vitest';
import {
  buildWordConfidenceMap,
  confidenceLineKey,
  countFlaggedWords,
  flaggedWordsForLine,
  groupTokensIntoWords,
} from '../wordConfidence';

describe('word confidence', () => {
  it('groups BPE tokens into words using the least-confident piece', () => {
    const words = groupTokensIntoWords([
      { text: ' The', p: 0.99 },
      { text: ' rab', p: 0.9 },
      { text: 'bit', p: 0.4 },
      { text: ' ran', p: 0.95 },
      { text: '.', p: 0.2 }, // punctuation never makes a word look uncertain
    ]);
    expect(words).toEqual([
      { word: 'The', p: 0.99 },
      { word: 'rabbit', p: 0.4 },
      { word: 'ran.', p: 0.95 },
    ]);
  });

  it('aligns uncertain words to transcript lines, ignoring timestamps and mazes', () => {
    const transcript = '[0:00] (Um I) I want the wabbit.\n[0:04] He goed home.';
    const map = buildWordConfidenceMap(transcript, [
      { word: 'Um', p: 0.9 },
      { word: 'I', p: 0.9 },
      { word: 'I', p: 0.95 },
      { word: 'want', p: 0.97 },
      { word: 'the', p: 0.98 },
      { word: 'wabbit.', p: 0.31 },
      { word: 'He', p: 0.99 },
      { word: 'goed', p: 0.52 },
      { word: 'home.', p: 0.99 },
    ]);
    expect(map[confidenceLineKey('(Um I) I want the wabbit.')]).toEqual([{ i: 5, w: 'wabbit', p: 0.31 }]);
    expect(map[confidenceLineKey('He goed home.')]).toEqual([{ i: 1, w: 'goed', p: 0.52 }]);
  });

  it('keeps flags after speaker labels are added, and drops them once a word is edited', () => {
    const map = buildWordConfidenceMap('[0:00] He goed home.', [
      { word: 'He', p: 0.99 },
      { word: 'goed', p: 0.4 },
      { word: 'home.', p: 0.99 },
    ]);
    expect(flaggedWordsForLine('He goed home.', map).get(1)?.w).toBe('goed');
    expect(countFlaggedWords(['He goed home.'], map)).toBe(1);
    // Clinician corrected the word: the line no longer matches, so no highlight remains
    expect(flaggedWordsForLine('He went home.', map).size).toBe(0);
  });

  it('tolerates words Whisper produced that the formatter dropped', () => {
    const map = buildWordConfidenceMap('[0:00] I like it.', [
      { word: '...', p: 0.3 },
      { word: 'I', p: 0.99 },
      { word: 'like', p: 0.5 },
      { word: 'it.', p: 0.99 },
    ]);
    expect(flaggedWordsForLine('I like it.', map).get(1)?.p).toBe(0.5);
  });
});
