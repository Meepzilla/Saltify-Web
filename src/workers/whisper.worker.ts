import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { sliceAudioIntoPauseAwareChunks } from '../engine/audioProcessing';
import { autoAssignSpeakersInTranscript } from '../engine/speakerDiarizer';
import { formatWhisperChunks } from '../engine/transcriptFormat';
import type {
  ComputeDevice,
  ModelSource,
  SpeakerAliases,
  WhisperModelId,
} from '../types/saltify';

// Enable local Cache Storage for offline model + WASM reuse
env.useBrowserCache = true;
env.useWasmCache = true;

if (env.backends?.onnx?.wasm) {
  // We are already inside a dedicated Web Worker — never spawn a nested proxy worker.
  env.backends.onnx.wasm.proxy = false;
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
      aliases: SpeakerAliases;
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
      speakerCount: 1 | 2;
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

function isLowMemoryDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIosOrMobile =
    /iPad|iPhone|iPod|Android|Mobile/i.test(ua) ||
    (isSafariBrowser() && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const devMem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return isIosOrMobile || (typeof devMem === 'number' && devMem <= 4);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

let cachedHasLocalAsyncify: { ortBase: string; available: boolean } | null = null;

async function hasSelfHostedAsyncifyWasm(ortBase: string): Promise<boolean> {
  if (cachedHasLocalAsyncify && cachedHasLocalAsyncify.ortBase === ortBase) {
    return cachedHasLocalAsyncify.available;
  }
  try {
    const resp = await fetch(`${ortBase}ort-wasm-simd-threaded.asyncify.wasm`, {
      method: 'HEAD',
      cache: 'no-cache',
    });
    const ct = resp.headers.get('content-type') || '';
    const available = resp.ok && !ct.includes('text/html');
    cachedHasLocalAsyncify = { ortBase, available };
    return available;
  } catch {
    cachedHasLocalAsyncify = { ortBase, available: false };
    return false;
  }
}

/**
 * Configures ONNX Runtime Web WASM paths (preferring self-hosted `/ort/` binaries,
 * with automatic fallback when static hosts like Cloudflare Workers cap assets at 25 MiB)
 * and resolves Whisper model hosting for self-hosted, custom-host, or Hugging Face modes.
 */
async function configureSelfHostedRuntime(
  appBaseUrl: string,
  modelSource: ModelSource,
  customModelBaseUrl: string,
  requestedDevice: ComputeDevice
): Promise<{ manifestBaseUrl: string; useLocalFilesOnly: boolean }> {
  const ortBase = new URL('ort/', appBaseUrl).href;

  if (env.backends?.onnx?.wasm) {
    const wantsAsyncify = !isSafariBrowser();
    const hasLocalAsyncify =
      wantsAsyncify && (await hasSelfHostedAsyncifyWasm(ortBase));

    if (hasLocalAsyncify) {
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
      };
    } else if (
      !wantsAsyncify ||
      modelSource === 'local-only' ||
      requestedDevice === 'wasm'
    ) {
      // Compact 13.6 MiB self-hosted binary (works on Cloudflare Workers & air-gapped servers)
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${ortBase}ort-wasm-simd-threaded.mjs`,
        wasm: `${ortBase}ort-wasm-simd-threaded.wasm`,
      };
    } else {
      // Static hosts with 25 MiB per-file limits (e.g. Cloudflare Workers) cannot host the
      // 25.6 MiB asyncify WASM needed for WebGPU; load it from jsDelivr (cached via useWasmCache)
      // or fall back to the local 13.6 MiB WASM binary if offline.
      const ortVersion =
        (env.backends.onnx as { versions?: { web?: string } }).versions?.web ||
        '1.24.3';
      const cdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${cdnBase}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${cdnBase}ort-wasm-simd-threaded.asyncify.wasm`,
      };
    }
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
  const { manifestBaseUrl, useLocalFilesOnly } = await configureSelfHostedRuntime(
    appBaseUrl,
    modelSource,
    customModelBaseUrl,
    requestedDevice
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

  const lowMemory = isLowMemoryDevice();
  const loadWithBackend = async (backend: 'webgpu' | 'wasm') => {
    const dtype =
      backend === 'webgpu'
        ? ({ encoder_model: 'fp32', decoder_model_merged: 'q4' } as const)
        : ('q8' as const);

    // Memory-saving ONNX Runtime session options prevent Safari Jetsam reloads on iPad/mobile
    const sessionOptions =
      backend === 'wasm' && lowMemory
        ? {
            enableCpuMemArena: false,
            enableMemPattern: false,
            graphOptimizationLevel: 'basic' as const,
            executionMode: 'sequential' as const,
          }
        : {
            executionMode: 'sequential' as const,
          };

    const pipe = await pipeline('automatic-speech-recognition', modelId, {
      device: backend,
      dtype,
      local_files_only: useLocalFilesOnly,
      session_options: sessionOptions,
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

  if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('allocation') ||
    (lower.includes('wasm') && lower.includes('memory')) ||
    lower.includes('rangeerror')
  ) {
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
    lower.includes('load failed') ||
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
      const lowMemory = isLowMemoryDevice();
      const slices = lowMemory
        ? sliceAudioIntoPauseAwareChunks(req.audio, 16000, 18, 12, 24)
        : sliceAudioIntoPauseAwareChunks(req.audio, 16000, 26, 18, 29);
      if (slices.length === 0) {
        post({
          type: 'done',
          jobId: req.jobId,
          transcript: '',
          backendUsed,
          speakerCount: 1,
        });
        return;
      }

      const allChunks: Array<{ timestamp: [number, number | null]; text: string }> = [];

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const baseProgress = 0.25 + (i / slices.length) * 0.68;
        post({
          type: 'progress',
          jobId: req.jobId,
          stage: `Transcribing segment ${i + 1} of ${slices.length}`,
          progress: baseProgress,
          detail: `Running 100% locally (${backendUsed.toUpperCase()})`,
        });

        const segDurationSec = Math.max(0.5, slice.endSec - slice.startSec);
        // Cap generated tokens per segment (~6 tokens/sec max speech rate) to prevent
        // Whisper 448-token hallucination loops on iPad/mobile browsers.
        const maxNewTokens = Math.min(224, Math.max(64, Math.ceil(segDurationSec * 6)));

        const output = await transcriber(slice.samples, {
          return_timestamps: true,
          max_new_tokens: maxNewTokens,
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

        // Yield briefly between segments so Safari GC can reclaim intermediate WASM/JS buffers
        if (i + 1 < slices.length) {
          await yieldToEventLoop();
        }
      }

      post({
        type: 'progress',
        jobId: req.jobId,
        stage: 'Assigning speakers locally',
        progress: 0.96,
      });

      const formatted = formatWhisperChunks(allChunks);
      const diarized = formatted.trim()
        ? autoAssignSpeakersInTranscript(formatted, req.aliases, req.audio, 16000)
        : { transcript: '', speakerCount: 1 as const };

      post({
        type: 'done',
        jobId: req.jobId,
        transcript: diarized.transcript,
        backendUsed,
        speakerCount: diarized.speakerCount,
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
