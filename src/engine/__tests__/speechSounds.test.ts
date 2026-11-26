import { describe, expect, it } from 'vitest';
import {
  comparablePhone,
  compareWordsToHeard,
  lineWindow,
  phonesInWindow,
  splitIpa,
  type HeardPhone,
} from '../speechSounds';

describe('speech sounds', () => {
  it('splits IPA into phones, keeping diphthongs, affricates and length marks', () => {
    expect(splitIpa('ˈɹæbɪt')).toEqual(['ɹ', 'æ', 'b', 'ɪ', 't']);
    expect(splitIpa('aɪ')).toEqual(['aɪ']);
    expect(splitIpa('dʒʌmp')).toEqual(['dʒ', 'ʌ', 'm', 'p']);
    expect(splitIpa('sɑː')).toEqual(['s', 'ɑː']);
  });

  it('compares eSpeak and dictionary symbols on a common basis', () => {
    expect(comparablePhone('ɑː')).toBe('ɑ');
    expect(comparablePhone('ɐ')).toBe('ə');
    expect(comparablePhone('ɡ')).toBe('g');
  });

  it('shows a substitution: expected /ɹæbɪt/, heard /wæbɪt/', () => {
    const result = compareWordsToHeard(
      ['I', 'saw', 'a', 'rabbit.'],
      [['aɪ'], ['s', 'ɔ'], ['ə'], ['ɹ', 'æ', 'b', 'ɪ', 't']],
      ['aɪ', 's', 'ɔ', 'ɐ', 'w', 'æ', 'b', 'ɪ', 't']
    );
    expect(result[3].heard.map((h) => `${h.p}:${h.status}`)).toEqual([
      'w:different',
      'æ:match',
      'b:match',
      'ɪ:match',
      't:match',
    ]);
    expect(result[2].heard).toEqual([{ p: 'ɐ', status: 'match' }]);
  });

  it('shows an omission: expected /spun/, heard /pun/', () => {
    const [spoon] = compareWordsToHeard(['spoon'], [['s', 'p', 'u', 'n']], ['p', 'uː', 'n']);
    expect(spoon.missing).toEqual(['s']);
    expect(spoon.heard.every((h) => h.status === 'match')).toBe(true);
    expect(spoon.sequence.map((h) => `${h.p}:${h.status}`)).toEqual(['s:missing', 'p:match', 'uː:match', 'n:match']);
  });

  it('treats cot/caught as one vowel and collapses doubled letter-to-sound guesses', () => {
    expect(comparablePhone('ɔ')).toBe(comparablePhone('ɑː'));
    expect(splitIpa('wɛbbɪt')).toEqual(['w', 'ɛ', 'b', 'ɪ', 't']);
    const [, saw, a] = compareWordsToHeard(['I', 'saw', 'a'], [['aɪ'], ['s', 'ɔ'], ['ə']], ['aɪ', 's', 'ɑː', 'ə']);
    expect(saw.sequence.map((h) => h.status)).toEqual(['match', 'match']);
    expect(a.sequence).toEqual([{ p: 'ə', status: 'match', ei: 0, expected: 'ə' }]);
  });

  it('picks phones by time, using precise spans when the line still matches', () => {
    const phones: HeardPhone[] = [
      ['a', 0.1, 0.9],
      ['b', 0.9, 0.9],
      ['c', 1.4, 0.9],
      ['d', 2.6, 0.9],
    ];
    const used = new Set<number>();
    const w = lineWindow('he went home', 0, 2, [{ k: 'he went home', s: 0.05, e: 1.2 }], used, 10);
    expect(w).toEqual({ start: 0.05, end: 1.2 });
    expect(phonesInWindow(phones, w!.start, w!.end).map((p) => p[0])).toEqual(['a', 'b']);
    // Edited line: falls back to timestamps
    expect(lineWindow('he goed home', 2, 3, [], new Set(), 10)).toEqual({ start: 2, end: 4 });
    // Edited lines with timing still available: take the next span in order
    const spans = [
      { k: 'i see', s: 0.1, e: 1 },
      { k: 'the tun is up', s: 3.2, e: 4.4 },
      { k: 'bye', s: 5, e: 5.5 },
    ];
    const u = new Set<number>();
    expect(lineWindow('i see', 0, 0, spans, u, 10)).toEqual({ start: 0.1, end: 1 });
    expect(lineWindow('the sun is up', 0, 0, spans, u, 10)).toEqual({ start: 3.2, end: 4.4 });
    expect(lineWindow('bye', 0, null, spans, u, 10)).toEqual({ start: 5, end: 5.5 });
  });
});
