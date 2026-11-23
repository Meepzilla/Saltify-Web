import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { sliceAudioIntoPauseAwareChunks } from '../engine/audioProcessing';
import { formatWhisperChunks } from '../engine/transcriptFormat';
import type { ComputeDevice, WhisperModelId } from '../types/saltify';

// Configure Transformers.js for 100% client-side cached execution across Android, Windows & iPad
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

if (env.backends?.onnx?.wasm) {
  // Single-threaded WASM avoids SharedArrayBuffer / COOP-COEP requirements on static hosts & iPadOS
  env.backends.onnx.wasm.numThreads =
    typeof self !== 'undefined' && self.crossOriginIsolated
      ? Math.min(navigator.hardwareConcurrency || 4, 4)
      : 1;
}

export type WorkerRequest =
  | {
      type: 'preload';
      jobId: string;
      modelId: WhisperModelId;
      device: ComputeDevice;
    }
  | {
      type: 'transcribe';
      jobId: string;
      modelId: WhisperModelId;
      device: ComputeDevice;
      audio: Float32Array;
    };

export type WorkerResponse =
  | {
      type: 'progress';
      jobId: string;
      stage: string;
      progress: number;
      detail?: string;
    }
  | {
      type: 'partial';
      jobId: string;
      partialTranscript: string;
    }
  | {
      type: 'ready';
      jobId: string;
      modelId: WhisperModelId;
      backendUsed: 'webgpu' | 'wasm';
    }
  | {
      type: 'done';
      jobId: string;
      transcript: string;
      backendUsed: 'webgpu' | 'wasm';
    }
  | {
      type: 'error';
      jobId: string;
      message: string;
      details?: string;
    };

let activePipeline: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModelId: WhisperModelId | null = null;
let loadedBackend: 'webgpu' | 'wasm' | null = null;

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

async function canUseWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  // Prefer universal WASM on older iOS/iPadOS Safari builds where WebGPU memory is tightly capped
  const ua = navigator.userAgent || '';
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
  if (isSafari) return false;

  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function ensurePipeline(
  jobId: string,
  modelId: WhisperModelId,
  requestedDevice: ComputeDevice
): Promise<{
  transcriber: AutomaticSpeechRecognitionPipeline;
  backendUsed: 'webgpu' | 'wasm';
}> {
  const preferWebGpu =
    requestedDevice === 'webgpu' ||
    (requestedDevice === 'auto' && (await canUseWebGpu()));

  const targetBackend: 'webgpu' | 'wasm' = preferWebGpu ? 'webgpu' : 'wasm';

  if (
    activePipeline &&
    loadedModelId === modelId &&
    loadedBackend === targetBackend
  ) {
    return { transcriber: activePipeline, backendUsed: targetBackend };
  }

  // Dispose any previously loaded model to free RAM on iPad/Android
  if (activePipeline) {
    try {
      await activePipeline.dispose();
    } catch {
      // ignore disposal errors
    }
    activePipeline = null;
    loadedModelId = null;
    loadedBackend = null;
  }

  const fileProgress = new Map<string, { loaded: number; total: number }>();

  const onModelProgress = (info: ProgressInfo) => {
    if (info.status === 'progress' && info.file) {
      fileProgress.set(info.file, {
        loaded: info.loaded ?? 0,
        total: info.total ?? 0,
      });
      let loadedSum = 0;
      let totalSum = 0;
      for (const entry of fileProgress.values()) {
        loadedSum += entry.loaded;
        totalSum += entry.total;
      }
      const frac = totalSum > 0 ? Math.min(loadedSum / totalSum, 1) : (info.progress ?? 0) / 100;
      const mbLoaded = (loadedSum / (1024 * 1024)).toFixed(1);
      const mbTotal = totalSum > 0 ? ` / ${(totalSum / (1024 * 1024)).toFixed(1)} MB` : '';
      post({
        type: 'progress',
        jobId,
        stage: 'Downloading on-device Whisper model',
        progress: Math.max(0.02, frac * 0.25),
        detail: `${mbLoaded} MB${mbTotal} (cached locally for offline use)`,
      });
    } else if (info.status === 'initiate') {
      post({
        type: 'progress',
        jobId,
        stage: 'Loading on-device Whisper model',
        progress: 0.04,
        detail: info.file ? `Preparing ${info.file}` : undefined,
      });
    }
  };

  const loadWithBackend = async (backend: 'webgpu' | 'wasm') => {
    const dtype =
      backend === 'webgpu'
        ? ({ encoder_model: 'fp32', decoder_model_merged: 'q4' } as const)
        : ('q8' as const);

    const pipe = await pipeline('automatic-speech-recognition', modelId, {
      device: backend,
      dtype,
      progress_callback: onModelProgress,
    });
    return pipe;
  };

  let backendUsed: 'webgpu' | 'wasm' = targetBackend;
  try {
    activePipeline = await loadWithBackend(targetBackend);
  } catch (err) {
    if (targetBackend === 'webgpu') {
      // Automatic fallback to universal WASM if WebGPU fails on a GPU/driver/mobile browser
      post({
        type: 'progress',
        jobId,
        stage: 'Switching to WASM engine',
        progress: 0.08,
        detail: 'WebGPU unavailable; falling back to universal on-device WASM.',
      });
      backendUsed = 'wasm';
      activePipeline = await loadWithBackend('wasm');
    } else {
      throw err;
    }
  }

  loadedModelId = modelId;
  loadedBackend = backendUsed;
  return { transcriber: activePipeline, backendUsed };
}

