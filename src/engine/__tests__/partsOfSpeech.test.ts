import { describe, expect, it } from 'vitest';
import { correctSentence } from '../childGrammarEngine';
import { estimateUtteranceClauses } from '../clauseAnalysis';
import { insertPosCodes, tagUtteranceBody } from '../partsOfSpeech';
import { hasPosCodes, stripPosCodes } from '../posCodes';
import { addInflectionalMorphemesToLine } from '../saltConventions';
import { computeSaltMetrics } from '../saltMetrics';

const ALIASES = { speaker1: 'C', speaker2: 'E' };

function categories(body: string): string {
  return tagUtteranceBody(body)
    .filter((s) => s.category)
    .map((s) => `${s.text.replace(/[.?!]$/, '')}:${s.category}`)
    .join(' ');
}

describe('part-of-speech tagging', () => {
  it('tags common child utterances', () => {
    expect(categories('The dog ran fast.')).toBe(
      'The:determiner dog:noun ran:verb fast:adverb'
    );
    expect(categories('he is running to the big park/s.')).toBe(
      'he:pronoun is:aux running:verb to:preposition the:determiner big:adjective park/s:noun'
    );
    expect(categories('we like it.')).toBe('we:pronoun like:verb it:pronoun');
    expect(categories("I'm gonna play.")).toBe("I'm:pronoun gonna:verb play:verb");
    expect(categories('oh wow.')).toBe('oh:interjection wow:interjection');
    expect(categories("Um there's a dog.")).toBe("there's:pronoun a:determiner dog:noun");
  });

  it('does not tag mazes, comments, codes, omitted words or unintelligible markers', () => {
    expect(categories('(um I) I want/ed the ball [SI-1].')).toBe(
      'I:pronoun want/ed:verb the:determiner ball:noun'
    );
    expect(categories('He goed|go[EO:went] home *to {laughs} XXX.')).toBe(
      'He:pronoun goed|go[EO:went]:verb home:noun'
    );
  });
});

describe('POS code insertion', () => {
  const transcript = '[0:01] C (um) the dog/s run/3s home [SI-1].\n[0:03] E what happen/ed?';

  it('inserts codes after words, before punctuation, keeping SALT coding', () => {
    expect(insertPosCodes(transcript, ALIASES)).toBe(
      '[0:01] C (um) the[DET] dog/s[N] run/3s[V] home[N] [SI-1].\n[0:03] E what[PRO] happen/ed[V]?'
    );
  });

  it('is idempotent and fully removable', () => {
    const once = insertPosCodes(transcript, ALIASES);
    expect(insertPosCodes(once, ALIASES)).toBe(once);
    expect(hasPosCodes(once)).toBe(true);
    expect(stripPosCodes(once)).toBe(transcript);
  });

  it('does not change SALT metrics, clause estimates, morphemes or grammar check', () => {
    const plain = 'C the dog that bark/3s want/3s a bone.\nC (um I) I like it.';
    const coded = insertPosCodes(plain, ALIASES);

    expect(computeSaltMetrics(coded, ALIASES).speaker1).toEqual(
      computeSaltMetrics(plain, ALIASES).speaker1
    );
    for (const [p, c] of [
      ['the dog that bark/3s want/3s a bone.', 'the[DET] dog[N] that[DET] bark/3s[V] want/3s[V] a[DET] bone[N].'],
    ]) {
      expect(estimateUtteranceClauses(c)).toEqual(estimateUtteranceClauses(p));
    }
    expect(addInflectionalMorphemesToLine('C the[DET] dogs[N] walked[V] home[N].')).toBe(
      addInflectionalMorphemesToLine('C the dogs walked home.')
    );
    expect(correctSentence('C he[PRO] go[V] home[N].')).toBe(correctSentence('C he go home.'));
  });
});
