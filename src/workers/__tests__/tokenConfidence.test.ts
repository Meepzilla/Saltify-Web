import { describe, expect, it } from 'vitest';
import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import {
  buildVocabularyPromptIds,
  chunksFromRecorder,
  TokenConfidenceRecorder,
  tokenSegmentsFromRecorder,
} from '../tokenConfidence';

// Minimal Whisper-like tokenizer: ids 1..N are words, 50257 = <|startoftranscript|>,
// 50360 = <|startofprev|>, 50256 = <|endoftext|>, >= 50363 are timestamps (0.02 s steps).
const VOCAB: Record<number, string> = {
  1: ' The',
  2: ' dog',
  3: ' ran',
  4: '.',
  5: ' He',
  6: ' sat',
  7: ' Maya',
  8: ',',
  9: ' frog',
};
const fakePipe = {
  tokenizer: {
    timestamp_begin: 50363,
    decode: (ids: number[]) => ids.map((i) => VOCAB[i] ?? '').join(''),
    encode: (text: string) =>
      text
        .split(/(?=[ ,])/)
        .map((piece) => Number(Object.keys(VOCAB).find((k) => VOCAB[Number(k)] === piece) ?? 0))
        .filter(Boolean),
    convert_tokens_to_ids: (tokens: string[]) =>
      tokens.map((t) => (t === '<|startofprev|>' ? 50360 : -1)),
  },
  model: { config: { decoder_start_token_id: 50257 } },
} as unknown as AutomaticSpeechRecognitionPipeline;

function recorderWith(ids: number[]): TokenConfidenceRecorder {
  const r = new TokenConfidenceRecorder();
  r.steps = ids.map((id) => ({ id, p: 0.9 }));
  return r;
}

describe('vocabulary prompt and chunk rebuilding', () => {
  it('builds <|startofprev|> words <|startoftranscript|>', () => {
    expect(buildVocabularyPromptIds(fakePipe, ' Maya, frog ')).toEqual([50360, 7, 8, 9, 50257]);
    expect(buildVocabularyPromptIds(fakePipe, '   ')).toBeNull();
    expect(buildVocabularyPromptIds(fakePipe, undefined)).toBeNull();
  });

  it('rebuilds timestamped chunks from generated tokens only', () => {
    // <0.00> The dog ran. <1.50> <1.60> He sat. <2.40> <|endoftext|>
    const rec = recorderWith([50363, 1, 2, 3, 4, 50363 + 75, 50363 + 80, 5, 6, 4, 50363 + 120, 50256]);
    expect(chunksFromRecorder(fakePipe, rec)).toEqual([
      { timestamp: [0, 1.5], text: ' The dog ran.' },
      { timestamp: [1.6, 2.4], text: ' He sat.' },
    ]);
    expect(tokenSegmentsFromRecorder(fakePipe, rec).map((s) => s.map((w) => w.word))).toEqual([
      ['The', 'dog', 'ran.'],
      ['He', 'sat.'],
    ]);
  });

  it('keeps a final chunk that has no closing timestamp', () => {
    const rec = recorderWith([50363 + 10, 5, 6]);
    expect(chunksFromRecorder(fakePipe, rec)).toEqual([{ timestamp: [0.2, null], text: ' He sat' }]);
  });
});
