import type { WhisperModelId } from '../../types/session';
import { decodeAudioBlob, prepareWhisperAudio } from '../audio/wavEncoder';

export interface TranscriptionCallbacks {
  onProgress: (stage: string, progress: number) => void;
}

interface WorkerMessage {
  type: 'progress' | 'done' | 'error';
  stage?: string;
  progress?: number;
  transcript?: string;
  message?: string;
}

/**
 * Manages the on-device Whisper Web Worker with clean cancellation (worker termination),
 * matching upstream Saltify's cancellable `TranscriptionJob`.
 */
export class TranscriptionService {
  private worker: Worker | null = null;
  private activeReject: ((reason?: unknown) => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/whisper.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  public async transcribeBlob(
    audioBlob: Blob,
    modelId: WhisperModelId,
    callbacks: TranscriptionCallbacks
  ): Promise<string> {
    callbacks.onProgress('Preparing & normalizing audio...', 0.02);
    const decoded = await decodeAudioBlob(audioBlob);
    const audio16k = await prepareWhisperAudio(decoded);

    const worker = this.ensureWorker();

    return new Promise<string>((resolve, reject) => {
      this.activeReject = reject;

      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        this.activeReject = null;
      };

      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'progress') {
          callbacks.onProgress(msg.stage ?? 'Transcribing...', msg.progress ?? 0.5);
        } else if (msg.type === 'done') {
          cleanup();
          resolve(msg.transcript ?? '');
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.message ?? 'Transcription failed.'));
        }
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        this.terminateWorker();
        reject(new Error(event.message || 'Speech transcription worker crashed.'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      // Transfer Float32Array buffer cleanly with zero copy overhead
      worker.postMessage({ type: 'transcribe', audio: audio16k, modelId }, [audio16k.buffer]);
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
    }
  }
}
