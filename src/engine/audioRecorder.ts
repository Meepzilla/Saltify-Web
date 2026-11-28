import { createStreamingDownsampler, encodeWavBlob } from './audioProcessing';

export interface RecorderCallbacks {
  onLevel?: (level01: number) => void;
  onDuration?: (seconds: number) => void;
  /**
   * Live 16 kHz mono audio while recording (not while paused), for transcribing as you record.
   * Delivered in ~85 ms chunks.
   */
  onPcm16k?: (samples: Float32Array) => void;
}

/**
 * Selects the best supported MediaRecorder MIME type across Android, Windows, and iPadOS Safari.
 */
export function pickSupportedRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/aac',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/**
 * Cross-platform microphone recorder for Android Chrome, Windows Edge/Chrome,
 * and iPadOS Safari. Uses MediaRecorder with adaptive MIME type selection,
 * plus live Web Audio RMS level metering and Screen Wake Lock to prevent
 * tablets/phones from sleeping mid-session.
 */
export class CrossPlatformAudioRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private liveProcessor: ScriptProcessorNode | null = null;
  private liveSink: GainNode | null = null;
  private chunks: Blob[] = [];
  private pcmFallbackChunks: Float32Array[] = [];
  private pcmSampleRate = 44100;
  private usingPcmFallback = false;
  private rafId: number | null = null;
  private startTimeMs = 0;
  private accumulatedMs = 0;
  private paused = false;
  private wakeLock: WakeLockSentinel | null = null;
  private callbacks: RecorderCallbacks = {};

  get isRecording(): boolean {
    return this.stream !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  async start(callbacks: RecorderCallbacks = {}): Promise<void> {
    if (this.stream) return;
    this.callbacks = callbacks;
    this.chunks = [];
    this.pcmFallbackChunks = [];
    this.accumulatedMs = 0;
    this.paused = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Microphone access requires HTTPS (or localhost) and a modern browser.'
      );
    }

    try {
      // Request clean speech capture; keep echoCancellation/noiseSuppression on
      // for clinical rooms while preserving natural voice quality.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw new Error(
          'Microphone permission was denied. Allow microphone access in browser settings and retry.'
        );
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw new Error(
          'No microphone was found. Connect a microphone or check device audio settings.'
        );
      }
      throw new Error(
        `Could not access microphone: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }

    // Acquire Screen Wake Lock if supported (Android Chrome, Windows, iPadOS 16.4+)
    try {
      if ('wakeLock' in navigator && navigator.wakeLock?.request) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Non-fatal if Wake Lock isn't granted
    }

    // Set up Web Audio Analyser for smooth real-time VU metering
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.pcmSampleRate = this.audioContext.sampleRate;

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.72;
    source.connect(this.analyser);

    // Live 16 kHz feed for transcription while recording. ScriptProcessor works in every target
    // browser (incl. iPad Safari); it is routed through a muted gain so nothing is played back.
    if (callbacks.onPcm16k) {
      const down = createStreamingDownsampler(this.audioContext.sampleRate, 16000);
      this.liveProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.liveSink = this.audioContext.createGain();
      this.liveSink.gain.value = 0;
      this.liveProcessor.onaudioprocess = (event) => {
        if (this.paused) return;
        const pcm = down(event.inputBuffer.getChannelData(0));
        if (pcm.length > 0) this.callbacks.onPcm16k?.(pcm);
      };
      source.connect(this.liveProcessor);
      this.liveProcessor.connect(this.liveSink);
      this.liveSink.connect(this.audioContext.destination);
    }

    const mimeType = pickSupportedRecordingMimeType();
    if (typeof MediaRecorder !== 'undefined') {
      this.usingPcmFallback = false;
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      // Use 500ms timeslice so chunks flush steadily even on iPad Safari
      this.mediaRecorder.start(500);
    } else {
      // Fallback: raw Web Audio PCM capture -> WAV
      this.usingPcmFallback = true;
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.paused) return;
        const input = event.inputBuffer.getChannelData(0);
        this.pcmFallbackChunks.push(new Float32Array(input));
      };
      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
    }

    this.startTimeMs = performance.now();
    this.startMeterLoop();
  }

  pause(): void {
    if (!this.stream || this.paused) return;
    this.paused = true;
    this.accumulatedMs += performance.now() - this.startTimeMs;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.pause();
      } catch {
        // Older Safari builds may ignore pause()
      }
    }
    this.callbacks.onLevel?.(0);
  }

  resume(): void {
    if (!this.stream || !this.paused) return;
    this.paused = false;
    this.startTimeMs = performance.now();
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      try {
        this.mediaRecorder.resume();
      } catch {
        // Ignore if unsupported
      }
    }
  }

  async stop(): Promise<Blob> {
    if (!this.stream) {
      throw new Error('No active recording to stop.');
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    let resultBlob: Blob;

    if (!this.usingPcmFallback && this.mediaRecorder) {
      const recorder = this.mediaRecorder;
      const mime = recorder.mimeType || pickSupportedRecordingMimeType() || 'audio/mp4';

      resultBlob = await new Promise<Blob>((resolve, reject) => {
        const finalize = () => {
          const blob = new Blob(this.chunks, { type: mime });
          if (blob.size === 0) {
            reject(new Error('The recording is empty. Record some audio before stopping.'));
          } else {
            resolve(blob);
          }
        };

        if (recorder.state === 'inactive') {
          finalize();
          return;
        }
        recorder.onstop = finalize;
        recorder.onerror = () =>
          reject(new Error('Recording failed while finalizing audio.'));
        recorder.stop();
      });
    } else {
      const totalLen = this.pcmFallbackChunks.reduce((acc, c) => acc + c.length, 0);
      if (totalLen === 0) {
        this.cleanup();
        throw new Error('The recording is empty. Record some audio before stopping.');
      }
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const chunk of this.pcmFallbackChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      resultBlob = encodeWavBlob(merged, this.pcmSampleRate);
    }

    this.cleanup();
    return resultBlob;
  }

  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.cleanup();
  }

  private startMeterLoop(): void {
    const buffer = new Float32Array(this.analyser?.fftSize ?? 512);
    const tick = () => {
      if (!this.stream) return;
      if (!this.paused && this.analyser) {
        this.analyser.getFloatTimeDomainData(buffer);
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        // Scale speech RMS pleasantly to 0..1
        const level = Math.min(1, rms * 4.2);
        this.callbacks.onLevel?.(level);

        const elapsedSec = (this.accumulatedMs + (performance.now() - this.startTimeMs)) / 1000;
        this.callbacks.onDuration?.(elapsedSec);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private cleanup(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.liveProcessor) {
      this.liveProcessor.onaudioprocess = null;
      this.liveProcessor.disconnect();
      this.liveProcessor = null;
    }
    if (this.liveSink) {
      this.liveSink.disconnect();
      this.liveSink = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
    this.analyser = null;
    this.mediaRecorder = null;
    this.paused = false;
    this.callbacks.onLevel?.(0);
  }
}
