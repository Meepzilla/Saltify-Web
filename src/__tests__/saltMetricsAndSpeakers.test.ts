import { describe, expect, it } from 'vitest';
import { computeSaltMetrics } from '../lib/salt/metrics';
import {
  applySpeakerLabelsToLines,
  parseTimestampSeconds,
  renameSpeakerAliasesInText,
  stripTimestamps,
} from '../lib/salt/speakers';
import { buildSaltFileContent } from '../lib/export/exporters';
import { createDefaultClientInfo, createDefaultSpeakerAliases } from '../types/session';

describe('SALT clinical metrics', () => {
  const aliases = createDefaultSpeakerAliases();

  it('computes utterances, TNW, NDW, MLU-w, MLU-m, mazes, and error codes accurately', () => {
    const sample = [
      '[0:00] E What happened?',
      '[0:04] C (The) the dog walk/ed home.',
      '[0:09] C He like/ed John/z dog/s.',
      '[0:14] C He walk/*3s fast.',
    ].join('\n');

    const childMetrics = computeSaltMetrics(sample, aliases, 'speaker1');
    expect(childMetrics.totalUtterances).toBe(3);
    // Main-body words (excluding maze "(The)"):
    // line 1: the dog walk home (4 words, 5 morphemes: walk + /ed)
    // line 2: He like John dog (4 words, 7 morphemes: like+/ed, John+/z, dog+/s)
    // line 3: He walk fast (3 words, 3 morphemes because /*3s is omitted!)
    expect(childMetrics.totalWords).toBe(11);
    expect(childMetrics.totalMorphemes).toBe(15);
    expect(childMetrics.mluWords).toBeCloseTo(11 / 3, 2);
    expect(childMetrics.mluMorphemes).toBeCloseTo(15 / 3, 2);
    expect(childMetrics.mazeCount).toBe(1);
    expect(childMetrics.errorCodeCount).toBe(1);
  });
});

describe('Speaker labeling, aliases, and timestamps', () => {
  it('parses and strips [m:ss] timestamps', () => {
    expect(parseTimestampSeconds('[1:25] C Hello there.')).toBe(85);
    expect(stripTimestamps('[0:04] C Hello.\n[1:02] E Hi.')).toBe('C Hello.\nE Hi.');
  });

  it('applies speaker labels and replaces previous labels cleanly', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const input = '[0:00] Hello there.\n[0:03] E Wait a second.';
    const labeled = applySpeakerLabelsToLines(input, new Set([0, 1]), 'speaker1', aliases);
    expect(labeled).toBe('[0:00] C Hello there.\n[0:03] C Wait a second.');
  });

  it('renames speaker aliases across transcript lines', () => {
    const input = '[0:00] C Hello.\n[0:04] E How are you?';
    const renamed = renameSpeakerAliasesInText(
      input,
      { speaker1: 'C', speaker2: 'E' },
      { speaker1: 'Child', speaker2: 'SLP' }
    );
    expect(renamed).toBe('[0:00] Child Hello.\n[0:04] SLP How are you?');
  });
});

describe('SALT .slt export builder', () => {
  it('generates valid SALT Software header and strips timestamps', () => {
    const info = {
      ...createDefaultClientInfo(),
      name: 'Student A',
      age: '5;4',
      gender: 'F',
      dateOfSample: '2026-11-22',
      examinerName: 'Dr. Smith',
      samplingContext: 'Narration',
    };
    const slt = buildSaltFileContent(
      '[0:00] E Tell me.\n[0:05] C He walk/ed home.',
      info,
      { speaker1: 'C', speaker2: 'E' }
    );

    expect(slt).toContain('$ C, E');
    expect(slt).toContain('+ Name: Student A');
    expect(slt).toContain('+ CA: 5;4');
    expect(slt).toContain('- 0:00');
    expect(slt).toContain('C He walk/ed home.');
    expect(slt).not.toContain('[0:05]');
  });
});
