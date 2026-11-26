import {
  LogitsProcessor,
  LogitsProcessorList,
  type AutomaticSpeechRecognitionPipeline,
  type Tensor,
} from '@huggingface/transformers';
import {
  groupTokensIntoWords,
  type TokenProbability,
  type WordProbability,
} from '../engine/wordConfidence';

/**
 * Records the probability of the token Whisper picks at each decoding step (greedy decoding
 * picks the highest-scoring token after all logits processors, so p = softmax max).
 * Must run LAST so it sees Whisper's timestamp rules; see RecorderLastProcessorList.
 */
export class TokenConfidenceRecorder extends LogitsProcessor {
  steps: Array<{ id: number; p: number }> = [];

  _call(_inputIds: bigint[][], logits: Tensor) {
    const row = (logits as unknown as Record<number, { data: Float32Array }>)[0];
    const data = row?.data;
    if (data && data.length > 0) {
      let max = -Infinity;
      let arg = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > max) {
          max = data[i];
          arg = i;
        }
      }
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v !== -Infinity) sum += Math.exp(v - max);
      }
      this.steps.push({ id: arg, p: sum > 0 ? 1 / sum : 0 });
    }
    return logits;
  }
}

/**
 * A logits-processor list that keeps the confidence recorder at the end, even when Whisper's
 * generate() pushes its own timestamp processor onto the list.
 */
export class RecorderLastProcessorList extends LogitsProcessorList {
  constructor(recorder: TokenConfidenceRecorder) {
    super();
    super.push(recorder);
  }

  push(item: LogitsProcessor) {
    this.processors.splice(Math.max(0, this.processors.length - 1), 0, item);
  }
}

/**
 * Converts recorded token probabilities into words, split into Whisper's timestamped segments
 * (a timestamp token closes a segment). Segment i corresponds to the pipeline's chunk i.
 */
export function tokenSegmentsFromRecorder(
  pipe: AutomaticSpeechRecognitionPipeline,
  recorder: TokenConfidenceRecorder
): WordProbability[][] {
  try {
    const tokenizer = pipe.tokenizer as unknown as {
      timestamp_begin?: number;
      decode: (ids: number[], opts?: { skip_special_tokens?: boolean }) => string;
    };
    const timestampBegin = tokenizer.timestamp_begin ?? Number.MAX_SAFE_INTEGER;
    const segments: WordProbability[][] = [];
    let current: TokenProbability[] = [];
    const close = () => {
      const words = groupTokensIntoWords(current);
      if (words.length > 0) segments.push(words);
      current = [];
    };
    for (const step of recorder.steps) {
      if (step.id < 0) continue;
      if (step.id >= timestampBegin) {
        close();
        continue;
      }
      const text = tokenizer.decode([step.id], { skip_special_tokens: true });
      if (text) current.push({ text, p: step.p });
    }
    close();
    return segments;
  } catch {
    return [];
  }
}
