import { describe, expect, it } from 'vitest';
import {
  addInflectionalMorphemes,
  addInflectionalMorphemesToSentence,
  conjugateThirdPersonSingular,
  formatCorrectionForConventionBox,
  isToBeVerb,
  removeErrorCoding,
} from '../saltConventions';

describe('isToBeVerb (ported from SpeechTranscription tests/test_isToBeVerb.py)', () => {
  it('recognizes to-be verbs and contractions', () => {
    for (const v of ['am', 'is', 'are', 'will be', 'was', 'were', 'been', "'m", "'s", "'re"]) {
      expect(isToBeVerb(v)).toBe(true);
    }
    expect(isToBeVerb('walk')).toBe(false);
    expect(isToBeVerb('have')).toBe(false);
  });
});

describe('removeErrorCoding (ported from SpeechTranscription tests/test_removeErrorCoding.py)', () => {
  it('test_one: strips repeated maze and substitutes [EO:told]', () => {
    expect(removeErrorCoding('(I I) I telled[EO:told] a lie.')).toBe('I told a lie.');
  });

  it('test_two: substitutes [EW:walked]', () => {
    expect(removeErrorCoding('He walking[EW:walked] on the sidewalk.')).toBe(
      'He walked on the sidewalk.'
    );
  });

  it('test_three: keeps normal sentence unchanged', () => {
    expect(removeErrorCoding('This is a normal sentence with no error coding.')).toBe(
      'This is a normal sentence with no error coding.'
    );
  });

  it('test_four: substitutes [EP:her]', () => {
    expect(removeErrorCoding('He liked his[EP:her] shoes.')).toBe('He liked her shoes.');
  });

  it('test_five: removes extra word [EW]', () => {
    expect(removeErrorCoding('He looked at[EW] sad.')).toBe('He looked sad.');
  });

  it('test_six: strips omission asterisk *to', () => {
    expect(removeErrorCoding('Give it *to me.')).toBe('Give it to me.');
  });

  it('test_seven: conjugates omitted /*3s', () => {
    expect(removeErrorCoding('The car go/*3s fast.')).toBe('The car goes fast.');
  });

  it('handles single-word mazes like (He) cleanly', () => {
    expect(removeErrorCoding('(He) he wanted a cookie.')).toBe('he wanted a cookie.');
  });
});

describe('addInflectionalMorphemesToSentence (ported from SpeechTranscription tests/test_addInflectionalMorphemesToSentence.py)', () => {
  it('test_one: possessive /z and plural /s', () => {
    expect(addInflectionalMorphemesToSentence("John's dogs are smart.")).toBe(
      'John/z dog/s are smart.'
    );
  });

  it('test_two: regular past tense /ed', () => {
    expect(addInflectionalMorphemesToSentence('I walked my dog.')).toBe(
      'I walk/ed my dog.'
    );
  });

  it('test_three: third-person singular /3s', () => {
    expect(addInflectionalMorphemesToSentence('He goes for a walk every evening.')).toBe(
      'He go/3s for a walk every evening.'
    );
  });

  it("test_four: /'m, /ing after to-be, and irregular can/'t", () => {
    expect(
      addInflectionalMorphemesToSentence(
        "I'm not doing my homework, but I can't do it now anyway."
      )
    ).toBe("I/'m not do/ing my homework, but I can/'t do it now anyway.");
  });

  it("test_five: /'ll and /'re contractions", () => {
    expect(
      addInflectionalMorphemesToSentence(
        "I'll finish my homework after we're done with this."
      )
    ).toBe("I/'ll finish my homework after we/'re done with this.");
  });

  it("test_six: /'d and /'s verb contraction with semicolon", () => {
    expect(
      addInflectionalMorphemesToSentence(
        "I'd like to go to Disneyland; it's famous for a reason."
      )
    ).toBe("I/'d like to go to Disneyland; it/'s famous for a reason.");
  });

  it("test_seven: /'ve and /ing after been", () => {
    expect(
      addInflectionalMorphemesToSentence("I've been working for a long time.")
    ).toBe("I/'ve been work/ing for a long time.");
  });

  it("keeps fused irregular don't intact while coding isn't -> is/n't", () => {
    expect(addInflectionalMorphemesToSentence("I don't think it isn't ready.")).toBe(
      "I don't think it is/n't ready."
    );
  });
});

describe('addInflectionalMorphemes (ported from SpeechTranscription tests/test_addInflectionalMorpheme.py)', () => {
  it('test_one: preserves [EP:her] while coding /ed and /s', () => {
    expect(addInflectionalMorphemes('He liked his[EP:her] shoes.')).toBe(
      'He like/ed his[EP:her] shoe/s.'
    );
  });

  it('test_two: preserves [EW] while coding /ed', () => {
    expect(addInflectionalMorphemes('He looked at[EW] sad.')).toBe(
      'He look/ed at[EW] sad.'
    );
  });

  it('preserves timestamps, speaker labels, and mazes cleanly', () => {
    const input =
      '[0:04] C (I I) I telled[EW:told] the dogs.\n[0:10] E He was walking fast.';
    expect(addInflectionalMorphemes(input)).toBe(
      '[0:04] C (I I) I telled[EW:told] the dog/s.\n[0:10] E He was walk/ing fast.'
    );
  });
});

describe('conjugateThirdPersonSingular & formatCorrectionForConventionBox', () => {
  it('conjugates irregular and regular verbs accurately', () => {
    expect(conjugateThirdPersonSingular('go')).toBe('goes');
    expect(conjugateThirdPersonSingular('walk')).toBe('walks');
    expect(conjugateThirdPersonSingular('try')).toBe('tries');
    expect(conjugateThirdPersonSingular('watch')).toBe('watches');
  });

  it('preserves SALT brackets when normalizing a timestamped correction', () => {
    expect(
      formatCorrectionForConventionBox('  [0:12]   C He telled[EW:told] a lie.  ')
    ).toBe('[0:12] C He telled[EW:told] a lie.');
  });
});
