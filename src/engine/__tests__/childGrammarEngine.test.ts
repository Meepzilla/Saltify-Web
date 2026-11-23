import { describe, expect, it } from 'vitest';
import { correctSentence } from '../childGrammarEngine';
import { GrammarCheckerSession } from '../grammarSession';

describe('correctSentence (ported from SpeechTranscription tests/test_correctSentence.py + pediatric rules)', () => {
  it('test_one: codes omitted 3rd-person singular morpheme /*3s', () => {
    expect(correctSentence('He walk to school.')).toBe('He walk/*3s to school.');
  });

  it('test_two: codes word repetitions as maze and irregular past overregularization', () => {
    expect(correctSentence('I I I telled a lie.')).toBe(
      '(I I) I telled[EW:told] a lie.'
    );
  });

  it('supports optional [EO:...] tag for overregularizations', () => {
    expect(
      correctSentence('He goed home with dirty foots.', {
        useOverregularizationTag: true,
      })
    ).toBe('He goed[EO:went] home with dirty foots[EO:feet].');
  });

  it('codes subject-verb agreement errors and omitted auxiliaries', () => {
    expect(correctSentence('They was playing.')).toBe('They was[EW:were] playing.');
    expect(correctSentence('He are happy.')).toBe('He are[EW:is] happy.');
    expect(correctSentence('He running fast.')).toBe('He *is running fast.');
  });

  it('codes pronoun case errors and article mismatches', () => {
    expect(correctSentence('Me want a elephant.')).toBe(
      'Me[EW:I] want a[EW:an] elephant.'
    );
  });

  it('codes 2-word phrase repetitions and optional filler mazes while preserving timestamp & speaker', () => {
    expect(
      correctSentence('[0:28] C Um and a and a dog went home.', {
        codeFillerMazes: true,
      })
    ).toBe('[0:28] C (Um) (and a) and a dog went home.');
  });

  it('steps through flagged utterances in GrammarCheckerSession', () => {
    const transcript = [
      '[0:00] E Tell me the story.',
      '[0:04] C He walk to school.',
      '[0:09] C The dog was very mad.',
      '[0:14] C I I I telled a lie.',
    ].join('\n');

    const session = new GrammarCheckerSession(transcript, {
      checkAllSentences: false,
      codeFillerMazes: true,
    });

    const step1 = session.getNextCorrection();
    expect(step1.passedLines).toEqual(['[0:00] E Tell me the story.']);
    expect(step1.nextCorrection).toBe('[0:04] C He walk/*3s to school.');
    expect(step1.done).toBe(false);

    const step2 = session.getNextCorrection();
    expect(step2.passedLines).toEqual(['[0:09] C The dog was very mad.']);
    expect(step2.nextCorrection).toBe('[0:14] C (I I) I telled[EW:told] a lie.');
    expect(step2.done).toBe(false);

    const step3 = session.getNextCorrection();
    expect(step3.done).toBe(true);
    expect(step3.nextCorrection).toBeNull();
  });
});
