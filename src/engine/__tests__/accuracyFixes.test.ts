import { describe, expect, it } from 'vitest';
import { estimateUtteranceClauses } from '../clauseAnalysis';
import { computeSaltMetrics } from '../saltMetrics';
import { applyAutoMazes, formatWhisperChunks } from '../transcriptFormat';

const ALIASES = { speaker1: 'C', speaker2: 'E' };

describe('SALT metrics accuracy', () => {
  it('computes MLU from complete & intelligible utterances only', () => {
    const m = computeSaltMetrics(
      'C I like dog/s.\nC he go/3s home.\nC and then the big dog want/ed to go to the >',
      ALIASES
    ).speaker1;
    expect(m.completeIntelligibleUtterances).toBe(2);
    expect(m.mluWords).toBe(3); // 6 words / 2 C&I utterances (abandoned utterance excluded)
    expect(m.mluMorphemes).toBe(4); // (6 + 2 bound) / 2
    expect(m.totalWords).toBe(6); // NTW is based on C&I verbal utterances (SALT)
    expect(m.allWords).toBe(16); // every utterance, used for maze % and words/minute
  });

  it('does not count unintelligible X/XX/XXX as words', () => {
    const m = computeSaltMetrics('C I want XXX.\nC the dog run/3s.\nC X go home.', ALIASES).speaker1;
    expect(m.completeIntelligibleUtterances).toBe(1);
    expect(m.totalWords).toBe(3); // only "the dog run/3s" is C&I
    expect(m.uniqueWords).toBe(3);
    expect(m.allWords).toBe(7); // X/XXX never counted as words
  });

  it('counts adjacent mazes as a single maze', () => {
    const m = computeSaltMetrics('C (um) (I) I want it.', ALIASES).speaker1;
    expect(m.mazeCount).toBe(1);
    expect(m.mazeWords).toBe(2);
    expect(m.totalWords).toBe(3);
  });

  it('excludes nonverbal utterances from the C&I verbal set', () => {
    const m = computeSaltMetrics('C {nods}.\nC I want it.', ALIASES).speaker1;
    expect(m.totalUtterances).toBe(2);
    expect(m.completeIntelligibleUtterances).toBe(1);
    expect(m.mluWords).toBe(3);
  });

  it('uses the root after | and keeps _ linked words as one word', () => {
    const m = computeSaltMetrics(
      'C He goed|go[EO:went] home.\nC He go/3s home.\nC The boy ran very very_very|very fast.',
      ALIASES
    ).speaker1;
    // roots: he, go, home, the, boy, ran, very, fast ('goed|go' and 'go/3s' share 'go')
    expect(m.uniqueWords).toBe(8);
    expect(m.totalWords).toBe(12);
  });

  it('computes words/minute from all words including mazes', () => {
    const m = computeSaltMetrics('C (um) I want it.\nC and the >', ALIASES, 60).speaker1;
    expect(m.wordsPerMinute).toBe(6); // 3 + 2 words + 1 maze word in 1 minute
  });

  it('ignores {comments} and bracket codes when counting', () => {
    const m = computeSaltMetrics('C I like {laughs} the dog/s[EW:dog].', ALIASES).speaker1;
    expect(m.totalWords).toBe(4);
    expect(m.boundMorphemes).toBe(1);
  });
});

describe('clause estimation tagger fix-ups', () => {
  it.each([
    ['we like it.', 1],
    ['I like the one that is red.', 2],
    ['I need the toy that fell.', 2],
    ['he likes the dog that barks.', 2],
    ['they like to play.', 1],
    ['he jumped and laughed.', 1],
    ['I think he is happy.', 2],
  ])('%s -> SI-%s', (utterance, expected) => {
    expect(estimateUtteranceClauses(utterance).suggestedSi).toBe(expected);
  });
});

describe('Whisper post-processing', () => {
  it('codes fillers and repeated function words as SALT mazes', () => {
    expect(applyAutoMazes('Um, I, I want, uh, the ball.')).toBe('(Um I) I want, (uh) the ball.');
    expect(applyAutoMazes('The the dog ran.')).toBe('(The) the dog ran.');
    expect(applyAutoMazes('I want it um.')).toBe('I want it (um).');
  });

  it('leaves emphatic repetition and hand-coded mazes alone', () => {
    expect(applyAutoMazes('It was very very big.')).toBe('It was very very big.');
    expect(applyAutoMazes('No no no.')).toBe('No no no.');
    expect(applyAutoMazes('He said (um) hi.')).toBe('He said (um) hi.');
  });

  it('does not split on abbreviations and drops filler-only utterances', () => {
    const out = formatWhisperChunks([
      { timestamp: [0, 3], text: ' Mr. Smith has a dog. He is big!' },
      { timestamp: [4, 5], text: ' Uh.' },
    ]);
    expect(out).toBe('[0:00] Mr Smith has a dog.\n[0:00] He is big!');
  });
});
