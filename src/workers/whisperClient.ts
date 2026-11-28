import type {
  ComputeDevice,
  ModelSource,
  SpeakerAliases,
  WhisperModelId,
} from '../types/saltify';
import { autoAssignSpeakersInTranscript } from '../engine/speakerDiarizer';
import { isCloudModel } from '../types/saltify';
import { cloudTranscribeRaw } from './cloudTranscriber';
import type { WordConfidenceMap } from '../engine/wordConfidence';
import type { WorkerRequest, WorkerResponse } from './whisper.worker';

export interface TranscribeCallbacks {
  onProgress?: (stage: string, progress: number, detail?: string) => void;
  onPartial?: (partialTranscript: string) => void;
}

export interface TranscribeResult {
  transcript: string;
  /** Uncertain words per transcript line (Whisper token probability). */
  wordConfidence?: WordConfidenceMap;
  /** Second-opinion model that was compared, when it ran. */
  secondOpinionModelId?: WhisperModelId;
  backendUsed: 'webgpu' | 'wasm' | 'cloud';
  speakerCount: 1 | 2;
}

export interface PreloadResult {
  modelId: WhisperModelId;
  backendUsed: 'webgpu' | 'wasm' | 'cloud';
}

export interface WhisperModelRuntimeOptions {
  modelId: WhisperModelId;
  /** Second model to compare against during transcription (flags disagreements). */
  compareModelId?: WhisperModelId;
  /** Expected words (names, story vocabulary) given to Whisper as a hint. */
  vocabulary?: string;
  /** 'speech-first' (default) or 'classic' (pre-1.12 fixed chunks, no re-checks). */
  chunking?: 'speech-first' | 'classic';
  device: ComputeDevice;
  modelSource: ModelSource;
  customModelBaseUrl: string;
  aliases?: SpeakerAliases;
  /** Access key for cloud transcription (Cloudflare model only). */
  cloudAccessKey?: string;
}

class CancelledError extends Error {
  constructor() {
    super('Processing was cancelled.');
    this.name = 'CancelledError';
  }
}

/** An error from the Whisper worker, carrying full diagnostics for the Error Log. */
/** Worker output before speaker labeling. */
export interface RawTranscription {
  transcript: string;
  utterances?: Array<{ startSec: number; endSec: number; timestampStr?: string; text: string }>;
  wordConfidence?: WordConfidenceMap;
  secondOpinionModelId?: WhisperModelId;
  backendUsed: 'webgpu' | 'wasm' | 'cloud';
}

/** Warn when the worker has said nothing for this long during a job. */
const STALL_WARNING_MS = 90_000;

export class WhisperWorkerError extends Error {
  details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.name = 'WhisperWorkerError';
    this.details = details;
  }
}

export function getErrorDetails(error: unknown): string | undefined {
  if (error instanceof WhisperWorkerError) return error.details;
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  return undefined;
}

export function isCancelledError(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.name === 'CancelledError');
}

function getAppBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost/';
  return new URL('./', window.location.href).href;
}

/**
 * Manages a reusable Whisper Web Worker with instant cancellation via terminate(),
 * mirroring oss-slu/SpeechTranscription components/processing.py TranscriptionJob.
 */
export class WhisperWorkerClient {
  private worker: Worker | null = null;
  private activeJobId: string | null = null;
  private activeReject: ((reason?: unknown) => void) | null = null;
  private cloudAbort: AbortController | null = null;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  preloadModel(
    options: WhisperModelRuntimeOptions,
    onProgress?: (stage: string, progress: number, detail?: string) => void
  ): Promise<PreloadResult> {
    return this.runJob<PreloadResult>(
      (jobId) => ({
        type: 'preload',
        jobId,
        modelId: options.modelId,
        device: options.device,
        modelSource: options.modelSource,
        customModelBaseUrl: options.customModelBaseUrl,
        appBaseUrl: getAppBaseUrl(),
      }),
      { onProgress }
    );
  }

  /**
   * Transcription only (no speaker labeling): used for live segments while recording, where
   * speakers are labeled once over the whole recording at the end.
   */
  transcribeRaw(
    audio16k: Float32Array,
    options: WhisperModelRuntimeOptions,
    callbacks: TranscribeCallbacks = {}
  ): Promise<RawTranscription> {
    if (isCloudModel(options.modelId)) return this.cloudRaw(audio16k, options, callbacks);
    const copy = new Float32Array(audio16k);
    return this.runJob<RawTranscription>(
      (jobId) => ({
        type: 'transcribe',
        jobId,
        modelId: options.modelId,
        compareModelId: options.compareModelId,
        vocabulary: options.vocabulary,
        chunking: options.chunking,
        device: options.device,
        modelSource: options.modelSource,
        customModelBaseUrl: options.customModelBaseUrl,
        appBaseUrl: getAppBaseUrl(),
        audio: copy,
      }),
      callbacks,
      [copy.buffer]
    );
  }

