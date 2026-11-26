import { describe, expect, it } from 'vitest';
import {
  classifySamplingContext,
  compareToNorms,
  formatZScore,
  millerChapmanMlum,
  parseAgeToMonths,
  resolveAgeMonths,
  statusFromZ,
} from '../languageNorms';
import { computeSaltMetrics } from '../saltMetrics';
import { DEMO_CLIENT_INFO, DEMO_TRANSCRIPT } from '../sampleData';
import type { SpeakerMetrics } from '../../types/saltify';

function makeStats(overrides: Partial<SpeakerMetrics> = {}): SpeakerMetrics {
  return {
    speaker: 'C',
    totalUtterances: 60,
    completeIntelligibleUtterances: 55,
    ciWords: 236,
    ciMorphemes: 251,
    allWords: 250,
    totalWords: 236,
    uniqueWords: 110,
    typeTokenRatio: 0.47,
    mluWords: 4.29,
    totalMorphemes: 251,
    boundMorphemes: 15,
    mluMorphemes: 4.56,
    mazeCount: 8,
    mazeWords: 25,
    mazeWordPercent: 9,
    errorCount: 1,
    omissionCount: 0,
    wordsPerMinute: 80,
    totalClauses: 66,
    clauseScoredUtterances: 55,
    clauseExcludedUtterances: 0,
    clausalDensity: 1.2,
    complexUtterances: 10,
    complexUtterancePercent: 18,
    siDistribution: { si0: 0, si1: 45, si2: 9, si3Plus: 1, siX: 0 },
    ...overrides,
  };
}

const info = (age: string, samplingContext = 'Conversation') => ({
  age,
  dateOfBirth: '',
  dateOfSample: '',
  samplingContext,
});

describe('age parsing', () => {
  it('parses SALT and free-text age formats', () => {
    expect(parseAgeToMonths('4;6')).toBe(54);
    expect(parseAgeToMonths('4;6.12')).toBe(54);
    expect(parseAgeToMonths('4:0')).toBe(48);
    expect(parseAgeToMonths('4y 6m')).toBe(54);
    expect(parseAgeToMonths('4 years 6 months')).toBe(54);
    expect(parseAgeToMonths('54 months')).toBe(54);
    expect(parseAgeToMonths('5')).toBe(60);
    expect(parseAgeToMonths('4;13')).toBeNull();
    expect(parseAgeToMonths('4.6')).toBeNull();
    expect(parseAgeToMonths('')).toBeNull();
  });

  it('falls back to date of birth and date of sample', () => {
    expect(resolveAgeMonths({ age: '', dateOfBirth: '2021-03-15', dateOfSample: '2025-09-14' })).toBe(53);
    expect(resolveAgeMonths({ age: '', dateOfBirth: '2021-03-15', dateOfSample: '2025-09-15' })).toBe(54);
    expect(resolveAgeMonths({ age: '', dateOfBirth: '', dateOfSample: '2025-09-15' })).toBeNull();
  });
});

describe('sampling context', () => {
  it('maps presets to norm genres', () => {
    expect(classifySamplingContext('Conversation')).toEqual({ context: 'conversation', assumed: false });
    expect(classifySamplingContext('Play')).toEqual({ context: 'conversation', assumed: false });
    expect(classifySamplingContext('Narrative Retell')).toEqual({ context: 'narrative', assumed: false });
    expect(classifySamplingContext('Picture Description')).toEqual({ context: 'narrative', assumed: false });
    expect(classifySamplingContext('Expository')).toEqual({ context: 'expository', assumed: false });
    expect(classifySamplingContext('Persuasion')).toEqual({ context: 'expository', assumed: false });
    expect(classifySamplingContext('')).toEqual({ context: 'conversation', assumed: true });
  });
});

describe('z-score interpretation', () => {
  it('uses SALT-style SD bands', () => {
    expect(statusFromZ(0)).toBe('wnl');
    expect(statusFromZ(-1)).toBe('wnl');
    expect(statusFromZ(-1.2)).toBe('borderline');
    expect(statusFromZ(-1.5)).toBe('significant');
    expect(statusFromZ(1.4)).toBe('above');
    expect(statusFromZ(1.6, true)).toBe('significant');
  });

  it('formats signed z-scores consistently', () => {
    expect(formatZScore(1.25)).toBe('+1.25');
    expect(formatZScore(-1.8)).toBe('-1.80');
    expect(formatZScore(0)).toBe('0.00');
    expect(formatZScore(null)).toBe('—');
  });

  it('matches Miller & Chapman (1981) published benchmarks', () => {
    const at36 = millerChapmanMlum(36);
    expect(at36.mean).toBeCloseTo(3.16, 2);
    expect(at36.sd).toBeCloseTo(0.69, 2);
  });
});

