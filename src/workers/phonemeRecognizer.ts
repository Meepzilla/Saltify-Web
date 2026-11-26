import {
  AutoFeatureExtractor,
  AutoModelForCTC,
  env,
  type ProgressInfo,
  type Tensor,
} from '@huggingface/transformers';
import type { HeardPhone } from '../engine/speechSounds';

/**
 * Phoneme recognizer: wav2vec2 (Meta, lv-60, fine-tuned on CommonVoice to output eSpeak IPA),
 * 4-bit quantized (~230 MB). Chosen after testing on 30 LibriSpeech clips: phoneme error 8.8% clean,
 * 10.3% at 20 dB SNR, 9.2% pitch-shifted "child-like" — clearly better than a smaller HuBERT model
 * (13.7% / 21.7% / 17.8%). It transcribes the sounds produced, not the intended words.
 */
export const PHONEME_MODEL_ID = 'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX';
/** Smaller IPA model (HuBERT base fine-tuned on English IPA, ~90 MB q4); marks word boundaries. */
export const HUBERT_IPA_MODEL_ID = 'onnx-community/hubert-base-english-ipa-ONNX';
const PHONEME_DTYPE = 'q4';
const CACHE_NAME = 'transformers-cache';

interface Recognizer {
  modelId: string;
  extractor: Awaited<ReturnType<typeof AutoFeatureExtractor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>;
  idToToken: string[];
  padId: number;
  wordDelimiterId: number;
}

let cached: Recognizer | null = null;

function modelFileUrl(modelId: string, file: string): string {
  if (env.allowLocalModels && env.localModelPath && !env.allowRemoteModels) {
    return `${env.localModelPath}${modelId}/${file}`;
  }
  const base = env.remoteHost.endsWith('/') ? env.remoteHost : `${env.remoteHost}/`;
  const path = env.remotePathTemplate
    .replaceAll('{model}', modelId)
    .replaceAll('{revision}', 'main');
  return `${base}${path}${file}`;
}

/** vocab.json (the repo has no tokenizer.json), cached alongside the model files for offline use. */
async function loadVocab(modelId: string): Promise<Record<string, number>> {
  const url = modelFileUrl(modelId, 'vocab.json');
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return (await hit.json()) as Record<string, number>;
  } catch {
    cache = null;
  }
  const fetcher = env.fetch ?? fetch;
  const resp = (await fetcher(url)) as Response;
  if (!resp.ok) throw new Error(`Could not download the phoneme vocabulary (${resp.status}) from ${url}`);
  const text = await resp.text();
  if (/^\s*</.test(text)) throw new Error(`The phoneme vocabulary URL returned HTML instead of JSON: ${url}`);
  try {
    await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
  } catch {
    // caching is best-effort
  }
  return JSON.parse(text) as Record<string, number>;
}

export async function loadPhonemeRecognizer(
  onProgress?: (info: ProgressInfo) => void,
  modelId: string = PHONEME_MODEL_ID
): Promise<Recognizer> {
  if (cached?.modelId === modelId) return cached;
  if (cached) await disposePhonemeRecognizer();
  const vocab = await loadVocab(modelId);
  const idToToken: string[] = [];
  for (const [tok, id] of Object.entries(vocab)) idToToken[id] = tok;
  const extractor = await AutoFeatureExtractor.from_pretrained(modelId, {
    progress_callback: onProgress,
  });
  const model = await AutoModelForCTC.from_pretrained(modelId, {
    dtype: PHONEME_DTYPE,
    device: 'wasm',
    session_options: { executionMode: 'sequential' },
    progress_callback: onProgress,
  });
  const config = (model as unknown as { config: { pad_token_id?: number } }).config;
  cached = {
    modelId,
    extractor,
    model,
    idToToken,
    padId: config.pad_token_id ?? vocab['<pad>'] ?? vocab['[PAD]'] ?? 0,
    wordDelimiterId: vocab['|'] ?? -1,
  };
  return cached;
}

export async function disposePhonemeRecognizer(): Promise<void> {
  if (!cached) return;
  try {
    await (cached.model as unknown as { dispose: () => Promise<void> }).dispose();
  } catch {
    // ignore
  }
  cached = null;
}

/** HuBERT IPA writes diphthongs and syllabic r ARPAbet-style; show standard broad IPA. */
const TOKEN_TO_IPA: Record<string, string> = { aj: 'aɪ', aw: 'aʊ', ej: 'eɪ', ow: 'oʊ', oj: 'ɔɪ', 'ɹ̩': 'ɚ' };

/** Tokens that are not sounds: <pad>, [PAD], <s>, [UNK] … */
const SPECIAL_TOKEN = /^(?:<.*>|\[.*\])$/;

export interface IpaResult {
  phones: HeardPhone[];
  /** IPA text, with word breaks estimated from short pauses. */
  text: string;
}

/**
 * Greedy CTC decoding of one audio slice into timed phones. Times are absolute
 * (`offsetSec` + frame time). Confidence is the softmax probability at the emitting frame.
 */
export async function recognizeIpa(recognizer: Recognizer, samples: Float32Array, offsetSec: number): Promise<IpaResult> {
  const inputs = await (recognizer.extractor as unknown as (a: Float32Array) => Promise<Record<string, Tensor>>)(
    samples
  );
  const { logits } = (await (recognizer.model as unknown as (i: Record<string, Tensor>) => Promise<{ logits: Tensor }>)(
    inputs
  )) as { logits: Tensor };
  const [, frames, vocabSize] = logits.dims as number[];
  const data = logits.data as Float32Array;
  const frameSec = samples.length / 16000 / Math.max(1, frames);
  const phones: HeardPhone[] = [];
  const words: string[][] = [[]];
  // Neither model marks words reliably ("|" separates single sounds in HuBERT's training
  // text), so word breaks come from short pauses.
  let prev = -1;
  let lastPhoneFrame = -1;
  for (let t = 0; t < frames; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const row = t * vocabSize;
    for (let v = 0; v < vocabSize; v++) {
      if (data[row + v] > bestVal) {
        bestVal = data[row + v];
        best = v;
      }
    }
    if (best !== prev && best !== recognizer.padId && best !== recognizer.wordDelimiterId) {
      let sum = 0;
      for (let v = 0; v < vocabSize; v++) sum += Math.exp(data[row + v] - bestVal);
      const rawToken = recognizer.idToToken[best];
      const token = rawToken ? TOKEN_TO_IPA[rawToken] ?? rawToken : rawToken;
      if (token && !SPECIAL_TOKEN.test(token)) {
        // A silent stretch of 0.12 s or more starts a new word
        if (lastPhoneFrame >= 0 && (t - lastPhoneFrame) * frameSec >= 0.12) {
          if (words[words.length - 1].length > 0) words.push([]);
        }
        words[words.length - 1].push(token.replace(/\u0361/g, ''));
        lastPhoneFrame = t;
        phones.push([token, Math.round((offsetSec + (t + 0.5) * frameSec) * 1000) / 1000, Math.round((1 / sum) * 100) / 100]);
      }
    }
    prev = best;
  }
  return {
    phones,
    text: words
      .filter((w) => w.length > 0)
      .map((w) => w.join(''))
      .join(' '),
  };
}

/** Timed phones only (speech-sound detection). */
export async function recognizePhones(
  recognizer: Recognizer,
  samples: Float32Array,
  offsetSec: number
): Promise<HeardPhone[]> {
  return (await recognizeIpa(recognizer, samples, offsetSec)).phones;
}
