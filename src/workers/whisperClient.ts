import type {
  ComputeDevice,
  ModelSource,
  SpeakerAliases,
  WhisperModelId,
} from '../types/saltify';
import type { WorkerRequest, WorkerResponse } from './whisper.worker';

export interface TranscribeCallbacks {
  onProgress?: (stage: string, progress: number, detail?: string) => void;
  onPartial?: (partialTranscript: string) => void;
}

export interface TranscribeResult {
  transcript: string;
  backendUsed: 'webgpu' | 'wasm';
  speakerCount: 1 | 2;
}

export interface PreloadResult {
  modelId: WhisperModelId;
  backendUsed: 'webgpu' | 'wasm';
}

export interface WhisperModelRuntimeOptions {
  modelId: WhisperModelId;
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

  transcribe(
    audio16k: Float32Array,
    options: WhisperModelRuntimeOptions,
    callbacks: TranscribeCallbacks = {}
  ): Promise<TranscribeResult> {
    const copy = new Float32Array(audio16k);
    return this.runJob<TranscribeResult>(
      (jobId) => ({
        type: 'transcribe',
        jobId,
        modelId: options.modelId,
        device: options.device,
        modelSource: options.modelSource,
        customModelBaseUrl: options.customModelBaseUrl,
        appBaseUrl: getAppBaseUrl(),
        aliases: options.aliases ?? { speaker1: 'C', speaker2: 'E' },
        audio: copy,
      }),
      callbacks,
      [copy.buffer]
    );
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
            backendUsed: msg.backendUsed,
            speakerCount: msg.speakerCount,
          } as T);
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.message));
        }
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        if (this.worker === worker) {
          worker.terminate();
          this.worker = null;
        }
        reject(
          new Error(
            event.message ||
              'The on-device transcription worker stopped unexpectedly. Try Whisper Tiny (.en) or retry.'
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
