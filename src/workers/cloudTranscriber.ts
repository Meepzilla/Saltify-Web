/**
 * Optional cloud transcription: sends speech-first windows to this site's /api/transcribe
 * (Cloudflare Workers AI, Whisper Large v3 Turbo) and assembles the result exactly like the
 * on-device pipeline (cleanup, utterance timing, invented-phrase removal).
 */
import { encodeWavBlob } from '../engine/audioProcessing';
import { collapseRepetitions, dropInventedUtterances, dropSilentChunks } from '../engine/hallucinationGuard';
import { buildSpeechSlices } from '../engine/speechChunking';
import { extractWhisperUtterances } from '../engine/transcriptFormat';
import { buildWordConfidenceMap, STORE_CONFIDENCE_BELOW, type WordProbability } from '../engine/wordConfidence';

export interface CloudSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

export interface CloudRawResult {
  transcript: string;
  utterances: Array<{ startSec: number; endSec: number; timestampStr?: string; text: string }>;
  wordConfidence?: ReturnType<typeof buildWordConfidenceMap>;
  backendUsed: 'cloud';
}

export class CloudTranscriptionError extends Error {}

const CONCURRENCY = 3;

async function wavBase64(samples: Float32Array): Promise<string> {
  const bytes = new Uint8Array(await encodeWavBlob(samples, 16000).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function explain(status: number, message: string): string {
  if (status === 401) return 'Cloud transcription: the access key in Settings → Cloud Transcription does not match the server.';
  if (status === 503) return 'Cloud transcription is not set up on the server yet (add the CLOUD_TRANSCRIBE_KEY secret in Cloudflare).';
  if (status === 404) return 'Cloud transcription is not available on this server (it needs the Saltify Worker deployed with Workers AI).';
  return `Cloud transcription failed (${status}): ${message}`;
}

/**
 * Transcribes 16 kHz audio in the cloud. Segments with a low average log-probability are given a
 * matching per-word confidence, so uncertain stretches are still flagged for review.
 */
export async function cloudTranscribeRaw(
  audio16k: Float32Array,
  options: { accessKey: string; vocabulary?: string; signal?: AbortSignal; endpoint?: string },
  onProgress?: (stage: string, progress: number, detail?: string) => void
): Promise<CloudRawResult> {
  if (!options.accessKey.trim()) {
    throw new CloudTranscriptionError('Cloud transcription needs the access key: Settings → Cloud Transcription.');
  }
  const slices = buildSpeechSlices(audio16k, 16000, 28);
  const regions = slices.flatMap((s) => s.pieces.map((p) => ({ start: p.srcStart, end: p.srcEnd })));
  const perSlice: Array<{ chunks: Array<{ timestamp: [number, number | null]; text: string }>; words: WordProbability[] }> =
    slices.map(() => ({ chunks: [], words: [] }));
  let done = 0;
  const started = Date.now();

  const runOne = async (i: number) => {
    const slice = slices[i];
    const res = await fetch(options.endpoint ?? '/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-saltify-key': options.accessKey.trim() },
      body: JSON.stringify({ audio: await wavBase64(slice.samples), prompt: options.vocabulary ?? '' }),
      signal: options.signal,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // keep statusText
      }
      throw new CloudTranscriptionError(explain(res.status, message));
    }
    const data = (await res.json()) as { text?: string; segments?: CloudSegment[] };
    const segments = data.segments?.length
      ? data.segments
      : data.text?.trim()
        ? [{ start: 0, end: slice.samples.length / 16000, text: data.text }]
        : [];
    for (const seg of segments) {
      if ((seg.no_speech_prob ?? 0) > 0.8 && (seg.avg_logprob ?? 0) < -1) continue; // silence/noise
      perSlice[i].chunks.push({ timestamp: [slice.toSource(seg.start), slice.toSource(seg.end)], text: seg.text });
      const p = Math.min(0.99, Math.exp(seg.avg_logprob ?? 0));
      for (const w of seg.text.trim().split(/\s+/).filter(Boolean)) perSlice[i].words.push({ word: w, p });
    }
    done += 1;
    const elapsed = (Date.now() - started) / 1000;
    onProgress?.(
      `Cloud transcription: part ${done} of ${slices.length}`,
      0.1 + 0.85 * (done / slices.length),
      `Whisper Large v3 Turbo on Cloudflare · ${Math.round(elapsed)} s elapsed`
    );
  };

  onProgress?.('Sending speech to Cloudflare', 0.08, `${slices.length} part(s) · audio is not stored`);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, slices.length) }, async () => {
      while (next < slices.length) await runOne(next++);
    })
  );

  const chunks = perSlice.flatMap((s) => s.chunks).sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  const utterances = dropInventedUtterances(
    extractWhisperUtterances(dropSilentChunks(collapseRepetitions(chunks), audio16k, 16000), regions),
    audio16k,
    16000
  );
  const transcript = utterances.map((u) => `[${u.timestampStr}] ${u.text}`).join('\n');
  let wordConfidence: CloudRawResult['wordConfidence'];
  try {
    wordConfidence = buildWordConfidenceMap(transcript, perSlice.flatMap((s) => s.words), STORE_CONFIDENCE_BELOW);
  } catch {
    wordConfidence = undefined;
  }
  return { transcript, utterances, wordConfidence, backendUsed: 'cloud' };
}
