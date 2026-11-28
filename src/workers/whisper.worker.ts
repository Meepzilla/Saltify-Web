import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { buildSpeechSlices, packSpeechWindows, sparseChunks, uncoveredPieces } from '../engine/speechChunking';
import { collapseRepetitions, dropSilentChunks, looksLikeRepetitionLoop } from '../engine/hallucinationGuard';
import { purgeHtmlModelCacheEntries } from '../engine/modelCache';
import {
  extractWhisperUtterances,
  formatWhisperChunks,
  type FormattedWhisperUtterance,
} from '../engine/transcriptFormat';
import { annotateDisagreements } from '../engine/modelFusion';
import {
  buildWordConfidenceMap,
  STORE_CONFIDENCE_BELOW,
  type WordConfidenceMap,
  type WordProbability,
} from '../engine/wordConfidence';
import {
  buildVocabularyPromptIds,
  chunksFromRecorder,
  RecorderLastProcessorList,
  TokenConfidenceRecorder,
  timedWordSegmentsFromRecorder,
  tokenSegmentsFromRecorder,
} from './tokenConfidence';
import { isMoonshineModel, type ComputeDevice, type ModelSource, type WhisperModelId } from '../types/saltify';


// IMPORTANT: do not import speakerDiarizer / childGrammarEngine (or anything that pulls in
// wink-pos-tagger / wink-lexicon) into this worker. Those multi-MB CommonJS data modules overflow
// Safari's small Web Worker stack on load ("RangeError: Maximum call stack size exceeded").
// Speaker assignment runs on the main thread in whisperClient.ts instead.

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
      /** Optional second model to compare against (flags words where the two disagree). */
      compareModelId?: WhisperModelId;
      /** Expected words (names, story vocabulary) given to Whisper as a prompt hint. */
      vocabulary?: string;
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
      utterances?: FormattedWhisperUtterance[];
      /** Uncertain words per line (Whisper token probability below threshold). */
      wordConfidence?: WordConfidenceMap;
      /** The second-opinion model that was compared, when it ran successfully. */
      secondOpinionModelId?: WhisperModelId;
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
let activeJobId: string | null = null;

/** Diagnostics: what the worker was doing when something failed. */
const diag: {
  stage: string;
  file?: string;
  lastUrl?: string;
  backend?: 'webgpu' | 'wasm';
  webgpuError?: string;
} = { stage: 'starting worker' };