describe('compareToNorms', () => {
  it('compares a 4;2 conversation sample with Rice et al. (2010) and SUGAR', () => {
    const report = compareToNorms(makeStats({ mluMorphemes: 3.2 }), info('4;2'));
    expect(report.ageLabel).toBe('4;2');
    expect(report.smallSample).toBe(false);

    const mlum = report.comparisons.find((c) => c.key === 'mluMorphemes');
    expect(mlum?.mean).toBe(4.57);
    expect(mlum?.sd).toBe(0.76);
    expect(mlum?.z).toBeCloseTo(-1.8, 2);
    expect(mlum?.status).toBe('significant');
    expect(mlum?.source).toContain('4;0–4;5');

    const cd = report.comparisons.find((c) => c.key === 'clausalDensity');
    expect(cd?.mean).toBe(1.19);
    expect(cd?.status).toBe('wnl');

    const tnw = report.comparisons.find((c) => c.key === 'totalWords');
    expect(tnw?.value).toBe(Math.round((236 / 55) * 50));

    const maze = report.comparisons.find((c) => c.key === 'mazeWordPercent');
    expect(maze?.status).toBe('wnl');
    expect(report.comparisons.some((c) => c.key === 'intelligibility')).toBe(true);
  });

  it('flags high maze percentages', () => {
    const report = compareToNorms(makeStats({ mazeWordPercent: 22 }), info('6;0'));
    expect(report.comparisons.find((c) => c.key === 'mazeWordPercent')?.status).toBe('significant');
  });

  it('uses Miller & Chapman for toddlers', () => {
    const report = compareToNorms(makeStats({ mluMorphemes: 1.9 }), info('2;0'));
    const mlum = report.comparisons.find((c) => c.key === 'mluMorphemes');
    expect(mlum?.source).toContain('Miller & Chapman');
    expect(mlum?.status).toBe('wnl');
  });

  it('marks conversation MLU norms as a context mismatch for narratives and uses genre CD bands', () => {
    const report = compareToNorms(makeStats({ clausalDensity: 1.0 }), info('6;3', 'Narrative Retell'));
    expect(report.context).toBe('narrative');
    expect(report.comparisons.find((c) => c.key === 'mluMorphemes')?.contextMatch).toBe(false);
    const cd = report.comparisons.find((c) => c.key === 'clausalDensity');
    expect(cd?.z).toBeNull();
    expect(cd?.status).toBe('borderline');
  });

  it('falls back to reference clausal density bands for ages 8+ in conversation', () => {
    const schoolAge = compareToNorms(makeStats({ clausalDensity: 1.4 }), info('10;0', 'Conversation'));
    const cdSchool = schoolAge.comparisons.find((c) => c.key === 'clausalDensity');
    expect(cdSchool?.rangeLabel).toBe('1.30–1.50');
    expect(cdSchool?.z).toBeNull();
    expect(cdSchool?.status).toBe('wnl');

    const teen = compareToNorms(makeStats({ clausalDensity: 1.35 }), info('15;0', 'Conversation'));
    const cdTeen = teen.comparisons.find((c) => c.key === 'clausalDensity');
    expect(cdTeen?.rangeLabel).toBe('1.50–1.60');
    expect(cdTeen?.status).toBe('borderline');
  });

  it('explains when age is missing or the sample is small', () => {
    expect(compareToNorms(makeStats(), info('')).unavailableReason).toMatch(/age/i);
    expect(compareToNorms(makeStats({ completeIntelligibleUtterances: 20 }), info('5;0')).smallSample).toBe(true);
  });

  it('evaluates the built-in demo transcript and client info end-to-end', () => {
    const metrics = computeSaltMetrics(DEMO_TRANSCRIPT, { speaker1: 'C', speaker2: 'E' });
    const report = compareToNorms(metrics.speaker1, DEMO_CLIENT_INFO);
    expect(report.ageLabel).toBe('4;8');
    expect(report.context).toBe('narrative');
    expect(report.smallSample).toBe(true);
    expect(report.comparisons.map((c) => c.key)).toEqual([
      'mluMorphemes',
      'mluWords',
      'totalWords',
      'mazeWordPercent',
      'intelligibility',
    ]);
  });
});
