import { describe, expect, it } from 'vitest';
import { computeSaltMetrics, describeMetricCalculation } from '../saltMetrics';

describe('computeSaltMetrics', () => {
  it('computes TNW, NDW, TTR, MLUw, MLUm, mazes, and errors per speaker', () => {
    const transcript = [
      '[0:00] E Tell me what happen/ed.',
      '[0:04] C (I I) I walk/ed the dog/s.',
      '[0:09] C He telled[EW:told] *a story.',
    ].join('\n');

    const metrics = computeSaltMetrics(transcript, { speaker1: 'C', speaker2: 'E' }, 60);

    // Child utterances:
    // 1) "I walk/ed the dog/s." -> 4 spoken words, 2 bound morphemes (/ed, /s) -> 6 morphemes; maze "(I I)" = 1 maze, 2 maze words
    // 2) "He telled[EW:told] *a story." -> 3 spoken words ("*a" is omitted, not spoken), 0 bound morphemes -> 3 morphemes; 1 error, 1 omission
    expect(metrics.speaker1.totalUtterances).toBe(2);
    expect(metrics.speaker1.totalWords).toBe(7);
    expect(metrics.speaker1.boundMorphemes).toBe(2);
    expect(metrics.speaker1.totalMorphemes).toBe(9);
    expect(metrics.speaker1.mluWords).toBe(3.5);
    expect(metrics.speaker1.mluMorphemes).toBe(4.5);
    expect(metrics.speaker1.mazeCount).toBe(1);
    expect(metrics.speaker1.mazeWords).toBe(2);
    expect(metrics.speaker1.errorCount).toBe(1);
    expect(metrics.speaker1.omissionCount).toBe(1);

    // Examiner utterance: "Tell me what happen/ed." -> 4 words, 1 bound morpheme -> 5 morphemes
    expect(metrics.speaker2.totalUtterances).toBe(1);
    expect(metrics.speaker2.totalWords).toBe(4);
    expect(metrics.speaker2.mluMorphemes).toBe(5);
    expect(metrics.speaker1.clausalDensity).toBeNull();
    expect(metrics.durationSeconds).toBe(60);
  });

  it('computes clausal density (SALT SI), total clauses, complex %, and SI distribution without inflating words or errors', () => {
    const transcript = [
      '[0:00] E Tell me what happen/ed [SI-2].',
      '[0:04] C He walk/ed home [SI-1].',
      '[0:09] C [MC] It was a boy [RC] that like/ed dog/s [SI-2].',
      '[0:15] C She ran because she was scared when it rain/ed [SI-3].',
      '[0:21] C He *is happy [SI-0].',
      '[0:25] C Yes [SI-X].',
      '[0:30] C [MC] The cat jump/ed [AC] when I clap/ed.',
    ].join('\n');

    const metrics = computeSaltMetrics(transcript, { speaker1: 'C', speaker2: 'E' });

    // Child scored utterances: SI-1 (1), SI-2 (2), SI-3 (3), SI-0 (0), inline [MC]+[AC] (2) -> 5 scored, 8 clauses, 1 excluded (SI-X)
    expect(metrics.speaker1.clauseScoredUtterances).toBe(5);
    expect(metrics.speaker1.clauseExcludedUtterances).toBe(1);
    expect(metrics.speaker1.totalClauses).toBe(8);
    expect(metrics.speaker1.clausalDensity).toBe(1.6); // 8 / 5
    expect(metrics.speaker1.complexUtterances).toBe(3); // SI-2, SI-3, inline 2
    expect(metrics.speaker1.complexUtterancePercent).toBe(60);
    expect(metrics.speaker1.siDistribution).toEqual({
      si0: 1,
      si1: 1,
      si2: 2,
      si3Plus: 1,
      siX: 1,
    });
    // Clause tags must never be counted as SALT errors
    expect(metrics.speaker1.errorCount).toBe(0);
    // "[0:04] C He walk/ed home [SI-1]." -> 3 words, "[0:09]..." -> 7 words, "[0:15]..." -> 9 words,
    // "[0:21]..." -> 2 spoken words ("*is" omitted), "[0:25]..." -> 1 word, "[0:30]..." -> 6 words = 28 spoken words
    expect(metrics.speaker1.totalWords).toBe(28);

    // Examiner: 1 scored utterance with 2 clauses -> CD = 2.00
    expect(metrics.speaker2.clausalDensity).toBe(2);
    expect(metrics.speaker2.totalClauses).toBe(2);
    expect(metrics.speaker2.complexUtterancePercent).toBe(100);
  });

  it('describes live formula and substituted calculation for every SALT metric', () => {
    const transcript = [
      '[0:04] C (I I) I walk/ed the dog/s [SI-1].',
      '[0:09] C He telled[EW:told] *a story that I like/ed [SI-2].',
      '[0:15] C Yes [SI-X].',
    ].join('\n');

    const metrics = computeSaltMetrics(transcript, { speaker1: 'C', speaker2: 'E' }, 90);
    const s = metrics.speaker1;

    const mlum = describeMetricCalculation('mluMorphemes', s, metrics.durationSeconds);
    expect(mlum.formula).toContain('Bound Morphemes');
    expect(mlum.calculation).toContain(`${s.totalWords} words + ${s.boundMorphemes} bound`);
    expect(mlum.calculation).toContain(s.mluMorphemes.toFixed(2));

    const cd = describeMetricCalculation('clausalDensity', s, metrics.durationSeconds);
    expect(cd.formula).toBe('Total Clauses ÷ Clause-Scored Utterances');
    expect(cd.calculation).toContain('3 clauses ÷ 2 scored utterances = 1.50');
    expect(cd.calculation).toContain('1 excluded [SI-X]');

    const complex = describeMetricCalculation('complexUtterancePercent', s);
    expect(complex.calculation).toContain('1 multi-clause utterances ÷ 2 scored × 100 = 50%');

    const wpm = describeMetricCalculation('wordsPerMinute', s, 90);
    expect(wpm.calculation).toContain('90.0s ÷ 60 = 1.50 min');

    const mazes = describeMetricCalculation('mazeWordPercent', s);
    expect(mazes.calculation).toContain('2 maze words');

    const codes = describeMetricCalculation('errorAndOmissionCount', s);
    expect(codes.calculation).toBe('1 error codes + 1 omissions = 2 total codes');
  });
});