function setStage(stage: string): void {
  diag.stage = stage;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// Wrap fetch so network failures say WHICH URL failed (browsers only say "Failed to fetch"/"Load failed")
// and omit Referer headers, since Hugging Face's CloudFront returns HTTP 404 (without CORS headers)
// when requests include a `*.workers.dev` Referer.
const originalFetch = env.fetch ?? fetch.bind(self);
env.fetch = async (input: string | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.href;
  diag.lastUrl = url;
  try {
    return await originalFetch(input, {
      ...init,
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    const wrapped = new Error(`${errorText(err)} — while fetching ${url}`);
    wrapped.name = 'DownloadError';
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
};
let loadedKey: string | null = null;
let loadedBackend: 'webgpu' | 'wasm' | null = null;

/** Recognized words of one Whisper segment, with the segment's span in recording seconds. */
interface WordRecord {
  start: number;
  end: number;
  words: WordProbability[];
}

/**
 * Longest stretch of packed speech per Whisper window (seconds). Whisper pads every window to
 * 30 s, so shorter windows save no memory; 28 s tested best on 10–13 minute two-speaker samples.
 */
const SPEECH_WINDOW_SEC = 28;

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

/** Phones/tablets (Android, iPhone, iPad). Mobile WebGPU drivers are unreliable for Whisper. */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod|Android|Mobile/i.test(ua) ||
    (isSafariBrowser() && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Set once WebGPU has failed in this worker (at load or mid-inference). From then on the
 * worker uses WASM, even if WebGPU was requested, so transcription keeps working.
 */
let webGpuFailed = false;

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

async function probeLocalModelConfig(
  manifestBaseUrl: string,
  modelId: WhisperModelId
): Promise<boolean> {
  try {
    const resp = await fetch(`${manifestBaseUrl}${modelId}/config.json`, {
      method: 'HEAD',
      cache: 'no-cache',
    });
    const ct = resp.headers.get('content-type') || '';
    return resp.ok && ct.includes('json');
  } catch {
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
  targetBackend: 'webgpu' | 'wasm',
  hasLocalModel: boolean
): Promise<{ useLocalFilesOnly: boolean }> {
  const ortBase = new URL('ort/', appBaseUrl).href;

  if (env.backends?.onnx?.wasm) {
    const wantsAsyncify = targetBackend === 'webgpu' && !isSafariBrowser();
    const hasLocalAsyncify =
      wantsAsyncify && (await hasSelfHostedAsyncifyWasm(ortBase));

    if (hasLocalAsyncify) {
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
      };
    } else if (!wantsAsyncify || modelSource === 'local-only') {
      // Compact 13.6 MiB self-hosted binary (works on Cloudflare Workers & air-gapped servers)
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${ortBase}ort-wasm-simd-threaded.mjs`,
        wasm: `${ortBase}ort-wasm-simd-threaded.wasm`,
      };
    } else {
      // Static hosts with 25 MiB per-file limits (e.g. Cloudflare Workers) cannot host the
      // 25.6 MiB asyncify WASM needed for WebGPU; load it from jsDelivr (cached via useWasmCache).
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
    return { useLocalFilesOnly: false };
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
    // 'auto': only enable local /models/ fetch if this origin actually serves JSON model files.
    // On SPA hosts like Cloudflare Workers, missing /models/* paths return HTTP 200 index.html,
    // which otherwise breaks Transformers.js with `Unexpected token '<'`.
    env.allowLocalModels = hasLocalModel;
    env.allowRemoteModels = true;
  }

  return {
    useLocalFilesOnly: modelSource === 'local-only',
  };
}

function resolveManifestBaseUrl(appBaseUrl: string, customModelBaseUrl: string): string {
  const trimmedCustom = customModelBaseUrl.trim();
  if (/^https?:\/\//i.test(trimmedCustom)) {
    return ensureTrailingSlash(trimmedCustom);
  }
  const relativeModelPath = trimmedCustom
    ? ensureTrailingSlash(trimmedCustom.startsWith('/') ? trimmedCustom : `/${trimmedCustom}`)
    : ensureTrailingSlash(new URL('models/', appBaseUrl).pathname);
  return new URL(relativeModelPath, appBaseUrl).href;
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
  appBaseUrl: string,
  /** Where model-loading progress maps onto the job's 0–1 progress bar. */
  progressRange: [number, number] = [0, 0.25],
  stageLabel = 'Loading Whisper model'
): Promise<{
  transcriber: AutomaticSpeechRecognitionPipeline;
  backendUsed: 'webgpu' | 'wasm';
}> {
  diag.file = undefined;
  diag.webgpuError = undefined;
  setStage('checking for self-hosted models');
  const manifestBaseUrl = resolveManifestBaseUrl(appBaseUrl, customModelBaseUrl);

  // If self-hosted server has q8 WASM weights (without larger WebGPU fp32/q4 weights),
  // prefer WASM directly to avoid unnecessary fallback fetches.
  const localEntry =
    modelSource !== 'huggingface'
      ? await fetchSelfHostedEntry(manifestBaseUrl, modelId)
      : null;

  const isCustomExternalUrl = /^https?:\/\//i.test(customModelBaseUrl.trim());
  const hasLocalModel =
    modelSource === 'local-only' ||
    Boolean(localEntry) ||
    (modelSource === 'auto' &&
      !isCustomExternalUrl &&
      (await probeLocalModelConfig(manifestBaseUrl, modelId)));

  // Auto mode uses WASM on phones/tablets: mobile WebGPU drivers can fail mid-inference
  // (e.g. ONNX Runtime "Cannot read properties of undefined (reading 'destroy')" on Android).
  const webGpuSupported =
    !webGpuFailed &&
    (requestedDevice === 'webgpu' ||
      (requestedDevice === 'auto' && !isMobileDevice() && (await canUseWebGpu())));

  const preferWebGpu =
    webGpuSupported &&
    !(localEntry && localEntry.wasmQ8 && !localEntry.webgpu && requestedDevice === 'auto');

  const targetBackend: 'webgpu' | 'wasm' = preferWebGpu ? 'webgpu' : 'wasm';

  setStage('configuring the ONNX runtime');
  const { useLocalFilesOnly } = await configureSelfHostedRuntime(
    appBaseUrl,
    modelSource,
    customModelBaseUrl,
    targetBackend,
    hasLocalModel
  );

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

  // Remove SPA index.html responses cached by earlier builds under /models/... keys.
  // Transformers.js checks the cache by local path even when allowLocalModels=false,
  // so a stale HTML entry would otherwise cause `Unexpected token '<'` forever.
  setStage('cleaning the model cache');
  await purgeHtmlModelCacheEntries();

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  const sourceLabel =
    modelSource === 'local-only' || localEntry
      ? 'from your self-hosted server'
      : 'and caching locally for offline use';

  const onModelProgress = (info: ProgressInfo) => {
    if ((info.status === 'initiate' || info.status === 'download') && info.file) {
      diag.file = `${info.name}/${info.file}`;
      setStage('downloading model files');
    } else if (info.status === 'ready') {
      diag.file = undefined;
      setStage(`starting the ${diag.backend?.toUpperCase() ?? ''} inference session`);
    }
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
        stage: stageLabel,
        progress: Math.max(progressRange[0] + 0.02, progressRange[0] + frac * (progressRange[1] - progressRange[0])),
        detail: `${mbLoaded} MB${mbTotal} (${sourceLabel})`,
      });
    } else if (info.status === 'initiate') {
      post({
        type: 'progress',
        jobId,
        stage: stageLabel,
        progress: progressRange[0] + 0.04 * (progressRange[1] - progressRange[0]) * 4,
        detail: info.file ? `Preparing ${info.file}` : undefined,
      });
    }
  };

  const lowMemory = isLowMemoryDevice();
  const loadWithBackend = async (backend: 'webgpu' | 'wasm') => {
    diag.backend = backend;
    setStage(`loading the model (${backend.toUpperCase()})`);
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
      webGpuFailed = true;
      diag.webgpuError = errorText(err);
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

function buildDiagnosticDetails(error: unknown, modelId: string, modelSource: ModelSource): string {
  const stack = error instanceof Error ? error.stack : undefined;
  const cause =
    error instanceof Error && (error as Error & { cause?: unknown }).cause
      ? errorText((error as Error & { cause?: unknown }).cause)
      : undefined;
  const wasmPaths = env.backends?.onnx?.wasm?.wasmPaths;
  const lines = [
    `Error: ${errorText(error)}`,
    cause ? `Underlying cause: ${cause}` : '',
    `Failed while: ${diag.stage}`,
    diag.file ? `Model file: ${diag.file}` : '',
    diag.lastUrl ? `Last URL requested: ${diag.lastUrl}` : '',
    `Model: ${modelId} (hosting=${modelSource}, backend=${diag.backend ?? 'not chosen yet'})`,
    diag.webgpuError ? `WebGPU attempt failed first: ${diag.webgpuError}` : '',
    `Model host: ${env.remoteHost} (remote=${env.allowRemoteModels}, local=${env.allowLocalModels} at ${env.localModelPath})`,
    wasmPaths ? `ONNX runtime files: ${typeof wasmPaths === 'string' ? wasmPaths : JSON.stringify(wasmPaths)}` : '',
    `Browser: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    stack ? `Stack:\n${stack}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function describeWorkerError(
  error: unknown,
  modelId: string,
  modelSource: ModelSource
): { message: string; details: string } {
  const name = error instanceof Error ? error.name : '';
  const raw = error instanceof Error ? error.message : String(error);
  const details = buildDiagnosticDetails(error, modelId, modelSource);
  const lower = `${name} ${raw}`.toLowerCase();
  const where = diag.file ? ` (${diag.stage}: ${diag.file})` : ` (while ${diag.stage})`;
  const cause = `Cause: ${name ? `${name}: ` : ''}${raw}${where}`;

  let summary: string;
  if (lower.includes('maximum call stack')) {
    summary =
      "The browser's speech engine ran out of stack space. This is a known limit in Safari on iPad; try Whisper Tiny (.en) and send the Error Log details.";
  } else if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('allocation') ||
    (lower.includes('wasm') && lower.includes('memory'))
  ) {
    summary =
      'This device ran out of browser memory. Switch to "Whisper Tiny (.en)" in AI Models or try a shorter clip.';
  } else if (
    modelSource === 'local-only' &&
    (lower.includes('not found locally') ||
      lower.includes('local_files_only') ||
      lower.includes('404'))
  ) {
    const shortKey = modelId.includes('tiny') ? 'tiny' : modelId.includes('base') ? 'base' : 'small';
    summary = `Model "${modelId}" was not found on your self-hosted server. Run "npm run models:download -- --models=${shortKey}" on your host (or switch Model Hosting to Auto).`;
  } else if (
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('importing a module script failed') ||
    lower.includes('err_internet')
  ) {
    summary =
      'A model or runtime file could not be downloaded. The address below may be blocked by your network (e.g. a school content filter) or you may be offline.';
  } else if (/\b(401|403|451)\b/.test(lower)) {
    summary = 'The download was refused by the server or a network filter.';
  } else {
    summary = 'On-device transcription failed.';
  }

  return { message: `${summary}\n${cause}`, details };
}

// Catch errors that escape the try/catch below (e.g. thrown inside ONNX Runtime callbacks).
let lastRequest: WorkerRequest | null = null;
function reportEscapedError(error: unknown): void {
  if (!activeJobId || !lastRequest) return;
  const { message, details } = describeWorkerError(error, lastRequest.modelId, lastRequest.modelSource);
  post({ type: 'error', jobId: activeJobId, message, details });
}
self.addEventListener('error', (event: ErrorEvent) => {
  reportEscapedError(
    event.error ?? new Error(`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
  );
});
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  reportEscapedError(event.reason);
});

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  activeJobId = req.jobId;
  lastRequest = req;

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

      let { transcriber, backendUsed } = await ensurePipeline(
        req.jobId,
        req.modelId,
        req.device,
        req.modelSource,
        req.customModelBaseUrl,
        req.appBaseUrl
      );

      // Speech-first windows: find the speech, skip silence (Whisper pads every window to 30 s
      // and invents text over silence), and pack utterances into windows joined by short
      // stretches of background noise. Times map back to the recording.
      const slices = buildSpeechSlices(req.audio, 16000, SPEECH_WINDOW_SEC);
      const speechRegions = slices.flatMap((sl) => sl.pieces.map((p) => ({ start: p.srcStart, end: p.srcEnd })));
      if (slices.length === 0) {
        post({
          type: 'done',
          jobId: req.jobId,
          transcript: '',
          utterances: [],
          backendUsed,
        });
        return;
      }

      const allChunks: Array<{ timestamp: [number, number | null]; text: string }> = [];
      /** Recognized words per Whisper segment, with the segment's span in recording time. */
      const records: WordRecord[] = [];
      // Second opinion compares two Whisper models (Moonshine is used on its own)
      const compareModelId =
        req.compareModelId &&
        req.compareModelId !== req.modelId &&
        !isMoonshineModel(req.modelId) &&
        !isMoonshineModel(req.compareModelId)
          ? req.compareModelId
          : undefined;
      // With a second opinion, the main pass uses 25–60% of the bar and the comparison 60–93%
      const primaryEnd = compareModelId ? 0.6 : 0.93;
      const maxTokensFor = (slice: { samples: Float32Array }) =>
        Math.min(224, Math.max(64, Math.ceil(Math.max(0.5, slice.samples.length / 16000) * 6)));

      /**
       * Re-transcribes one stretch of speech on its own (safety net for phrases Whisper dropped
       * from a longer window). Returns chunks in recording time.
       */
      const transcribePiece = async (piece: {
        srcStart: number;
        srcEnd: number;
      }): Promise<{ chunks: Array<{ timestamp: [number, number | null]; text: string }>; records: WordRecord[] }> => {
        const samples = req.audio.subarray(Math.floor(piece.srcStart * 16000), Math.ceil(piece.srcEnd * 16000));
        const rec = new TokenConfidenceRecorder();
        const promptIds = buildVocabularyPromptIds(transcriber, req.vocabulary);
        const out = await transcriber(samples, {
          return_timestamps: true,
          max_new_tokens: Math.min(224, Math.max(32, Math.ceil((piece.srcEnd - piece.srcStart) * 6))),
          logits_processor: new RecorderLastProcessorList(rec),
          ...(promptIds ? { decoder_input_ids: promptIds } : {}),
        } as Parameters<AutomaticSpeechRecognitionPipeline>[1]);
        const single = Array.isArray(out) ? out[0] : out;
        const rel = promptIds
          ? chunksFromRecorder(transcriber, rec)
          : single?.chunks ?? (single?.text?.trim() ? [{ timestamp: [0, null] as [number, number | null], text: single.text }] : []);
        if (rel.length === 0 || looksLikeRepetitionLoop(rel)) return { chunks: [], records: [] };
        return {
          chunks: rel.map((c: { timestamp?: [number, number | null]; text: string }) => ({
            timestamp: [
              Math.min(piece.srcEnd, piece.srcStart + (c.timestamp?.[0] ?? 0)),
              c.timestamp?.[1] != null ? Math.min(piece.srcEnd, piece.srcStart + c.timestamp[1]) : piece.srcEnd,
            ] as [number, number | null],
            text: c.text,
          })),
          records: timedWordSegmentsFromRecorder(transcriber, rec).map((seg) => ({
            start: Math.min(piece.srcEnd, piece.srcStart + seg.start),
            end: seg.end !== null ? Math.min(piece.srcEnd, piece.srcStart + seg.end) : piece.srcEnd,
            words: seg.words,
          })),
        };
      };

      if (isMoonshineModel(req.modelId)) {
        // Moonshine: no 30 s padding, so each stretch of speech (long ones split near 20 s) is
        // transcribed on its own; its line starts where the speech starts.
        const pieces = packSpeechWindows(req.audio, speechRegions, 16000, 20).flatMap((w) => w.pieces);
        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i];
          post({
            type: 'progress',
            jobId: req.jobId,
            stage: `Transcribing utterance ${i + 1} of ${pieces.length}`,
            progress: 0.25 + (i / pieces.length) * (primaryEnd - 0.25),
            detail: `Running 100% locally (${backendUsed.toUpperCase()})`,
          });
          setStage(`transcribing utterance ${i + 1} of ${pieces.length}`);
          const samples = req.audio.subarray(Math.floor(piece.srcStart * 16000), Math.ceil(piece.srcEnd * 16000));
          const maxNew = Math.ceil((piece.srcEnd - piece.srcStart) * 6.5) + 10;
          const runPiece = async (antiLoop: boolean) => {
            const rec = new TokenConfidenceRecorder();
            const out = await transcriber(samples, {
              max_new_tokens: maxNew,
              logits_processor: new RecorderLastProcessorList(rec),
              ...(antiLoop ? { repetition_penalty: 1.2 } : {}),
            } as Parameters<AutomaticSpeechRecognitionPipeline>[1]);
            const single = Array.isArray(out) ? out[0] : out;
            return { text: (single?.text ?? '').trim(), rec };
          };
          let result = await runPiece(false);
          if (result.text && looksLikeRepetitionLoop([{ timestamp: [0, null], text: result.text }])) {
            const retry = await runPiece(true);
            if (!looksLikeRepetitionLoop([{ timestamp: [0, null], text: retry.text }])) result = retry;
          }
          if (result.text) {
            // A stretch of speech is an utterance: end it with terminal punctuation for SALT
            // (Moonshine often ends a piece with a comma)
            const text = result.text.replace(/[\s,;:]+$/, '');
            const ended = /[.!?]["')\]]*$/.test(text) ? text : `${text}.`;
            allChunks.push({ timestamp: [piece.srcStart, piece.srcEnd], text: ` ${ended}` });
            records.push({
              start: piece.srcStart,
              end: piece.srcEnd,
              words: tokenSegmentsFromRecorder(transcriber, result.rec).flat(),
            });
          }
          if (i % 4 === 3 || i + 1 === pieces.length) {
            post({
              type: 'partial',
              jobId: req.jobId,
              partialTranscript: formatWhisperChunks(collapseRepetitions(allChunks), speechRegions),
            });
          }
          if (i + 1 < pieces.length) await yieldToEventLoop();
        }
      } else {
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const baseProgress = 0.25 + (i / slices.length) * (primaryEnd - 0.25);
        post({
          type: 'progress',
          jobId: req.jobId,
          stage: `Transcribing segment ${i + 1} of ${slices.length}`,
          progress: baseProgress,
          detail: `Running 100% locally (${backendUsed.toUpperCase()})`,
        });

        const segDurationSec = Math.max(0.5, slice.samples.length / 16000);
        // Cap generated tokens per segment (~6 tokens/sec max speech rate) to prevent
        // Whisper 448-token hallucination loops on iPad/mobile browsers.
        const maxNewTokens = Math.min(224, Math.max(64, Math.ceil(segDurationSec * 6)));

        setStage(`transcribing segment ${i + 1} of ${slices.length}`);
        let recorder = new TokenConfidenceRecorder();
        let usedPrompt = false;
        const runSegment = (pipe: AutomaticSpeechRecognitionPipeline, antiLoop = false) => {
          recorder = new TokenConfidenceRecorder();
          // The anti-loop retry drops the vocabulary prompt (prompts make loops more likely)
          const promptIds = antiLoop ? null : buildVocabularyPromptIds(pipe, req.vocabulary);
          usedPrompt = promptIds !== null;
          return pipe(slice.samples, {
            return_timestamps: true,
            max_new_tokens: maxNewTokens,
            logits_processor: new RecorderLastProcessorList(recorder),
            ...(promptIds ? { decoder_input_ids: promptIds } : {}),
            ...(antiLoop ? { repetition_penalty: 1.2 } : {}),
          } as Parameters<AutomaticSpeechRecognitionPipeline>[1]);
        };

        let output: Awaited<ReturnType<typeof runSegment>>;
        try {
          output = await runSegment(transcriber);
        } catch (err) {
          if (backendUsed !== 'webgpu') throw err;
          // WebGPU failed mid-inference: switch this worker to WASM and retry the same segment.
          webGpuFailed = true;
          diag.webgpuError = errorText(err);
          post({
            type: 'progress',
            jobId: req.jobId,
            stage: 'Switching to WASM engine',
            progress: baseProgress,
            detail: 'WebGPU failed on this device. Retrying with the universal WASM engine.',
          });
          ({ transcriber, backendUsed } = await ensurePipeline(
            req.jobId,
            req.modelId,
            req.device,
            req.modelSource,
            req.customModelBaseUrl,
            req.appBaseUrl
          ));
          setStage(`transcribing segment ${i + 1} of ${slices.length} (WASM retry)`);
          output = await runSegment(transcriber);
        }

        const chunksOf = (out: typeof output) => {
          const single = Array.isArray(out) ? out[0] : out;
          // With a vocabulary prompt, the pipeline's decoded text would start with the prompt words,
          // so rebuild the timestamped chunks from the generated tokens only.
          return usedPrompt ? chunksFromRecorder(transcriber, recorder) : single?.chunks;
        };
        let sliceChunks = chunksOf(output);
        // Repetition loop ("What? What? What? …"): retry once without the prompt and with a
        // repetition penalty; keep the retry only if it no longer loops.
        if (sliceChunks && looksLikeRepetitionLoop(sliceChunks)) {
          setStage(`transcribing segment ${i + 1} of ${slices.length} (repetition retry)`);
          const firstRecorder = recorder;
          const firstUsedPrompt = usedPrompt;
          const firstOutput = output;
          const firstChunks = sliceChunks;
          try {
            const retry = await runSegment(transcriber, true);
            const retryChunks = chunksOf(retry);
            if (retryChunks && !looksLikeRepetitionLoop(retryChunks)) {
              output = retry;
              sliceChunks = retryChunks;
            } else {
              recorder = firstRecorder;
              usedPrompt = firstUsedPrompt;
              output = firstOutput;
              sliceChunks = firstChunks;
            }
          } catch {
            recorder = firstRecorder;
            usedPrompt = firstUsedPrompt;
            output = firstOutput;
            sliceChunks = firstChunks;
          }
        }

        const sliceRecords: WordRecord[] = timedWordSegmentsFromRecorder(transcriber, recorder).map((seg) => ({
          start: slice.toSource(seg.start),
          end: seg.end !== null ? slice.toSource(seg.end) : slice.endSec,
          words: seg.words,
        }));
        const singleOutput = Array.isArray(output) ? output[0] : output;
        if (sliceChunks && sliceChunks.length > 0) {
          const mapped: Array<{ timestamp: [number, number | null]; text: string } | null> = sliceChunks.map((ch: { timestamp?: [number, number | null]; text: string }) => {
            const relStart = ch.timestamp?.[0] ?? 0;
            const relEnd = ch.timestamp?.[1] ?? null;
            return {
              timestamp: [slice.toSource(relStart), relEnd !== null ? slice.toSource(relEnd) : null] as [number, number | null],
              text: ch.text,
            };
          });
          // Safety net: a segment with far too few words for its speech skipped part of a phrase.
          // Re-transcribe each stretch of speech under it and keep that if it finds clearly more.
          for (const { index, pieces } of sparseChunks(slice, sliceChunks)) {
            setStage(`transcribing segment ${i + 1} of ${slices.length} (re-checking a short segment)`);
            try {
              const parts: Array<Awaited<ReturnType<typeof transcribePiece>>> = [];
              for (const piece of pieces) parts.push(await transcribePiece(piece));
              const countWords = (t: string) => t.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
              const before = countWords(sliceChunks[index].text);
              const after = parts.reduce((n, part) => n + part.chunks.reduce((m, c) => m + countWords(c.text), 0), 0);
              if (after >= before * 1.3 + 2) {
                // Replace the short segment (its text and its words) with the re-checked pieces
                const replaced = mapped[index];
                mapped[index] = null;
                if (replaced) {
                  const [rs, re] = replaced.timestamp;
                  for (let r = sliceRecords.length - 1; r >= 0; r--) {
                    const st = sliceRecords[r].start;
                    if (st >= rs - 0.05 && st < (re ?? Infinity) - 0.05) sliceRecords.splice(r, 1);
                  }
                }
                for (const part of parts) {
                  allChunks.push(...part.chunks);
                  sliceRecords.push(...part.records);
                }
              }
            } catch {
              // best-effort
            }
          }
          for (const m of mapped) if (m) allChunks.push(m);
          allChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);
        } else if (!usedPrompt && singleOutput?.text?.trim()) {
          allChunks.push({
            timestamp: [slice.startSec, slice.endSec],
            text: singleOutput.text,
          });
        }

        // Safety net: speech that no transcribed text covers was probably dropped; transcribe it alone
        const missed = uncoveredPieces(slice, sliceChunks ?? []);
        for (const piece of missed) {
          setStage(`transcribing segment ${i + 1} of ${slices.length} (recovering a missed phrase)`);
          try {
            const recovered = await transcribePiece(piece);
            allChunks.push(...recovered.chunks);
            sliceRecords.push(...recovered.records);
          } catch {
            // best-effort
          }
        }
        if (missed.length > 0) allChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);
        records.push(...sliceRecords);

        post({
          type: 'partial',
          jobId: req.jobId,
          partialTranscript: formatWhisperChunks(collapseRepetitions(allChunks)),
        });

        // Yield briefly between segments so Safari GC can reclaim intermediate WASM/JS buffers
        if (i + 1 < slices.length) {
          await yieldToEventLoop();
        }
      }
      }

      // Second opinion: run the other model over the same windows and mark where it disagrees.
      // The transcript text stays the main model's; disagreements become review flags.
      // (Re-checking only uncertain segments was tested and saved no time: most segments hold at
      // least one word below the flag threshold.)
      records.sort((a, b) => a.start - b.start);
      let secondOpinionModelId: WhisperModelId | undefined;
      if (compareModelId) {
        try {
          const second = await ensurePipeline(
            req.jobId,
            compareModelId,
            req.device,
            req.modelSource,
            req.customModelBaseUrl,
            req.appBaseUrl,
            [primaryEnd, primaryEnd + 0.05],
            'Loading second-opinion model'
          );
          const secondWords: WordProbability[] = [];
          for (let i = 0; i < slices.length; i++) {
            post({
              type: 'progress',
              jobId: req.jobId,
              stage: `Second opinion: segment ${i + 1} of ${slices.length}`,
              progress: primaryEnd + 0.05 + (i / slices.length) * (0.93 - primaryEnd - 0.05),
              detail: 'Comparing with a second model to flag words worth re-checking',
            });
            setStage(`second-opinion segment ${i + 1} of ${slices.length}`);
            const secondRecorder = new TokenConfidenceRecorder();
            const secondPrompt = buildVocabularyPromptIds(second.transcriber, req.vocabulary);
            await second.transcriber(slices[i].samples, {
              return_timestamps: true,
              max_new_tokens: maxTokensFor(slices[i]),
              logits_processor: new RecorderLastProcessorList(secondRecorder),
              ...(secondPrompt ? { decoder_input_ids: secondPrompt } : {}),
            } as Parameters<AutomaticSpeechRecognitionPipeline>[1]);
            secondWords.push(...tokenSegmentsFromRecorder(second.transcriber, secondRecorder).flat());
            if (i + 1 < slices.length) await yieldToEventLoop();
          }
          // Both passes cover the same audio in order: align all words and write the result back
          const primary = records.flatMap((r) => r.words);
          if (secondWords.length > 0 && primary.length > 0) {
            const annotated = annotateDisagreements(primary, secondWords);
            let k = 0;
            for (const r of records) {
              r.words = annotated.slice(k, k + r.words.length);
              k += r.words.length;
            }
          }
          secondOpinionModelId = compareModelId;
        } catch (err) {
          // A second opinion is optional: keep the main transcript if it fails (e.g. low memory)
          post({
            type: 'progress',
            jobId: req.jobId,
            stage: 'Second opinion skipped',
            progress: 0.93,
            detail: `The comparison model could not run on this device (${errorText(err)}). Your transcript is unaffected.`,
          });
        }
      }

      const allWords = records.flatMap((r) => r.words);
      // Remove leftover repetition loops and text produced over silence
      const cleanedChunks = dropSilentChunks(collapseRepetitions(allChunks), req.audio, 16000);
      const utterances = extractWhisperUtterances(cleanedChunks, speechRegions);
      const transcript = utterances.map((u) => `[${u.timestampStr}] ${u.text}`).join('\n');
      let wordConfidence: WordConfidenceMap | undefined;
      try {
        // Store nearly every word's confidence so review thresholds can be tuned live
        wordConfidence = buildWordConfidenceMap(transcript, allWords, STORE_CONFIDENCE_BELOW);
      } catch {
        wordConfidence = undefined; // confidence is a review aid; never fail transcription over it
      }
      post({
        type: 'done',
        jobId: req.jobId,
        transcript,
        utterances,
        wordConfidence,
        secondOpinionModelId,
        backendUsed,
      });
    }
  } catch (err) {
    const { message, details } = describeWorkerError(
      err,
      req.modelId,
      req.modelSource
    );
    post({
      type: 'error',
      jobId: req.jobId,
      message,
      details,
    });
  }
};
