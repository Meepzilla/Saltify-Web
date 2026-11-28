import { dropInventedUtterances } from '../engine/hallucinationGuard';
import { LiveSegmenter } from '../engine/liveSegmenter';
import { autoAssignSpeakersInTranscript } from '../engine/speakerDiarizer';
import { formatTimestamp } from '../engine/transcriptFormat';
import type { WordConfidenceMap } from '../engine/wordConfidence';
import type { SpeakerAliases } from '../types/saltify';
import type { WhisperWorkerClient } from './whisperClient';

type RuntimeOptions = Parameters<WhisperWorkerClient['transcribeRaw']>[1];

interface LiveUtterance {
  startSec: number;
  endSec: number;
  text: string;
}

export interface LiveTranscriptResult {
  transcript: string;
  wordConfidence?: WordConfidenceMap;
  speakerCount: 1 | 2;
  /** Seconds between Stop and the finished transcript. */
  finishSec: number;
}

/**
 * Transcribes while recording: audio is cut into segments at natural pauses (LiveSegmenter) and
 * each segment goes through the normal on-device pipeline in the background, one at a time.
 * When recording stops only the last few seconds remain; speakers are then labeled once over the
 * whole recording, exactly as after a normal transcription.
 */
export class LiveTranscriber {
  private readonly segmenter = new LiveSegmenter();
  private queue: Array<{ startSec: number; samples: Float32Array }> = [];
  private busy = false;
  private stopped = false;
  private failed: unknown = null;
  private utterances: LiveUtterance[] = [];
  private confidence: WordConfidenceMap = {};
  private idleWaiters: Array<() => void> = [];
  private cancelled = false;
  private readonly client: WhisperWorkerClient;
  private readonly options: RuntimeOptions;
  private readonly onUpdate: (transcriptWithoutSpeakers: string, lineCount: number) => void;

  constructor(
    client: WhisperWorkerClient,
    options: RuntimeOptions,
    onUpdate: (transcriptWithoutSpeakers: string, lineCount: number) => void
  ) {
    this.client = client;
    this.options = options;
    this.onUpdate = onUpdate;
  }

  /** Live 16 kHz audio from the recorder. */
  push(samples: Float32Array): void {
    if (this.stopped || this.failed) return;
    this.segmenter.push(samples);
    for (let seg = this.segmenter.next(); seg; seg = this.segmenter.next()) this.queue.push(seg);
    this.pump();
  }

  get hasFailed(): boolean {
    return this.failed !== null;
  }

  /** Seconds of audio waiting to be transcribed (for "catching up" status). */
  get backlogSec(): number {
    return this.queue.reduce((n, s) => n + s.samples.length / 16000, 0);
  }

  /** Stop listening and stop transcribing; results are discarded. */
  cancel(): void {
    this.stopped = true;
    this.cancelled = true;
    this.queue = [];
    if (this.busy) this.client.cancel();
  }

  /**
   * Recording stopped: transcribe what is left, wait for the queue, label speakers over the
   * whole recording and return the finished transcript.
   */
  async finish(
    aliases: SpeakerAliases,
    onProgress?: (stage: string, progress: number, detail?: string) => void
  ): Promise<LiveTranscriptResult> {
    const stoppedAt = Date.now();
    const last = this.segmenter.next(true);
    if (last) this.queue.push(last);
    this.stopped = true;
    const total = this.backlogSec + (this.busy ? 1 : 0);
    const progressTimer = setInterval(() => {
      const left = this.backlogSec;
      onProgress?.(
        'Finishing the transcript',
        Math.min(0.95, 0.2 + 0.75 * (1 - left / Math.max(1, total))),
        `Most of the recording was transcribed while you recorded${left > 0 ? ` · ${Math.round(left)} s of audio left` : ''}`
      );
    }, 700);
    try {
      this.pump();
      await this.idle();
      if (this.failed) throw this.failed;
      const audio = this.segmenter.allAudio();
      const kept = dropInventedUtterances(this.utterances, audio, 16000);
      const transcript = kept.map((u) => `[${formatTimestamp(u.startSec)}] ${u.text}`).join('\n');
      onProgress?.('Assigning speakers locally', 0.97);
      await new Promise((r) => setTimeout(r, 0));
      const diarized = autoAssignSpeakersInTranscript(transcript, aliases, audio, 16000, {
        mode: 'auto',
        exactSegments: kept,
      });
      return {
        transcript: diarized.transcript,
        wordConfidence: Object.keys(this.confidence).length ? this.confidence : undefined,
        speakerCount: diarized.speakerCount,
        finishSec: (Date.now() - stoppedAt) / 1000,
      };
    } finally {
      clearInterval(progressTimer);
    }
  }

  private pump(): void {
    if (this.busy || this.failed) return;
    const seg = this.queue.shift();
    if (!seg) {
      for (const w of this.idleWaiters.splice(0)) w();
      return;
    }
    this.busy = true;
    this.client
      .transcribeRaw(seg.samples, this.options)
      .then((res) => {
        for (const u of res.utterances ?? []) {
          this.utterances.push({ startSec: u.startSec + seg.startSec, endSec: u.endSec + seg.startSec, text: u.text });
        }
        for (const [key, entries] of Object.entries(res.wordConfidence ?? {})) {
          this.confidence[key] = [...(this.confidence[key] ?? []), ...entries];
        }
        this.onUpdate(
          this.utterances.map((u) => `[${formatTimestamp(u.startSec)}] ${u.text}`).join('\n'),
          this.utterances.length
        );
      })
      .catch((err) => {
        if (!this.cancelled) this.failed = err;
      })
      .finally(() => {
        this.busy = false;
        if (this.failed) {
          for (const w of this.idleWaiters.splice(0)) w();
          return;
        }
        this.pump();
      });
  }

  private idle(): Promise<void> {
    if (!this.busy && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}
