import { decodeAudioBlob, encodeWavFromAudioBuffer, extractWaveformPeaks } from './wavEncoder';

export interface RecordedAudioResult {
  wavBlob: Blob;
  duration: number;
  peaks: number[];
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function selectSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return undefined;
}

/**
 * Cross-platform browser microphone recorder compatible with iPad Safari (MP4/AAC),
 * Android Chrome (WebM/Opus), and Windows Chrome/Edge/Firefox, emitting normalized PCM WAV.
 */
export class BrowserAudioRecorder {
  private mediaStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRafId: number | null = null;
  private startTimeMs = 0;

  public async start(onLevel?: (level: number, elapsedSec: number) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Microphone recording requires a secure (HTTPS or localhost) browser context with microphone permissions.'
      );
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error(
        'MediaRecorder is not available in this browser. Update Safari/Chrome or upload a recorded audio file instead.'
      );
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/denied|permission|notallowed/i.test(msg)) {
        throw new Error(
          'Microphone permission was denied. Allow microphone access in your browser or iPad/Android settings and try again.'
        );
      }
      if (/notfound|no.*device/i.test(msg)) {
        throw new Error('No microphone was found on this device. Connect a microphone and retry.');
      }
      throw new Error(`Could not start microphone: ${msg}`);
    }

    const mimeType = selectSupportedMimeType();
    this.chunks = [];
    this.recorder = mimeType
      ? new MediaRecorder(this.mediaStream, { mimeType })
      : new MediaRecorder(this.mediaStream);

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.startTimeMs = performance.now();
    this.recorder.start(250);

    // Live RMS input meter so clinicians can verify voice pickup while recording
    if (onLevel) {
      try {
        const win = window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = win.AudioContext ?? win.webkitAudioContext;
        if (Ctor) {
          this.audioCtx = new Ctor();
          const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 256;
          source.connect(this.analyser);

          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
          const tick = () => {
            if (!this.analyser) return;
            this.analyser.getByteTimeDomainData(dataArray);
            let sumSquares = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const norm = (dataArray[i] - 128) / 128;
              sumSquares += norm * norm;
            }
            const rms = Math.sqrt(sumSquares / dataArray.length);
            const scaled = Math.min(1, rms * 3.5);
            const elapsedSec = (performance.now() - this.startTimeMs) / 1000;
            onLevel(scaled, elapsedSec);
            this.levelRafId = requestAnimationFrame(tick);
          };
          this.levelRafId = requestAnimationFrame(tick);
        }
      } catch {
        // Non-fatal: continue recording even if live VU meter fails
      }
    }
  }

  public async stop(): Promise<RecordedAudioResult> {
    if (!this.recorder) {
      throw new Error('No active recording to stop.');
    }

    const recorder = this.recorder;
    const rawBlob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Recording interrupted unexpectedly.'));
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        resolve(new Blob(this.chunks, { type }));
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      }
    });

    this.cleanup();

    if (rawBlob.size === 0) {
      throw new Error('The recording is empty. Record some speech before stopping.');
    }

    const decoded = await decodeAudioBlob(rawBlob);
    if (decoded.duration <= 0.05) {
      throw new Error('The recording is too short. Record a speech sample before stopping.');
    }

    const wavBlob = encodeWavFromAudioBuffer(decoded, false);
    const peaks = extractWaveformPeaks(decoded, 180);

    return {
      wavBlob,
      duration: decoded.duration,
      peaks,
    };
  }

  public cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Ignore
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.levelRafId !== null) {
      cancelAnimationFrame(this.levelRafId);
      this.levelRafId = null;
    }
    this.analyser = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    this.recorder = null;
    this.chunks = [];
  }
}
