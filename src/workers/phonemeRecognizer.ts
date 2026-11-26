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
const PHONEME_DTYPE = 'q4';
const CACHE_NAME = 'transformers-cache';

interface Recognizer {
  extractor: Awaited<ReturnType<typeof AutoFeatureExtractor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>;
  idToToken: string[];
  padId: number;
  wordDelimiterId: number;
}

let cached: Recognizer | null = null;

function modelFileUrl(file: string): string {
  if (env.allowLocalModels && env.localModelPath && !env.allowRemoteModels) {
    return `${env.localModelPath}${PHONEME_MODEL_ID}/${file}`;
  }
  const base = env.remoteHost.endsWith('/') ? env.remoteHost : `${env.remoteHost}/`;
  const path = env.remotePathTemplate
    .replaceAll('{model}', PHONEME_MODEL_ID)
    .replaceAll('{revision}', 'main');
  return `${base}${path}${file}`;
}

/** vocab.json (the repo has no tokenizer.json), cached alongside the model files for offline use. */
async function loadVocab(): Promise<Record<string, number>> {
  const url = modelFileUrl('vocab.json');
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
  onProgress?: (info: ProgressInfo) => void
): Promise<Recognizer> {
  if (cached) return cached;
  const vocab = await loadVocab();
  const idToToken: string[] = [];
  for (const [tok, id] of Object.entries(vocab)) idToToken[id] = tok;
  const extractor = await AutoFeatureExtractor.from_pretrained(PHONEME_MODEL_ID, {
    progress_callback: onProgress,
  });
  const model = await AutoModelForCTC.from_pretrained(PHONEME_MODEL_ID, {
    dtype: PHONEME_DTYPE,
    device: 'wasm',
    session_options: { executionMode: 'sequential' },
    progress_callback: onProgress,
  });
  const config = (model as unknown as { config: { pad_token_id?: number } }).config;
  cached = {
    extractor,
    model,
    idToToken,
    padId: config.pad_token_id ?? vocab['<pad>'] ?? 0,
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

/**
 * Greedy CTC decoding of one audio slice into timed phones. Times are absolute
 * (`offsetSec` + frame time). Confidence is the softmax probability at the emitting frame.
 */
export async function recognizePhones(
  recognizer: Recognizer,
  samples: Float32Array,
  offsetSec: number
): Promise<HeardPhone[]> {
  const inputs = await (recognizer.extractor as unknown as (a: Float32Array) => Promise<Record<string, Tensor>>)(
    samples
  );
  const { logits } = (await (recognizer.model as unknown as (i: Record<string, Tensor>) => Promise<{ logits: Tensor }>)(
    inputs
  )) as { logits: Tensor };
  const [, frames, vocabSize] = logits.dims as number[];
  const data = logits.data as Float32Array;
  const frameSec = samples.length / 16000 / Math.max(1, frames);
  const out: HeardPhone[] = [];
  let prev = -1;
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
      const token = recognizer.idToToken[best];
      if (token && !/^<.*>$/.test(token)) {
        out.push([token, Math.round((offsetSec + (t + 0.5) * frameSec) * 1000) / 1000, Math.round((1 / sum) * 100) / 100]);
      }
    }
    prev = best;
  }
  return out;
}
