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

describe('addInflectionalMorphemes idempotency (repeated Add Morphemes presses)', () => {
  it('never duplicates slashes on contractions, possessives, plurals, or verb inflections across multiple presses', () => {
    const input = [
      "[0:00] E Tell me what happened in the story about John's dogs.",
      "[0:05] C I'm not doing my homework, but I can't do it now anyway.",
      "[0:10] C It's John's dog and he's running, she'll play, they've walked, we're here, I'd go.",
      "[0:16] C He didn't stop, couldn't jump, isn't fun, won't go, and don't run.",
      "[0:22] C And that's all!",
    ].join('\n');

    const pass1 = addInflectionalMorphemes(input, ['C', 'E']);
    const pass2 = addInflectionalMorphemes(pass1, ['C', 'E']);
    const pass3 = addInflectionalMorphemes(pass2, ['C', 'E']);

    expect(pass1).toContain("I/'m not do/ing");
    expect(pass1).toContain("can/'t");
    expect(pass1).toContain("that/'s");
    expect(pass1).toContain("did/n't");
    expect(pass2).toBe(pass1);
    expect(pass3).toBe(pass1);
  });

  it('remains strictly idempotent when mixed with SALT error codes, mazes, omitted markers, and quotes', () => {
    const input = [
      "[0:00] C (I I) I telled[EW:told] my mom that it's a dog.",
      "[0:05] C He liked his[EP:her] shoes and John's dogs weren't happy.",
      "[0:10] C He walk/*3s to John's house and isn't late.",
      '[0:15] C She said "it\'s okay" and walked away.',
    ].join('\n');

    const pass1 = addInflectionalMorphemes(input, ['C', 'E']);
    const pass2 = addInflectionalMorphemes(pass1, ['C', 'E']);
    const pass3 = addInflectionalMorphemes(pass2, ['C', 'E']);

    expect(pass1).toContain('"it/\'s okay"');
    expect(pass1).toContain("were/n't");
    expect(pass2).toBe(pass1);
    expect(pass3).toBe(pass1);
  });

  it('tags newly added words cleanly while leaving previously coded morphemes untouched', () => {
    const partiallyCoded = "[0:00] C I/'m running to John/z dogs.";
    const result = addInflectionalMorphemes(partiallyCoded, ['C', 'E']);
    expect(result).toBe("[0:00] C I/'m run/ing to John/z dog/s.");
    expect(addInflectionalMorphemes(result, ['C', 'E'])).toBe(result);
  });

  it('preserves SALT clause codes ([SI-N]., [SI-X], [MC], [RC]) without duplicating terminal punctuation', () => {
    const input = [
      '[0:04] C [MC] It was a little boy [RC] that was going to the store [SI-2].',
      '[0:09] C He looked at[EW] [SI-1].',
      '[0:14] C Yes [SI-X].',
    ].join('\n');

    const pass1 = addInflectionalMorphemes(input, ['C', 'E']);
    expect(pass1).toBe(
      [
        '[0:04] C [MC] It was a little boy [RC] that was go/ing to the store [SI-2].',
        '[0:09] C He look/ed at[EW] [SI-1].',
        '[0:14] C Yes [SI-X].',
      ].join('\n')
    );
    expect(addInflectionalMorphemes(pass1, ['C', 'E'])).toBe(pass1);
  });
});
