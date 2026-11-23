import type { SpeakerAliases, WhisperModelId } from '../../types/session';
import { decodeAudioBlob, prepareWhisperAudio } from '../audio/wavEncoder';
import { isMemoryConstrainedDevice, resolveSafeWhisperModel } from '../storage/sessionStore';

export interface TranscriptionCallbacks {
  onProgress: (stage: string, progress: number) => void;
}

export interface TranscriptionResult {
  transcript: string;
  speakerCount: 1 | 2;
  effectiveModelId: WhisperModelId;
}

interface WorkerMessage {
  type: 'progress' | 'done' | 'error';
  stage?: string;
  progress?: number;
  transcript?: string;
  speakerCount?: 1 | 2;
  effectiveModelId?: WhisperModelId;
  message?: string;
}

interface ScreenWakeLockSentinel {
  release: () => Promise<void>;
}

/**
 * Manages the on-device Whisper Web Worker with clean cancellation (worker termination),
 * automatic WASM heap reclamation when switching models, screen wake-lock protection
 * on iPads/tablets, and stall watchdog recovery.
 */
export class TranscriptionService {
  private worker: Worker | null = null;
  private loadedModelId: WhisperModelId | null = null;
  private activeReject: ((reason?: unknown) => void) | null = null;

  private ensureWorker(targetModelId: WhisperModelId): Worker {
    // Terminating the worker when changing models immediately returns the entire WASM
    // linear memory heap to iOS/iPadOS so two Whisper models never coexist in RAM.
    if (this.worker && this.loadedModelId && this.loadedModelId !== targetModelId) {
      this.terminateWorker();
    }
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/whisper.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.loadedModelId = targetModelId;
    }
    return this.worker;
  }

  private async requestWakeLock(): Promise<ScreenWakeLockSentinel | null> {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<ScreenWakeLockSentinel> };
      };
      if (nav.wakeLock) {
        return await nav.wakeLock.request('screen');
      }
    } catch {
      // Wake Lock is optional (ignored if unsupported or tab unfocused)
    }
    return null;
  }

  public async transcribeBlob(
    audioBlob: Blob,
    modelId: WhisperModelId,
    aliases: SpeakerAliases,
    callbacks: TranscriptionCallbacks
  ): Promise<TranscriptionResult> {
    const safeModelId = resolveSafeWhisperModel(modelId);
    const lowMemory = isMemoryConstrainedDevice();

    callbacks.onProgress('Preparing & normalizing audio...', 0.02);
    const decoded = await decodeAudioBlob(audioBlob);
    const audio16k = await prepareWhisperAudio(decoded);

    const worker = this.ensureWorker(safeModelId);
    const wakeLock = await this.requestWakeLock();

    // Resettable inactivity watchdog: resets on every download progress tick and every
    // completed audio segment so long recordings never falsely time out while making progress.
    const stallTimeoutMs = lowMemory ? 180_000 : 240_000;

    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.activeReject = reject;
      let settled = false;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;

      const clearWatchdog = () => {
        if (stallTimer !== null) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };

      const cleanup = () => {
        clearWatchdog();
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        this.activeReject = null;
        void wakeLock?.release().catch(() => {});
      };

      const resetWatchdog = () => {
        clearWatchdog();
        stallTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          this.terminateWorker();
          reject(
            new Error(
              'Transcription stalled without progress. Try keeping the screen awake or switching to Whisper Base (~75 MB) or Whisper Tiny (~40 MB).'
            )
          );
        }, stallTimeoutMs);
      };

      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        if (settled) return;
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'progress') {
          resetWatchdog();
          callbacks.onProgress(msg.stage ?? 'Transcribing...', msg.progress ?? 0.5);
        } else if (msg.type === 'done') {
          settled = true;
          cleanup();
          // On memory-constrained iPads/tablets, release the large model's WASM heap
          // right after transcription finishes so editing, playback, and export stay
          // safely below iPadOS Jetsam limits (the model remains cached locally).
          if (
            lowMemory &&
            (safeModelId === 'onnx-community/distil-small.en' ||
              safeModelId === 'Xenova/whisper-small.en')
          ) {
            this.terminateWorker();
          }
          resolve({
            transcript: msg.transcript ?? '',
            speakerCount: msg.speakerCount ?? 1,
            effectiveModelId: msg.effectiveModelId ?? safeModelId,
          });
        } else if (msg.type === 'error') {
          settled = true;
          cleanup();
          this.terminateWorker();
          reject(new Error(msg.message ?? 'Transcription failed.'));
        }
      };

      const onError = (event: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.terminateWorker();
        reject(
          new Error(
            event.message ||
              'Speech transcription worker stopped unexpectedly (device memory limit). Try Whisper Base or Whisper Tiny.'
          )
        );
      };

      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.terminateWorker();
        reject(new Error('Could not communicate with the speech transcription worker. Please retry.'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);

      resetWatchdog();

      // Transfer Float32Array buffer cleanly with zero copy overhead
      worker.postMessage(
        {
          type: 'transcribe',
          audio: audio16k,
          modelId: safeModelId,
          aliases,
          lowMemory,
        },
        [audio16k.buffer]
      );
    });
  }

  public cancel(): void {
    const reject = this.activeReject;
    this.activeReject = null;
    this.terminateWorker();
    if (reject) {
      reject(new DOMException('Transcription cancelled', 'AbortError'));
    }
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.loadedModelId = null;
    }
  }
}
