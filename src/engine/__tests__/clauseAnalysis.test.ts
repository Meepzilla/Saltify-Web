import { describe, expect, it } from 'vitest';
import {
  autoMarkClausesInTranscript,
  estimateUtteranceClauses,
  parseBodyIntoClauseWordSlots,
  parseUtteranceClauseCoding,
  reconstructSurfaceWordFromSalt,
  setInlineClauseTagAtWord,
  setUtteranceSiCode,
  stripAllClauseCodes,
} from '../clauseAnalysis';
import { DEMO_TRANSCRIPT } from '../sampleData';

describe('clauseAnalysis parsing & manipulation', () => {
  it('parses explicit SALT [SI-N] and [SI-X] codes accurately', () => {
    expect(parseUtteranceClauseCoding('He walk/ed home [SI-1].')).toEqual({
      siCode: 1,
      inlineClauseTags: [],
      clauseCount: 1,
      isExcluded: false,
      isScored: true,
      source: 'si',
    });

    expect(parseUtteranceClauseCoding('Yes [SI-X].')).toEqual({
      siCode: 'X',
      inlineClauseTags: [],
      clauseCount: null,
      isExcluded: true,
      isScored: false,
      source: 'si',
    });

    expect(parseUtteranceClauseCoding('He *is happy [SI-0].')).toEqual({
      siCode: 0,
      inlineClauseTags: [],
      clauseCount: 0,
      isExcluded: false,
      isScored: true,
      source: 'si',
    });

    // Also supports [SI-2] placed after terminal punctuation
    expect(parseUtteranceClauseCoding('She ran because she was scared. [SI-2]')).toMatchObject({
      siCode: 2,
      clauseCount: 2,
      isScored: true,
    });
  });

  it('counts inline clause markers when [SI-*] is absent and avoids double-counting when both exist', () => {
    const inlineOnly = parseUtteranceClauseCoding(
      '[MC] It was a little boy [RC] that was go/ing to the store.'
    );
    expect(inlineOnly.clauseCount).toBe(2);
    expect(inlineOnly.inlineClauseTags).toEqual(['MC', 'RC']);
    expect(inlineOnly.source).toBe('inline');
    expect(inlineOnly.isScored).toBe(true);

    // Explicit [SI-2] is authoritative even when inline tags are also present
    const both = parseUtteranceClauseCoding(
      '[MC] It was a little boy [RC] that was go/ing to the store [SI-2].'
    );
    expect(both.clauseCount).toBe(2);
    expect(both.inlineClauseTags).toEqual(['MC', 'RC']);
    expect(both.source).toBe('si');
  });

  it('sets, replaces, and clears [SI-*] codes cleanly while preserving SALT terminal punctuation', () => {
    expect(setUtteranceSiCode('[0:04] C He walk/ed home.', 1)).toBe(
      '[0:04] C He walk/ed home [SI-1].'
    );
    expect(setUtteranceSiCode('[0:04] C He walk/ed home [SI-1].', 2)).toBe(
      '[0:04] C He walk/ed home [SI-2].'
    );
    expect(setUtteranceSiCode('[0:04] C He walk/ed home. [SI-1]', 3)).toBe(
      '[0:04] C He walk/ed home [SI-3].'
    );
    expect(setUtteranceSiCode('[0:04] C He started to>', 'X')).toBe(
      '[0:04] C He started to [SI-X]>'
    );
    expect(setUtteranceSiCode('[0:04] C He walk/ed home [SI-2].', null)).toBe(
      '[0:04] C He walk/ed home.'
    );
  });

  it('inserts and removes inline clause tags at word boundaries and syncs [SI-N]', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const line = '[0:04] C It was a little boy that was go/ing to the store.';

    const withMain = setInlineClauseTagAtWord(line, 0, 'MC', aliases);
    expect(withMain).toBe(
      '[0:04] C [MC] It was a little boy that was go/ing to the store [SI-1].'
    );

    const withRel = setInlineClauseTagAtWord(withMain, 5, 'RC', aliases);
    expect(withRel).toBe(
      '[0:04] C [MC] It was a little boy [RC] that was go/ing to the store [SI-2].'
    );

    const slots = parseBodyIntoClauseWordSlots(
      '[MC] It was a little boy [RC] that was go/ing to the store [SI-2].'
    );
    expect(slots[0]).toMatchObject({ word: 'It', clauseTagBefore: 'MC' });
    expect(slots[5]).toMatchObject({ word: 'that', clauseTagBefore: 'RC' });

    const removedRel = setInlineClauseTagAtWord(withRel, 5, null, aliases);
    expect(removedRel).toBe(
      '[0:04] C [MC] It was a little boy that was go/ing to the store [SI-1].'
    );

    expect(stripAllClauseCodes(withRel)).toBe(line);
  });

  it('reconstructs plain surface words from SALT morpheme slash tokens', () => {
    expect(reconstructSurfaceWordFromSalt('walk/ed')).toBe('walked');
    expect(reconstructSurfaceWordFromSalt('go/3s')).toBe('goes');
    expect(reconstructSurfaceWordFromSalt('walk/*3s')).toBe('walks');
    expect(reconstructSurfaceWordFromSalt('dog/s')).toBe('dogs');
    expect(reconstructSurfaceWordFromSalt('John/z')).toBe("John's");
    expect(reconstructSurfaceWordFromSalt("I/'m")).toBe("I'm");
    expect(reconstructSurfaceWordFromSalt("is/n't")).toBe("isn't");
  });
});

