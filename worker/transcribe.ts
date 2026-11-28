/**
 * Optional cloud transcription on Cloudflare Workers AI (Whisper Large v3 Turbo).
 *
 * Off unless the CLOUD_TRANSCRIBE_KEY secret is set on the Worker; every request must carry that
 * key (x-saltify-key header), so nobody else can spend the account's Workers AI budget. Audio is
 * processed by Workers AI and not stored by this Worker.
 */

export const CLOUD_MODEL = '@cf/openai/whisper-large-v3-turbo';
/** Largest accepted request (base64 JSON). A 30 s 16 kHz WAV is ~1.3 MB as base64. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface TranscribeEnv {
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  CLOUD_TRANSCRIBE_KEY?: string;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Constant-time string comparison (does not leak how much of the key matched). */
function sameKey(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handleTranscribe(request: Request, env: TranscribeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/transcribe/status') {
    return json({ enabled: Boolean(env.CLOUD_TRANSCRIBE_KEY && env.AI), model: CLOUD_MODEL });
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.CLOUD_TRANSCRIBE_KEY || !env.AI) {
    return json(
      { error: 'Cloud transcription is not set up on this server (CLOUD_TRANSCRIBE_KEY secret or AI binding missing).' },
      503
    );
  }
  const key = request.headers.get('x-saltify-key') ?? '';
  if (!sameKey(key, env.CLOUD_TRANSCRIBE_KEY)) return json({ error: 'Wrong or missing access key.' }, 401);

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return json({ error: 'Audio segment too large.' }, 413);
  let body: { audio?: string; prompt?: string };
  try {
    body = (await request.json()) as { audio?: string; prompt?: string };
  } catch {
    return json({ error: 'Expected JSON { audio: base64 WAV, prompt?: string }.' }, 400);
  }
  if (typeof body.audio !== 'string' || body.audio.length === 0 || body.audio.length > MAX_BODY_BYTES) {
    return json({ error: 'Missing or oversized audio.' }, 400);
  }

  try {
    const result = (await env.AI.run(CLOUD_MODEL, {
      audio: body.audio,
      language: 'en',
      task: 'transcribe',
      // Guards against invented text over silence/noise and repetition loops
      condition_on_previous_text: false,
      no_speech_threshold: 0.6,
      compression_ratio_threshold: 2.4,
      hallucination_silence_threshold: 2,
      ...(typeof body.prompt === 'string' && body.prompt.trim() ? { initial_prompt: body.prompt.slice(0, 800) } : {}),
    })) as { text?: string; segments?: WhisperSegment[] };
    return json({
      text: result.text ?? '',
      segments: (result.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        avg_logprob: s.avg_logprob,
        no_speech_prob: s.no_speech_prob,
        words: s.words,
      })),
    });
  } catch (err) {
    return json({ error: `Workers AI failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
}
