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
 * Each generated token's text as it appears in the decoded output (including its leading space),
 * found by decoding the sequence cumulatively. Used for tokenizers whose single-token decode
 * drops word-boundary markers. Costs O(n²) decoding, fine for utterance-length outputs.
 */
function incrementalTokenTexts(
  tokenizer: { decode: (ids: number[], opts?: { skip_special_tokens?: boolean }) => string },
  recorder: TokenConfidenceRecorder
): TokenProbability[] {
  const out: TokenProbability[] = [];
  const ids: number[] = [];
  let prev = '';
  for (const step of recorder.steps) {
    if (step.id < 0) continue;
    ids.push(step.id);
    const text = tokenizer.decode(ids, { skip_special_tokens: true });
    const piece = text.startsWith(prev) ? text.slice(prev.length) : '';
    prev = text;
    if (piece) out.push({ text: out.length === 0 ? ` ${piece.trimStart()}` : piece, p: step.p });
  }
  return out;
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
    if (tokenizer.timestamp_begin === undefined) {
      // Not Whisper (e.g. Moonshine): no timestamp tokens, and single SentencePiece tokens decode
      // without their word-boundary space, so take each token's text from a cumulative decode.
      const words = groupTokensIntoWords(incrementalTokenTexts(tokenizer, recorder));
      return words.length > 0 ? [words] : [];
    }
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

interface WhisperTokenizerLike {
  timestamp_begin?: number;
  encode: (text: string, opts?: { add_special_tokens?: boolean }) => number[];
  decode: (ids: number[], opts?: { skip_special_tokens?: boolean }) => string;
  convert_tokens_to_ids: (tokens: string[]) => number[];
}

/**
 * Whisper "previous text" prompt used as a vocabulary hint:
 * `<|startofprev|> expected words <|startoftranscript|>`. Whisper then favours those spellings.
 * Returns null when there is no vocabulary or the tokenizer lacks the special tokens.
 * (Transformers.js 4.x does not wire up Whisper `prompt_ids`, but honours `decoder_input_ids`.)
 */
export function buildVocabularyPromptIds(
  pipe: AutomaticSpeechRecognitionPipeline,
  vocabulary: string | undefined
): number[] | null {
  const text = (vocabulary ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  try {
    const tokenizer = pipe.tokenizer as unknown as WhisperTokenizerLike;
    const [prev] = tokenizer.convert_tokens_to_ids(['<|startofprev|>']);
    const sot = (pipe.model as unknown as { config?: { decoder_start_token_id?: number } }).config
      ?.decoder_start_token_id;
    if (typeof prev !== 'number' || typeof sot !== 'number') return null;
    // Whisper allows up to half its 448-token context for the prompt; keep the most recent words
    const words = tokenizer.encode(` ${text}`, { add_special_tokens: false }).slice(-200);
    return [prev, ...words, sot];
  } catch {
    return null;
  }
}

/**
 * Rebuilds Whisper's timestamped chunks from the recorded generated tokens (the prompt is not
 * included, because only generated steps are recorded). Times are relative to the audio slice.
 */
export function chunksFromRecorder(
  pipe: AutomaticSpeechRecognitionPipeline,
  recorder: TokenConfidenceRecorder
): Array<{ timestamp: [number, number | null]; text: string }> {
  const tokenizer = pipe.tokenizer as unknown as WhisperTokenizerLike;
  const timestampBegin = tokenizer.timestamp_begin ?? Number.MAX_SAFE_INTEGER;
  const chunks: Array<{ timestamp: [number, number | null]; text: string }> = [];
  let start: number | null = null;
  let ids: number[] = [];
  const flush = (end: number | null) => {
    const text = ids.length ? tokenizer.decode(ids, { skip_special_tokens: true }) : '';
    if (text.trim()) chunks.push({ timestamp: [start ?? 0, end], text });
    ids = [];
  };
  for (const step of recorder.steps) {
    if (step.id < 0) continue;
    if (step.id >= timestampBegin) {
      const t = Math.round((step.id - timestampBegin) * 0.02 * 100) / 100;
      if (start === null) {
        start = t;
      } else {
        flush(t);
        start = null;
      }
      continue;
    }
    const text = tokenizer.decode([step.id], { skip_special_tokens: true });
    if (text) ids.push(step.id); // skip end-of-text and other special tokens
  }
  if (ids.length) flush(null);
  return chunks;
}

/** Words of one Whisper segment with the segment's time span (seconds within the input). */
export interface TimedWordSegment {
  start: number;
  end: number | null;
  words: WordProbability[];
}

/**
 * Like tokenSegmentsFromRecorder, but keeps each segment's timestamps so words can be located in
 * the audio (used to re-check only the uncertain stretches with a second model).
 */
export function timedWordSegmentsFromRecorder(
  pipe: AutomaticSpeechRecognitionPipeline,
  recorder: TokenConfidenceRecorder
): TimedWordSegment[] {
  try {
    const tokenizer = pipe.tokenizer as unknown as WhisperTokenizerLike;
    const timestampBegin = tokenizer.timestamp_begin ?? Number.MAX_SAFE_INTEGER;
    const out: TimedWordSegment[] = [];
    let start: number | null = null;
    let current: TokenProbability[] = [];
    const flush = (end: number | null) => {
      const words = groupTokensIntoWords(current);
      if (words.length > 0) out.push({ start: start ?? 0, end, words });
      current = [];
    };
    for (const step of recorder.steps) {
      if (step.id < 0) continue;
      if (step.id >= timestampBegin) {
        const t = Math.round((step.id - timestampBegin) * 0.02 * 100) / 100;
        if (start === null) {
          start = t;
        } else {
          flush(t);
          start = null;
        }
        continue;
      }
      const text = tokenizer.decode([step.id], { skip_special_tokens: true });
      if (text) current.push({ text, p: step.p });
    }
    if (current.length) flush(null);
    return out;
  } catch {
    return [];
  }
}
