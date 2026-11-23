import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { WhisperModelId } from '../types/session';

// Always fetch models from Hugging Face Hub on first load and cache locally in Browser Cache API
env.allowLocalModels = false;
env.useBrowserCache = true;

interface TranscribeRequest {
  type: 'transcribe';
  audio: Float32Array;
  modelId: WhisperModelId;
}

type WorkerOutbound =
  | { type: 'progress'; stage: string; progress: number }
  | { type: 'done'; transcript: string }
  | { type: 'error'; message: string };

let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let cachedModelId: WhisperModelId | null = null;

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

function formatSec(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatWhisperChunks(
  text: string,
  chunks?: Array<{ text: string; timestamp: [number, number | null] }>
): string {
  if (!chunks || chunks.length === 0) {
    const cleaned = text.replace(/\.\.\./g, '').replace(/`/g, "'").trim();
    if (!cleaned) return '';
    const sentences = cleaned
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return sentences.map((s) => `[0:00] ${s}`).join('\n');
  }

  const lines: string[] = [];
  for (const chunk of chunks) {
    const startSec = Array.isArray(chunk.timestamp) ? (chunk.timestamp[0] ?? 0) : 0;
    const raw = (chunk.text ?? '').replace(/\.\.\./g, '').replace(/`/g, "'").trim();
    if (!raw) continue;

    // Split multi-sentence chunks into individual SALT utterance lines preserving the chunk timestamp
    const sentences = raw
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const ts = formatSec(startSec);
    for (const sentence of sentences) {
      lines.push(`[${ts}] ${sentence}`);
    }
  }

  return lines.join('\n');
}

async function getTranscriber(modelId: WhisperModelId): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModelId === modelId) {
    return cachedPipeline;
  }

  const fileProgress = new Map<string, number>();

  const onProgress = (info: { status?: string; file?: string; progress?: number }) => {
    if (info.status === 'progress' && info.file && typeof info.progress === 'number') {
      fileProgress.set(info.file, info.progress / 100);
      let sum = 0;
      for (const val of fileProgress.values()) sum += val;
      const avg = fileProgress.size > 0 ? sum / fileProgress.size : 0;
      // Model loading represents 0.05 -> 0.45 of overall progress
      post({
        type: 'progress',
        stage: `Downloading speech model (${Math.round(avg * 100)}%)`,
        progress: 0.05 + avg * 0.4,
      });
    } else if (info.status === 'initiate') {
      post({
        type: 'progress',
        stage: 'Loading speech model...',
        progress: 0.08,
      });
    }
  };

  // Prefer quantized WASM (universal across iPad Safari, Android Chrome, and Windows)
  const asr = (await pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: onProgress,
  })) as unknown as AutomaticSpeechRecognitionPipeline;

  cachedPipeline = asr;
  cachedModelId = modelId;
  return asr;
}

function describeWorkerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lowered = raw.toLowerCase();

  if (lowered.includes('out of memory') || lowered.includes('allocation failed') || lowered.includes('oom')) {
    return 'This device ran out of memory while loading Whisper. Switch to "Whisper Tiny" in Model Settings or try a shorter recording.';
  }
  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network') ||
    lowered.includes('offline')
  ) {
    return 'Could not download the Whisper speech model. Connect to the internet once to cache the model locally for offline use.';
  }
  return `Transcription failed: ${raw || 'Unknown error'}. You can retry or switch to Whisper Tiny.`;
}

self.addEventListener('message', async (event: MessageEvent<TranscribeRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'transcribe') return;

  try {
    post({ type: 'progress', stage: 'Loading speech model...', progress: 0.05 });
    const transcriber = await getTranscriber(msg.modelId);

    const durationSec = msg.audio.length / 16000;
    post({
      type: 'progress',
      stage: `Transcribing (${formatSec(durationSec)} audio)...`,
      progress: 0.5,
    });

    const output = await transcriber(msg.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    const single = Array.isArray(output) ? output[0] : output;
    post({ type: 'progress', stage: 'Formatting timestamps...', progress: 0.94 });

    const transcript = formatWhisperChunks(single?.text ?? '', single?.chunks);
    post({ type: 'done', transcript });
  } catch (err) {
    post({ type: 'error', message: describeWorkerError(err) });
  }
});
