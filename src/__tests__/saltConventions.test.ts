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

describe('addInflectionalMorphemesToTranscript idempotency (repeated Add Morphemes presses)', () => {
  it('never duplicates slashes on contractions, possessives, plurals, or verb inflections across multiple presses', () => {
    const input = [
      "[0:00] E Tell me what happened in the story about John's dogs.",
      "[0:05] C I'm not doing my homework, but I can't do it now anyway.",
      "[0:10] C It's John's dog and he's running, she'll play, they've walked, we're here, I'd go.",
      "[0:16] C He didn't stop, couldn't jump, isn't fun, won't go, and don't run.",
      "[0:22] C And that's all!",
    ].join('\n');

    const pass1 = addInflectionalMorphemesToTranscript(input, ['C', 'E']);
    const pass2 = addInflectionalMorphemesToTranscript(pass1, ['C', 'E']);
    const pass3 = addInflectionalMorphemesToTranscript(pass2, ['C', 'E']);

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

    const pass1 = addInflectionalMorphemesToTranscript(input, ['C', 'E']);
    const pass2 = addInflectionalMorphemesToTranscript(pass1, ['C', 'E']);
    const pass3 = addInflectionalMorphemesToTranscript(pass2, ['C', 'E']);

    expect(pass1).toContain('"it/\'s okay"');
    expect(pass1).toContain("were/n't");
    expect(pass2).toBe(pass1);
    expect(pass3).toBe(pass1);
  });

  it('tags newly added words cleanly while leaving previously coded morphemes untouched', () => {
    const partiallyCoded = "[0:00] C I/'m running to John/z dogs.";
    const result = addInflectionalMorphemesToTranscript(partiallyCoded, ['C', 'E']);
    expect(result).toBe("[0:00] C I/'m run/ing to John/z dog/s.");
    expect(addInflectionalMorphemesToTranscript(result, ['C', 'E'])).toBe(result);
  });
});

