import { describe, expect, it } from 'vitest';
import { computeSaltMetrics } from '../saltMetrics';

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
  });
});
