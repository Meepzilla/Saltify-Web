import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { sliceAudioIntoPauseAwareChunks } from '../engine/audioProcessing';
import { formatWhisperChunks } from '../engine/transcriptFormat';
import type { ComputeDevice, ModelSource, WhisperModelId } from '../types/saltify';

// Enable local Cache Storage for offline model + WASM reuse
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
      modelSource: ModelSource;
      customModelBaseUrl: string;
      appBaseUrl: string;
    }
  | {
      type: 'transcribe';
      jobId: string;
      modelId: WhisperModelId;
      device: ComputeDevice;
      modelSource: ModelSource;
      customModelBaseUrl: string;
      appBaseUrl: string;
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

interface SelfHostedManifestEntry {
  id: string;
  wasmQ8: boolean;
  webgpu: boolean;
}

let activePipeline: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey: string | null = null;
let loadedBackend: 'webgpu' | 'wasm' | null = null;

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
}

async function canUseWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (isSafariBrowser()) return false;

  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Configures ONNX Runtime Web to load its WASM + JS factory from THIS server's
 * `/ort/` directory (zero jsDelivr CDN requests) and configures Whisper model
 * resolution for self-hosted, air-gapped, custom-host, or Hugging Face modes.
 */
function configureSelfHostedRuntime(
  appBaseUrl: string,
  modelSource: ModelSource,
  customModelBaseUrl: string
): { manifestBaseUrl: string; useLocalFilesOnly: boolean } {
  const ortBase = new URL('ort/', appBaseUrl).href;
  const suffix = isSafariBrowser() ? '' : '.asyncify';

  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${ortBase}ort-wasm-simd-threaded${suffix}.mjs`,
      wasm: `${ortBase}ort-wasm-simd-threaded${suffix}.wasm`,
    };
  }

  const trimmedCustom = customModelBaseUrl.trim();
  const isCustomExternalUrl = /^https?:\/\//i.test(trimmedCustom);

  if (isCustomExternalUrl && modelSource !== 'huggingface') {
    // External self-hosted model server (e.g. Cloudflare R2, clinic NAS, or CDN)
    const customBase = ensureTrailingSlash(trimmedCustom);
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.remoteHost = customBase;
    env.remotePathTemplate = '{model}/';
    return { manifestBaseUrl: customBase, useLocalFilesOnly: false };
  }

  // Restore standard Hugging Face remote defaults
  env.remoteHost = 'https://huggingface.co/';
  env.remotePathTemplate = '{model}/resolve/{revision}/';

  // IMPORTANT: Transformers.js v4's _get_file_metadata requires env.localModelPath
  // to be an origin-relative path (not starting with http:// or https://).
  const relativeModelPath = trimmedCustom
    ? ensureTrailingSlash(trimmedCustom.startsWith('/') ? trimmedCustom : `/${trimmedCustom}`)
    : ensureTrailingSlash(new URL('models/', appBaseUrl).pathname);

  env.localModelPath = relativeModelPath;

  if (modelSource === 'local-only') {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
  } else if (modelSource === 'huggingface') {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  } else {
    // 'auto': check self-hosted `/models/` first, fall back to Hugging Face if missing
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
  }

  const manifestBaseUrl = new URL(relativeModelPath, appBaseUrl).href;
  return {
    manifestBaseUrl,
    useLocalFilesOnly: modelSource === 'local-only',
  };
}

async function fetchSelfHostedEntry(
  manifestBaseUrl: string,
  modelId: WhisperModelId
): Promise<SelfHostedManifestEntry | null> {
  try {
    const resp = await fetch(`${manifestBaseUrl}manifest.json`, { cache: 'no-cache' });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) return null;
    const data = (await resp.json()) as { models?: SelfHostedManifestEntry[] };
    return data.models?.find((m) => m.id === modelId) ?? null;
  } catch {
    return null;
  }
}

async function ensurePipeline(
  jobId: string,
  modelId: WhisperModelId,
  requestedDevice: ComputeDevice,
  modelSource: ModelSource,
  customModelBaseUrl: string,
  appBaseUrl: string
): Promise<{
  transcriber: AutomaticSpeechRecognitionPipeline;
  backendUsed: 'webgpu' | 'wasm';
}> {
  const { manifestBaseUrl, useLocalFilesOnly } = configureSelfHostedRuntime(
    appBaseUrl,
    modelSource,
    customModelBaseUrl
  );

  // If self-hosted server has q8 WASM weights (without larger WebGPU fp32/q4 weights),
  // prefer WASM directly to avoid unnecessary fallback fetches.
  const localEntry =
    modelSource !== 'huggingface'
      ? await fetchSelfHostedEntry(manifestBaseUrl, modelId)
      : null;

  const webGpuSupported =
    requestedDevice === 'webgpu' ||
    (requestedDevice === 'auto' && (await canUseWebGpu()));

  const preferWebGpu =
    webGpuSupported &&
    !(localEntry && localEntry.wasmQ8 && !localEntry.webgpu && requestedDevice === 'auto');

  const targetBackend: 'webgpu' | 'wasm' = preferWebGpu ? 'webgpu' : 'wasm';
  const cacheSignature = `${modelId}|${targetBackend}|${modelSource}|${manifestBaseUrl}`;

  if (activePipeline && loadedKey === cacheSignature && loadedBackend) {
    return { transcriber: activePipeline, backendUsed: loadedBackend };
  }

  // Dispose any previously loaded model to free RAM on iPad/Android
  if (activePipeline) {
    try {
      await activePipeline.dispose();
    } catch {
      // ignore disposal errors
    }
    activePipeline = null;
    loadedKey = null;
    loadedBackend = null;
  }

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  const sourceLabel =
    modelSource === 'local-only' || localEntry
      ? 'from your self-hosted server'
      : 'and caching locally for offline use';

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
      const frac =
        totalSum > 0 ? Math.min(loadedSum / totalSum, 1) : (info.progress ?? 0) / 100;
      const mbLoaded = (loadedSum / (1024 * 1024)).toFixed(1);
      const mbTotal = totalSum > 0 ? ` / ${(totalSum / (1024 * 1024)).toFixed(1)} MB` : '';
      post({
        type: 'progress',
        jobId,
        stage: 'Loading Whisper model',
        progress: Math.max(0.02, frac * 0.25),
        detail: `${mbLoaded} MB${mbTotal} (${sourceLabel})`,
      });
    } else if (info.status === 'initiate') {
      post({
        type: 'progress',
        jobId,
        stage: 'Loading Whisper model',
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
      local_files_only: useLocalFilesOnly,
      progress_callback: onModelProgress,
    });
    return pipe;
  };

  let backendUsed: 'webgpu' | 'wasm' = targetBackend;
  try {
    activePipeline = await loadWithBackend(targetBackend);
  } catch (err) {
    if (targetBackend === 'webgpu') {
      post({
        type: 'progress',
        jobId,
        stage: 'Switching to WASM engine',
        progress: 0.08,
        detail: 'Falling back to universal on-device WASM.',
      });
      backendUsed = 'wasm';
      activePipeline = await loadWithBackend('wasm');
    } else {
      throw err;
    }
  }

  loadedKey = cacheSignature;
  loadedBackend = backendUsed;
  return { transcriber: activePipeline, backendUsed };
}

function describeWorkerError(
  error: unknown,
  modelId: WhisperModelId,
  modelSource: ModelSource
): { message: string; details: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error ? error.stack || raw : raw;
  const lower = raw.toLowerCase();

  if (lower.includes('out of memory') || lower.includes('oom') || lower.includes('allocation')) {
    return {
      message:
        'This device ran out of browser memory while transcribing. Switch to "Whisper Tiny (.en)" in AI Models or try a shorter clip.',
      details,
    };
  }
  if (
    modelSource === 'local-only' &&
    (lower.includes('not found locally') ||
      lower.includes('local_files_only') ||
      lower.includes('404'))
  ) {
    const shortKey = modelId.includes('tiny')
      ? 'tiny'
      : modelId.includes('base')
      ? 'base'
      : 'small';
    return {
      message: `Model "${modelId}" was not found on your self-hosted server. Run "npm run models:download -- --models=${shortKey}" on your host (or switch Model Hosting to Auto).`,
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
        'The Whisper speech model has not been cached yet and could not be downloaded. Connect to your server or Wi-Fi once to cache it for offline use.',
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
      const { backendUsed } = await ensurePipeline(
        req.jobId,
        req.modelId,
        req.device,
        req.modelSource,
        req.customModelBaseUrl,
        req.appBaseUrl
      );
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
        req.device,
        req.modelSource,
        req.customModelBaseUrl,
        req.appBaseUrl
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
    const { message, details } = describeWorkerError(err, req.modelId, req.modelSource);
    post({
      type: 'error',
      jobId: req.jobId,
      message,
      details,
    });
  }
};
