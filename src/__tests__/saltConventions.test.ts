import { describe, expect, it } from 'vitest';
import {
  addInflectionalMorphemes,
  addInflectionalMorphemesToSentence,
  addInflectionalMorphemesToTranscript,
  formatCorrectionForConventionBox,
  isToBeVerb,
  removeErrorCoding,
} from '../lib/salt/conventions';

describe('isToBeVerb (ported from upstream test_isToBeVerb.py)', () => {
  it('identifies to-be verbs and contractions', () => {
    for (const verb of ['am', 'is', 'are', 'was', 'were', 'been', "'m", "'s", "'re"]) {
      expect(isToBeVerb(verb)).toBe(true);
    }
    for (const nonBe of ['walk', 'go', 'has', 'did', 'dog']) {
      expect(isToBeVerb(nonBe)).toBe(false);
    }
  });
});

describe('removeErrorCoding (ported from upstream test_removeErrorCoding.py)', () => {
  it('removes mazes and replaces overgeneralization error codes', () => {
    expect(removeErrorCoding('(I I) I telled[EO:told] a lie.')).toBe('I told a lie.');
  });

  it('replaces EW substitutions with target word', () => {
    expect(removeErrorCoding('He walking[EW:walked] on the sidewalk.')).toBe(
      'He walked on the sidewalk.'
    );
  });

  it('leaves normal sentences unchanged', () => {
    expect(removeErrorCoding('This is a normal sentence with no error coding.')).toBe(
      'This is a normal sentence with no error coding.'
    );
  });

  it('replaces EP pronoun errors with target pronoun', () => {
    expect(removeErrorCoding('He liked his[EP:her] shoes.')).toBe('He liked her shoes.');
  });

  it('removes extra words tagged with [EW]', () => {
    expect(removeErrorCoding('He looked at[EW] sad.')).toBe('He looked sad.');
  });

  it('strips omitted word asterisks', () => {
    expect(removeErrorCoding('Give it *to me.')).toBe('Give it to me.');
  });

  it('conjugates omitted 3rd-person singular /*3s verbs', () => {
    expect(removeErrorCoding('The car go/*3s fast.')).toBe('The car goes fast.');
  });
});

describe('addInflectionalMorphemesToSentence (ported from upstream test_addInflectionalMorphemesToSentence.py)', () => {
  it('tags possessive /z and plural /s', () => {
    expect(addInflectionalMorphemesToSentence("John's dogs are smart.")).toBe(
      'John/z dog/s are smart.'
    );
  });

  it('tags regular past tense /ed', () => {
    expect(addInflectionalMorphemesToSentence('I walked my dog.')).toBe('I walk/ed my dog.');
  });

  it('tags 3rd-person singular present /3s', () => {
    expect(addInflectionalMorphemesToSentence('He goes for a walk every evening.')).toBe(
      'He go/3s for a walk every evening.'
    );
  });

  it("tags contractions and progressive /ing after 'm", () => {
    expect(
      addInflectionalMorphemesToSentence(
        "I'm not doing my homework, but I can't do it now anyway."
      )
    ).toBe("I/'m not do/ing my homework, but I can/'t do it now anyway.");
  });

  it("tags /'ll and /'re contractions", () => {
    expect(
      addInflectionalMorphemesToSentence("I'll finish my homework after we're done with this.")
    ).toBe("I/'ll finish my homework after we/'re done with this.");
  });

  it("tags /'d and /'s contractions", () => {
    expect(
      addInflectionalMorphemesToSentence("I'd like to go to Disneyland; it's famous for a reason.")
    ).toBe("I/'d like to go to Disneyland; it/'s famous for a reason.");
  });

  it("tags /'ve and progressive /ing after been", () => {
    expect(addInflectionalMorphemesToSentence("I've been working for a long time.")).toBe(
      "I/'ve been work/ing for a long time."
    );
  });

  it("preserves don't as an uninflected SALT token", () => {
    expect(addInflectionalMorphemesToSentence("I don't want cookies.")).toBe(
      "I don't want cookie/s."
    );
  });
});

describe('addInflectionalMorphemes (ported from upstream test_addInflectionalMorpheme.py)', () => {
  it('preserves [EP:her] while coding past tense /ed and plural /s', () => {
    expect(addInflectionalMorphemes('He liked his[EP:her] shoes.')).toBe(
      'He like/ed his[EP:her] shoe/s.'
    );
  });

  it('preserves [EW] extra word while coding past tense /ed', () => {
    expect(addInflectionalMorphemes('He looked at[EW] sad.')).toBe('He look/ed at[EW] sad.');
  });

  it('preserves timestamps and speaker prefixes across multi-line transcripts', () => {
    const input = [
      "[0:04] C He liked his[EP:her] shoes.",
      "[0:09] C He walk/*3s to school.",
      "[0:14] E That's great!",
    ].join('\n');

    expect(addInflectionalMorphemesToTranscript(input, ['C', 'E'])).toBe(
      [
        '[0:04] C He like/ed his[EP:her] shoe/s.',
        '[0:09] C He walk/*3s to school.',
        "[0:14] E That/'s great!",
      ].join('\n')
    );
  });
});

describe('formatCorrectionForConventionBox (ported from upstream test_salt_utils.py)', () => {
  it('preserves SALT annotation with timestamp', () => {
    const correction = '[00:01] He walk/*3s\n';
    expect(formatCorrectionForConventionBox(correction)).toBe(correction);
  });

  it('normalizes surrounding whitespace without modifying SALT codes', () => {
    expect(formatCorrectionForConventionBox('\n[00:02] She walk/*3s   \n')).toBe(
      '[00:02] She walk/*3s\n'
    );
  });

  it('handles lines without timestamps gracefully', () => {
    expect(formatCorrectionForConventionBox('  C He walk/*3s  ')).toBe('C He walk/*3s\n');
  });
});
