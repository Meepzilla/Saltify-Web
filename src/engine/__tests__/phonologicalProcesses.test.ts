import { describe, expect, it } from 'vitest';
import { processesInWord, summarizeProcesses } from '../phonologicalProcesses';
import { compareWordsToHeard, splitIpa } from '../speechSounds';

/** One word: expected IPA vs heard IPA → process ids. */
function procs(word: string, expected: string, heard: string): string[] {
  const [row] = compareWordsToHeard([word], [splitIpa(expected)], splitIpa(heard));
  return processesInWord(row).map((p) => p.process);
}

describe('phonological processes', () => {
  it.each([
    ['cat', 'kæt', 'tæt', 'velar-fronting'],
    ['go', 'ɡoʊ', 'doʊ', 'velar-fronting'],
    ['shoe', 'ʃu', 'su', 'palatal-fronting'],
    ['top', 'tɑp', 'kɑp', 'backing'],
    ['sun', 'sʌn', 'tʌn', 'stopping'],
    ['rabbit', 'ɹæbɪt', 'wæbɪt', 'gliding'],
    ['leaf', 'lif', 'jif', 'gliding'],
    ['water', 'wɑtɚ', 'wɑtə', 'vowelization'],
    ['chip', 'tʃɪp', 'ʃɪp', 'deaffrication'],
    ['thumb', 'θʌm', 'fʌm', 'labialization'],
    ['sun', 'sʌn', 'θʌn', 'interdental-lisp'],
    ['pig', 'pɪɡ', 'bɪɡ', 'prevocalic-voicing'],
    ['bed', 'bɛd', 'bɛt', 'final-devoicing'],
    ['dog', 'dɑɡ', 'ɡɑɡ', 'assimilation'],
    ['cup', 'kʌp', 'kʌ', 'final-consonant-deletion'],
    ['cup', 'kʌp', 'ʌp', 'initial-consonant-deletion'],
    ['spoon', 'spun', 'pun', 'cluster-reduction'],
    ['stop', 'stɑp', 'tɑp', 'cluster-reduction'],
    ['banana', 'bənænə', 'nænə', 'weak-syllable-deletion'],
    ['blue', 'blu', 'bəlu', 'epenthesis'],
  ])('%s /%s/ → [%s] is %s', (word, expected, heard, process) => {
    expect(procs(word, expected, heard)).toContain(process);
  });

  it('codes a deleted syllable once, as weak syllable deletion', () => {
    expect(procs('banana', 'bənænə', 'nænə')).toEqual(['weak-syllable-deletion']);
  });

  it('treats a cluster consonant heard as a vowel as omitted', () => {
    expect(procs('spoon', 'spun', 'əpun')).toContain('cluster-reduction');
  });

  it('codes stopping and fronting together for /ʃ/ → [t]', () => {
    expect(procs('shoe', 'ʃu', 'tu')).toEqual(expect.arrayContaining(['stopping', 'palatal-fronting']));
  });

  it('finds nothing when the word is produced as expected, or a flap stands for /t d/', () => {
    expect(procs('rabbit', 'ɹæbɪt', 'ɹæbɪt')).toEqual([]);
    expect(procs('ladder', 'lædɚ', 'læɾɚ')).toEqual([]);
  });

  it('skips function words, which everyone reduces in connected speech', () => {
    expect(procs('and', 'ænd', 'ən')).toEqual([]);
  });

  it('summarizes occurrences and opportunities across words', () => {
    const rows = compareWordsToHeard(
      ['rabbit', 'red', 'cat', 'leg'],
      [splitIpa('ɹæbɪt'), splitIpa('ɹɛd'), splitIpa('kæt'), splitIpa('lɛɡ')],
      splitIpa('wæbɪt wɛd kæt lɛɡ')
    );
    const gliding = summarizeProcesses(rows).find((r) => r.process === 'gliding')!;
    expect(gliding.occurrences).toBe(2);
    expect(gliding.opportunities).toBe(3); // ɹ, ɹ, l
    expect(gliding.percent).toBe(67);
    expect(gliding.examples[0]).toMatchObject({ word: 'rabbit', from: 'ɹ', to: 'w' });
  });
});