  async transcribe(
    audio16k: Float32Array,
    options: WhisperModelRuntimeOptions,
    callbacks: TranscribeCallbacks = {}
  ): Promise<TranscribeResult> {
    const copy = new Float32Array(audio16k);
    const raw = isCloudModel(options.modelId)
      ? await this.cloudRaw(audio16k, options, callbacks)
      : await this.runJob<RawTranscription>(
      (jobId) => ({
        type: 'transcribe',
        jobId,
        modelId: options.modelId,
        compareModelId: options.compareModelId,
        vocabulary: options.vocabulary,
        chunking: options.chunking,
        device: options.device,
        modelSource: options.modelSource,
        customModelBaseUrl: options.customModelBaseUrl,
        appBaseUrl: getAppBaseUrl(),
        audio: copy,
      }),
      callbacks,
      [copy.buffer]
    );

    if (!raw.transcript.trim()) {
      return { transcript: '', backendUsed: raw.backendUsed, speakerCount: 1 };
    }

    // Speaker assignment runs here on the main thread (not in the worker) because it uses the
    // wink grammar lexicon, which overflows Safari's Web Worker stack when loaded there.
    callbacks.onProgress?.('Assigning speakers locally', 0.96);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const diarized = autoAssignSpeakersInTranscript(
      raw.transcript,
      options.aliases ?? { speaker1: 'C', speaker2: 'E' },
      audio16k,
      16000,
      {
        mode: 'auto',
        exactSegments: raw.utterances,
      }
    );
    return {
      transcript: diarized.transcript,
      wordConfidence: raw.wordConfidence,
      secondOpinionModelId: raw.secondOpinionModelId,
      backendUsed: raw.backendUsed,
      speakerCount: diarized.speakerCount,
    };
  }

  /** Cloud transcription (Cloudflare Workers AI); cancellable like a worker job. */
  private async cloudRaw(
    audio16k: Float32Array,
    options: WhisperModelRuntimeOptions,
    callbacks: TranscribeCallbacks
  ): Promise<RawTranscription> {
    const controller = new AbortController();
    this.cloudAbort = controller;
    try {
      return await cloudTranscribeRaw(
        audio16k,
        { accessKey: options.cloudAccessKey ?? '', vocabulary: options.vocabulary, signal: controller.signal },
        callbacks.onProgress
      );
    } catch (err) {
      if (controller.signal.aborted) throw new CancelledError();
      throw err;
    } finally {
      if (this.cloudAbort === controller) this.cloudAbort = null;
    }
  }

  cancel(): void {
    if (this.cloudAbort) {
      this.cloudAbort.abort();
      this.cloudAbort = null;
    }
    if (this.activeReject) {
      const reject = this.activeReject;
      this.activeReject = null;
      this.activeJobId = null;
      reject(new CancelledError());
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private runJob<T>(
    buildRequest: (jobId: string) => WorkerRequest,
    callbacks: TranscribeCallbacks,
    transfer: Transferable[] = []
  ): Promise<T> {
    if (this.activeJobId) {
      this.cancel();
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const worker = this.getWorker();
    this.activeJobId = jobId;

    return new Promise<T>((resolve, reject) => {
      this.activeReject = reject;

      // Stall watchdog: the worker reports progress at least every few seconds while it works
      // (a heartbeat per generated word), so long silence means the device is struggling.
      let lastMessageAt = Date.now();
      let lastStage = 'Working';
      let lastProgress = 0;
      let stallWarned = false;
      const stallTimer = setInterval(() => {
        if (!stallWarned && Date.now() - lastMessageAt > STALL_WARNING_MS) {
          stallWarned = true;
          callbacks.onProgress?.(
            lastStage,
            lastProgress,
            'No progress for over 90 seconds. This device may be low on memory or busy. You can keep waiting, or cancel and try Moonshine or Whisper Base, which need far less.'
          );
        }
      }, 5000);

      const cleanup = () => {
        clearInterval(stallTimer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (this.activeJobId === jobId) {
          this.activeJobId = null;
          this.activeReject = null;
        }
      };

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg || msg.jobId !== jobId) return;
        lastMessageAt = Date.now();
        stallWarned = false;

        if (msg.type === 'progress') {
          lastStage = msg.stage;
          lastProgress = msg.progress;
          callbacks.onProgress?.(msg.stage, msg.progress, msg.detail);
        } else if (msg.type === 'partial') {
          callbacks.onPartial?.(msg.partialTranscript);
        } else if (msg.type === 'ready') {
          cleanup();
          resolve({
            modelId: msg.modelId,
            backendUsed: msg.backendUsed,
          } as T);
        } else if (msg.type === 'done') {
          cleanup();
          resolve({
            transcript: msg.transcript,
            utterances: msg.utterances,
            wordConfidence: msg.wordConfidence,
            secondOpinionModelId: msg.secondOpinionModelId,
            backendUsed: msg.backendUsed,
          } as T);
        } else if (msg.type === 'error') {
          cleanup();
          reject(new WhisperWorkerError(msg.message, msg.details));
        }
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        if (this.worker === worker) {
          worker.terminate();
          this.worker = null;
        }
        const where = event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : 'unknown location';
        const raw = event.message || 'no message from the browser';
        reject(
          new WhisperWorkerError(
            `The on-device transcription worker crashed.\nCause: ${raw} (at ${where})`,
            [
              `Worker crash: ${raw}`,
              `Location: ${where}`,
              event.error instanceof Error && event.error.stack ? `Stack:\n${event.error.stack}` : '',
              `Browser: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
            ]
              .filter(Boolean)
              .join('\n')
          )
        );
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      const payload = buildRequest(jobId);
      worker.postMessage(payload, transfer);
    });
  }
}

export const whisperClient = new WhisperWorkerClient();
