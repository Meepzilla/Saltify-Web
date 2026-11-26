import type {
  ComputeDevice,
  ModelSource,
  SpeakerAliases,
  WhisperModelId,
} from '../types/saltify';
import { autoAssignSpeakersInTranscript } from '../engine/speakerDiarizer';
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
  backendUsed: 'webgpu' | 'wasm';
  speakerCount: 1 | 2;
}

export interface PreloadResult {
  modelId: WhisperModelId;
  backendUsed: 'webgpu' | 'wasm';
}

export interface WhisperModelRuntimeOptions {
  modelId: WhisperModelId;
  /** Second model to compare against during transcription (flags disagreements). */
  compareModelId?: WhisperModelId;
  device: ComputeDevice;
  modelSource: ModelSource;
  customModelBaseUrl: string;
  aliases?: SpeakerAliases;
}

class CancelledError extends Error {
  constructor() {
    super('Processing was cancelled.');
    this.name = 'CancelledError';
  }
}

/** An error from the Whisper worker, carrying full diagnostics for the Error Log. */
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

  async transcribe(
    audio16k: Float32Array,
    options: WhisperModelRuntimeOptions,
    callbacks: TranscribeCallbacks = {}
  ): Promise<TranscribeResult> {
    const copy = new Float32Array(audio16k);
    const raw = await this.runJob<{
      transcript: string;
      utterances?: Array<{ startSec: number; endSec: number; text: string }>;
      wordConfidence?: WordConfidenceMap;
      secondOpinionModelId?: WhisperModelId;
      backendUsed: 'webgpu' | 'wasm';
    }>(
      (jobId) => ({
        type: 'transcribe',
        jobId,
        modelId: options.modelId,
        compareModelId: options.compareModelId,
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

  cancel(): void {
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

      const cleanup = () => {
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

        if (msg.type === 'progress') {
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