function describeWorkerError(error: unknown): { message: string; details: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error ? error.stack || raw : raw;
  const lower = raw.toLowerCase();

  if (lower.includes('out of memory') || lower.includes('oom') || lower.includes('allocation')) {
    return {
      message:
        'This device ran out of browser memory while transcribing. Switch to "Whisper Tiny (.en)" in Model Settings or try a shorter clip.',
      details,
    };
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('offline') ||
    lower.includes('err_internet')
  ) {
    return {
      message:
        'The Whisper speech model has not been cached yet and could not be downloaded. Connect to the internet once to download it for offline use.',
      details,
    };
  }
  return {
    message: `On-device transcription failed: ${raw}`,
    details,
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'preload') {
      const { backendUsed } = await ensurePipeline(req.jobId, req.modelId, req.device);
      post({
        type: 'progress',
        jobId: req.jobId,
        stage: 'Model ready for offline use',
        progress: 1,
      });
      post({
        type: 'ready',
        jobId: req.jobId,
        modelId: req.modelId,
        backendUsed,
      });
      return;
    }

    if (req.type === 'transcribe') {
      post({
        type: 'progress',
        jobId: req.jobId,
        stage: 'Loading Whisper model',
        progress: 0.05,
      });

      const { transcriber, backendUsed } = await ensurePipeline(
        req.jobId,
        req.modelId,
        req.device
      );

      // Pause-aware low-RAM chunking keeps iPadOS Safari & Android memory bounded
      const slices = sliceAudioIntoPauseAwareChunks(req.audio, 16000, 26, 18, 29);
      if (slices.length === 0) {
        post({
          type: 'done',
          jobId: req.jobId,
          transcript: '',
          backendUsed,
        });
        return;
      }

      const allChunks: Array<{ timestamp: [number, number | null]; text: string }> = [];

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const baseProgress = 0.25 + (i / slices.length) * 0.7;
        post({
          type: 'progress',
          jobId: req.jobId,
          stage: `Transcribing segment ${i + 1} of ${slices.length}`,
          progress: baseProgress,
          detail: `Running 100% locally (${backendUsed.toUpperCase()})`,
        });

        const output = await transcriber(slice.samples, {
          return_timestamps: true,
        });

        const singleOutput = Array.isArray(output) ? output[0] : output;
        if (singleOutput?.chunks && singleOutput.chunks.length > 0) {
          for (const ch of singleOutput.chunks) {
            const relStart = ch.timestamp?.[0] ?? 0;
            const relEnd = ch.timestamp?.[1] ?? null;
            allChunks.push({
              timestamp: [
                slice.startSec + relStart,
                relEnd !== null ? slice.startSec + relEnd : null,
              ],
              text: ch.text,
            });
          }
        } else if (singleOutput?.text?.trim()) {
          allChunks.push({
            timestamp: [slice.startSec, slice.endSec],
            text: singleOutput.text,
          });
        }

        // Stream incremental transcript so clinician sees immediate progress
        post({
          type: 'partial',
          jobId: req.jobId,
          partialTranscript: formatWhisperChunks(allChunks),
        });
      }

      post({
        type: 'progress',
        jobId: req.jobId,
        stage: 'Formatting transcript',
        progress: 0.97,
      });

      const finalTranscript = formatWhisperChunks(allChunks);

      post({
        type: 'done',
        jobId: req.jobId,
        transcript: finalTranscript,
        backendUsed,
      });
    }
  } catch (err) {
    const { message, details } = describeWorkerError(err);
    post({
      type: 'error',
      jobId: req.jobId,
      message,
      details,
    });
  }
};
