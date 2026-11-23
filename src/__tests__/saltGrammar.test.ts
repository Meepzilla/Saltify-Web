import { describe, expect, it } from 'vitest';
import { GrammarChecker, analyzeSentence, correctSentence } from '../lib/salt/grammarEngine';

describe('correctSentence (ported from upstream test_correctSentence.py + child speech rules)', () => {
  it('codes omitted 3rd-person singular -s as /*3s', () => {
    expect(correctSentence('He walk to school.')).toBe('He walk/*3s to school.');
  });

  it('codes repeated word mazes and overgeneralized irregular past tense', () => {
    expect(correctSentence('I I I telled a lie.')).toBe('(I I) I telled[EW:told] a lie.');
  });

  it('codes common child irregular past tense overgeneralizations', () => {
    expect(correctSentence('She goed to the store and runned home.')).toBe(
      'She goed[EW:went] to the store and runned[EW:ran] home.'
    );
  });

  it('codes irregular plural overgeneralizations', () => {
    expect(correctSentence('My foots hurt and the childs cried.')).toBe(
      'My foots[EW:feet] hurt and the childs[EW:children] cried.'
    );
  });

  it('codes subject-verb agreement errors for be/have/do', () => {
    expect(correctSentence('They was playing outside.')).toBe('They was[EW:were] playing outside.');
    expect(correctSentence('He are happy.')).toBe('He are[EW:is] happy.');
    expect(correctSentence("She don't like carrots.")).toBe("She don't[EW:doesn't] like carrots.");
  });

  it('codes omitted progressive auxiliary with asterisk', () => {
    expect(correctSentence('He running fast.')).toBe('He is* running fast.');
  });

  it('codes pronoun case errors as [EP:target]', () => {
    expect(correctSentence('Me want a cookie.')).toBe('Me[EP:I] want a cookie.');
  });

  it('codes indefinite article a/an mismatches', () => {
    expect(correctSentence('I saw a elephant.')).toBe('I saw a[EW:an] elephant.');
    expect(correctSentence('I have an dog.')).toBe('I have an[EW:a] dog.');
  });

  it('codes missing plural after quantifiers greater than one', () => {
    expect(correctSentence('He wanted two cookie.')).toBe('He wanted two cookie[EW:cookies].');
  });

  it('preserves leading timestamps and speaker prefixes during grammar analysis', () => {
    const result = analyzeSentence('[0:15] C I I I telled a lie.', ['C', 'E']);
    expect(result.changed).toBe(true);
    expect(result.coded).toBe('[0:15] C (I I) I telled[EW:told] a lie.');
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GrammarChecker step-by-step workflow', () => {
  it('passes clean lines through and pauses on flagged lines', () => {
    const checker = new GrammarChecker();
    checker.start(
      [
        '[0:00] E Tell me your story.',
        '[0:04] C He walk to school.',
        '[0:09] C The dog barked.',
        '[0:12] C Me want two cookie.',
      ].join('\n'),
      false,
      ['C', 'E']
    );

    const step1 = checker.getNextCorrection();
    expect(step1.done).toBe(false);
    expect(step1.passedThrough).toBe('[0:00] E Tell me your story.\n');
    expect(step1.nextSuggestion).toBe('[0:04] C He walk/*3s to school.');

    const step2 = checker.getNextCorrection();
    expect(step2.done).toBe(false);
    expect(step2.passedThrough).toBe('[0:09] C The dog barked.\n');
    expect(step2.nextSuggestion).toBe('[0:12] C Me[EP:I] want two cookie[EW:cookies].');

    const step3 = checker.getNextCorrection();
    expect(step3.done).toBe(true);
    expect(step3.nextSuggestion).toBeNull();
    expect(checker.getProgress()).toBe(1);
  });
});
