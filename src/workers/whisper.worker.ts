import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { SpeakerAliases, WhisperModelId } from '../types/session';
import {
  splitAudioIntoSegments,
  splitChunkIntoUtterances,
  WHISPER_SAMPLE_RATE,
  type TimedUtterance,
} from '../lib/audio/audioChunker';
import {
  diarizeSpeakerSegments,
  formatDiarizedTranscript,
} from '../lib/audio/speakerDiarizer';

// Always fetch models from Hugging Face Hub on first load and cache locally in Browser Cache API
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

interface TranscribeRequest {
  type: 'transcribe';
  audio: Float32Array;
  modelId: WhisperModelId;
  aliases: SpeakerAliases;
  lowMemory: boolean;
}

type WorkerOutbound =
  | { type: 'progress'; stage: string; progress: number }
  | {
      type: 'done';
      transcript: string;
      speakerCount: 1 | 2;
      effectiveModelId: WhisperModelId;
    }
  | { type: 'error'; message: string };

interface WhisperChunkOutput {
  text?: string;
  timestamp?: [number | null, number | null];
}

interface WhisperResultOutput {
  text?: string;
  chunks?: WhisperChunkOutput[];
}

interface TransformersProgressInfo {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let cachedModelId: WhisperModelId | null = null;
let cachedLowMemory: boolean | null = null;

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

function formatSec(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function configureOnnxRuntime(lowMemory: boolean): void {
  const backends = env.backends as {
    onnx?: { wasm?: { numThreads?: number; proxy?: boolean } };
  };
  const wasm = backends?.onnx?.wasm;
  if (!wasm) return;

  // We are already inside a dedicated Web Worker — never spawn a nested proxy worker.
  wasm.proxy = false;
  if (lowMemory) {
    // Keep WASM single-threaded on iPad/iOS/mobile to avoid Safari memory & worker overhead.
    wasm.numThreads = 1;
  }
}

async function getTranscriber(
  modelId: WhisperModelId,
  lowMemory: boolean
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModelId === modelId && cachedLowMemory === lowMemory) {
    return cachedPipeline;
  }

  if (cachedPipeline) {
    try {
      await cachedPipeline.dispose();
    } catch {
      // Ignore disposal errors
    }
    cachedPipeline = null;
    cachedModelId = null;
  }

  configureOnnxRuntime(lowMemory);

  const fileLoaded = new Map<string, number>();
  const fileTotal = new Map<string, number>();
  const filePercent = new Map<string, number>();
  let lastPostAt = 0;

  const onProgress = (info: TransformersProgressInfo) => {
    const now = Date.now();
    if (info.status === 'progress' && info.file) {
      if (typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0) {
        fileLoaded.set(info.file, info.loaded);
        fileTotal.set(info.file, info.total);
      }
      if (typeof info.progress === 'number') {
        filePercent.set(info.file, Math.max(0, Math.min(1, info.progress / 100)));
      }

      if (now - lastPostAt < 140) return;
      lastPostAt = now;

      let ratio = 0;
      let totalBytes = 0;
      let loadedBytes = 0;
      for (const [f, tot] of fileTotal.entries()) {
        totalBytes += tot;
        loadedBytes += fileLoaded.get(f) ?? 0;
      }

      if (totalBytes > 0) {
        ratio = Math.min(1, loadedBytes / totalBytes);
      } else if (filePercent.size > 0) {
        let sum = 0;
        for (const val of filePercent.values()) sum += val;
        ratio = sum / filePercent.size;
      }

      const mbInfo =
        totalBytes > 1024 * 1024
          ? ` (${Math.round(loadedBytes / 1048576)}/${Math.round(totalBytes / 1048576)} MB)`
          : ` (${Math.round(ratio * 100)}%)`;

      post({
        type: 'progress',
        stage: `Downloading speech model${mbInfo}...`,
        progress: 0.05 + ratio * 0.37,
      });
    } else if (info.status === 'initiate') {
      if (now - lastPostAt >= 200) {
        lastPostAt = now;
        post({
          type: 'progress',
          stage: 'Preparing speech model...',
          progress: 0.06,
        });
      }
    } else if (info.status === 'done' && info.file?.endsWith('.onnx')) {
      post({
        type: 'progress',
        stage: 'Initializing on-device speech engine...',
        progress: 0.43,
      });
    }
  };

  // Memory-saving ONNX Runtime session options for iPad/iOS/mobile prevent Safari Jetsam reloads
  const sessionOptions = lowMemory
    ? {
        enableCpuMemArena: false,
        enableMemPattern: false,
        graphOptimizationLevel: 'basic' as const,
        executionMode: 'sequential' as const,
      }
    : {
        executionMode: 'sequential' as const,
      };

  const asr = (await pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    device: 'wasm',
    session_options: sessionOptions,
    progress_callback: onProgress,
  })) as unknown as AutomaticSpeechRecognitionPipeline;

  cachedPipeline = asr;
  cachedModelId = modelId;
  cachedLowMemory = lowMemory;
  return asr;
}

function describeWorkerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lowered = raw.toLowerCase();

  if (
    lowered.includes('out of memory') ||
    lowered.includes('allocation failed') ||
    lowered.includes('oom') ||
    lowered.includes('wasm') && lowered.includes('memory') ||
    lowered.includes('rangeerror')
  ) {
    return 'This device ran out of memory while running Whisper. Switch to "Whisper Base" or "Whisper Tiny" in the model menu, or try a shorter recording.';
  }
  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network') ||
    lowered.includes('offline') ||
    lowered.includes('load failed')
  ) {
    return 'Could not download the Whisper speech model. Connect to the internet once to cache the model locally for offline use.';
  }
  return `Transcription failed: ${raw || 'Unknown error'}. You can retry or switch to Whisper Base / Tiny.`;
}

function getChunkTimingProfile(modelId: WhisperModelId, lowMemory: boolean) {
  if (modelId === 'onnx-community/distil-small.en') {
    // Distil-Whisper performs best and uses minimal KV-cache RAM on ~15-20s windows
    return { targetSegmentSec: 16, minSegmentSec: 10, maxSegmentSec: 20 };
  }
  if (lowMemory) {
    return { targetSegmentSec: 18, minSegmentSec: 12, maxSegmentSec: 24 };
  }
  return { targetSegmentSec: 24, minSegmentSec: 15, maxSegmentSec: 28 };
}

self.addEventListener('message', async (event: MessageEvent<TranscribeRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'transcribe') return;

  try {
    // Defense-in-depth: never let the 240 MB 12-layer decoder OOM a memory-constrained iPad
    const effectiveModelId: WhisperModelId =
      msg.lowMemory && msg.modelId === 'Xenova/whisper-small.en'
        ? 'onnx-community/distil-small.en'
        : msg.modelId;

    post({ type: 'progress', stage: 'Loading speech model...', progress: 0.05 });
    const transcriber = await getTranscriber(effectiveModelId, msg.lowMemory);

    const totalDurationSec = msg.audio.length / WHISPER_SAMPLE_RATE;
    const timingProfile = getChunkTimingProfile(effectiveModelId, msg.lowMemory);
    const allSegments = splitAudioIntoSegments(msg.audio, timingProfile);
    const speechSegments = allSegments.filter((seg) => !seg.isSilent);
    const activeSegments = speechSegments.length > 0 ? speechSegments : allSegments;

    const utterances: TimedUtterance[] = [];

    for (let idx = 0; idx < activeSegments.length; idx++) {
      const seg = activeSegments[idx];
      const baseProgress = 0.45 + (idx / Math.max(1, activeSegments.length)) * 0.46;
      const rangeLabel = `${formatSec(seg.startSec)}–${formatSec(seg.endSec)}`;
      const stageLabel =
        activeSegments.length > 1
          ? `Transcribing part ${idx + 1} of ${activeSegments.length} (${rangeLabel} / ${formatSec(totalDurationSec)})...`
          : `Transcribing (${formatSec(totalDurationSec)} audio)...`;

      post({
        type: 'progress',
        stage: stageLabel,
        progress: baseProgress,
      });

      const segDurationSec = Math.max(0.5, seg.endSec - seg.startSec);
      // Cap generated tokens per segment (~6 tokens/sec max speech rate) to prevent
      // Whisper 448-token hallucination loops that freeze or time out mobile browsers.
      const maxNewTokens = Math.min(224, Math.max(64, Math.ceil(segDurationSec * 6)));
      const slice = msg.audio.subarray(seg.startSample, seg.endSample);

      const output = (await transcriber(slice, {
        return_timestamps: true,
        max_new_tokens: maxNewTokens,
      })) as WhisperResultOutput | WhisperResultOutput[];

      const single = Array.isArray(output) ? output[0] : output;
      const chunks = single?.chunks;

      if (chunks && chunks.length > 0) {
        for (const chunk of chunks) {
          const text = chunk.text ?? '';
          if (!text.trim()) continue;
          const localStart =
            Array.isArray(chunk.timestamp) && typeof chunk.timestamp[0] === 'number'
              ? Math.max(0, chunk.timestamp[0])
              : 0;
          const localEnd =
            Array.isArray(chunk.timestamp) && typeof chunk.timestamp[1] === 'number'
              ? Math.max(localStart + 0.35, Math.min(segDurationSec, chunk.timestamp[1]))
              : segDurationSec;

          const absStart = seg.startSec + localStart;
          const absEnd = Math.min(seg.endSec, seg.startSec + localEnd);
          utterances.push(...splitChunkIntoUtterances(text, absStart, absEnd));
        }
      } else if (single?.text?.trim()) {
        utterances.push(...splitChunkIntoUtterances(single.text, seg.startSec, seg.endSec));
      }

      // Yield briefly between segments so Safari GC can reclaim intermediate WASM/JS buffers
      if (idx + 1 < activeSegments.length) {
        await yieldToEventLoop();
      }
    }

    if (utterances.length === 0) {
      post({
        type: 'done',
        transcript: '',
        speakerCount: 1,
        effectiveModelId,
      });
      return;
    }

    post({ type: 'progress', stage: 'Auto-assigning speakers...', progress: 0.94 });
    const diarization = diarizeSpeakerSegments(msg.audio, utterances, WHISPER_SAMPLE_RATE);
    const transcript = formatDiarizedTranscript(utterances, diarization.roles, msg.aliases);

    post({
      type: 'done',
      transcript,
      speakerCount: diarization.speakerCount,
      effectiveModelId,
    });
  } catch (err) {
    post({ type: 'error', message: describeWorkerError(err) });
  }
});