describe('estimateUtteranceClauses (SALT SI auto-suggester)', () => {
  it('follows SALT SI rules for simple, infinitive, subordinate, compound predicate, omitted copula, and excluded utterances', () => {
    // Simple 1-clause utterances
    expect(estimateUtteranceClauses('The dog barked.').suggestedSi).toBe(1);
    expect(estimateUtteranceClauses('The dog bark/ed.').suggestedSi).toBe(1);

    // Infinitive clauses do NOT receive extra SI credit in SALT
    expect(estimateUtteranceClauses('He wanted to buy some cookies.').suggestedSi).toBe(1);
    expect(estimateUtteranceClauses('The dog want/ed to run away.').suggestedSi).toBe(1);

    // Compound predicate sharing one subject = 1 clause
    expect(estimateUtteranceClauses('He jumped and laughed.').suggestedSi).toBe(1);

    // Coordinated clauses with two distinct subjects = 2 clauses
    expect(estimateUtteranceClauses('He jumped and she laughed.').suggestedSi).toBe(2);

    // Relative & adverbial subordinate clauses
    expect(
      estimateUtteranceClauses('Okay, it was a little boy that was going to the store.').suggestedSi
    ).toBe(2);
    expect(
      estimateUtteranceClauses('She ran away because she was scared when the dog barked.').suggestedSi
    ).toBe(3);

    // Inverted question remains 1 clause; embedded wh-clause makes 2
    expect(estimateUtteranceClauses('Did you see the dog?').suggestedSi).toBe(1);
    expect(estimateUtteranceClauses('Did you see what he did?').suggestedSi).toBe(2);

    // Imperative + nominal wh-clause
    expect(
      estimateUtteranceClauses('Tell me what happened in the story about the little boy.').suggestedSi
    ).toBe(2);

    // Omitted obligatory copula = SI-0
    expect(estimateUtteranceClauses('He *is happy.').suggestedSi).toBe(0);

    // Abandoned / interrupted / unintelligible / elliptical = SI-X
    expect(estimateUtteranceClauses('He started to>').suggestedSi).toBe('X');
    expect(estimateUtteranceClauses('He went to XXX.').suggestedSi).toBe('X');
    expect(estimateUtteranceClauses('Yes.').suggestedSi).toBe('X');
  });

  it('auto-marks clauses across DEMO_TRANSCRIPT with speaker filtering and preserves existing marks when onlyUnmarked is set', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const childOnly = autoMarkClausesInTranscript(DEMO_TRANSCRIPT, aliases, {
      speakerFilter: 'speaker1',
    });

    expect(childOnly.updatedCount).toBe(11);
    const lines = childOnly.text.split('\n');
    // Examiner lines untouched
    expect(lines[0]).not.toContain('[SI-');
    expect(lines[5]).not.toContain('[SI-');
    // Child lines marked
    expect(lines[1]).toContain('[SI-2].');
    expect(lines[2]).toContain('[SI-1].');
    expect(lines[3]).toContain('[SI-2].');

    // Manual override is preserved when onlyUnmarked=true
    const manual = lines.map((l, idx) => (idx === 1 ? setUtteranceSiCode(l, 3) : l)).join('\n');
    const fillRest = autoMarkClausesInTranscript(manual, aliases, {
      speakerFilter: 'all',
      onlyUnmarked: true,
    });
    expect(fillRest.updatedCount).toBe(2); // only the 2 examiner lines were unmarked
    expect(fillRest.text.split('\n')[1]).toContain('[SI-3].');
  });
});
