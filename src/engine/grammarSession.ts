import type { GrammarCheckOptions } from '../types/saltify';
import { correctSentence } from './childGrammarEngine';
import { addInflectionalMorphemes, splitSentences } from './saltConventions';

export interface GrammarStepResult {
  passedLines: string[];
  nextCorrection: string | null;
  originalLine: string | null;
  progress: number;
  done: boolean;
}

/**
 * Stateful step-by-step SALT grammar review session mirroring
 * oss-slu/SpeechTranscription grammar.py GrammarChecker, plus a
 * batch auto-apply helper for clinicians reviewing long samples.
 */
export class GrammarCheckerSession {
  private queue: string[] = [];
  private totalCount = 0;
  private options: GrammarCheckOptions;
  private speakerAliases: string[];

  constructor(
    transcriptionText: string,
    options: Partial<GrammarCheckOptions> = {},
    speakerAliases: readonly string[] = ['C', 'E']
  ) {
    this.options = {
      checkAllSentences: options.checkAllSentences ?? false,
      codeFillerMazes: options.codeFillerMazes ?? true,
      useOverregularizationTag: options.useOverregularizationTag ?? false,
    };
    this.speakerAliases = [...speakerAliases];
    this.queue = splitSentences(transcriptionText);
    this.totalCount = this.queue.length;
  }

  getProgress(): number {
    if (this.totalCount === 0) return 1;
    return 1 - this.queue.length / this.totalCount;
  }

  getRemainingCount(): number {
    return this.queue.length;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  /**
   * Advances through lines until either a suggested SALT edit is found
   * (or every line if checkAllSentences is enabled) or the queue finishes.
   */
  getNextCorrection(): GrammarStepResult {
    const passedLines: string[] = [];

    while (this.queue.length > 0) {
      const original = this.queue.shift()!;
      const suggested = correctSentence(original, this.options, this.speakerAliases);
      if (suggested !== original || this.options.checkAllSentences) {
        return {
          passedLines,
          nextCorrection: suggested,
          originalLine: original,
          progress: this.getProgress(),
          done: false,
        };
      }
      passedLines.push(original);
    }

    return {
      passedLines,
      nextCorrection: null,
      originalLine: null,
      progress: 1,
      done: true,
    };
  }

  /**
   * Applies suggested SALT error coding to all remaining lines in the queue at once.
   */
  applyAllRemaining(): string[] {
    const results: string[] = [];
    while (this.queue.length > 0) {
      const original = this.queue.shift()!;
      results.push(correctSentence(original, this.options, this.speakerAliases));
    }
    return results;
  }

  getInflectionalMorphemes(text: string): string {
    return addInflectionalMorphemes(text, this.speakerAliases);
  }
}
