import { describe, expect, it } from 'vitest';
import { handleTranscribe } from './transcribe';

const post = (body: unknown, key?: string) =>
  new Request('https://app.example/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-saltify-key': key } : {}) },
    body: JSON.stringify(body),
  });

describe('cloud transcription endpoint', () => {
  const ai = {
    calls: [] as Array<Record<string, unknown>>,
    async run(_model: string, input: Record<string, unknown>) {
      this.calls.push(input);
      return { text: ' Hi there.', segments: [{ start: 0, end: 1.2, text: ' Hi there.', avg_logprob: -0.2, no_speech_prob: 0.01 }] };
    },
  };

  it('is off until the access key secret is set', async () => {
    const res = await handleTranscribe(post({ audio: 'AAAA' }, 'k'), { AI: ai });
    expect(res.status).toBe(503);
    const status = await handleTranscribe(new Request('https://app.example/api/transcribe/status'), { AI: ai });
    expect(await status.json()).toMatchObject({ enabled: false });
  });

  it('rejects a wrong or missing key', async () => {
    expect((await handleTranscribe(post({ audio: 'AAAA' }), { AI: ai, CLOUD_TRANSCRIBE_KEY: 'secret' })).status).toBe(401);
    expect((await handleTranscribe(post({ audio: 'AAAA' }, 'nope'), { AI: ai, CLOUD_TRANSCRIBE_KEY: 'secret' })).status).toBe(401);
  });

  it('transcribes with hallucination guards and the vocabulary prompt', async () => {
    const res = await handleTranscribe(post({ audio: 'AAAA', prompt: 'Elijah, dinosaur' }, 'secret'), {
      AI: ai,
      CLOUD_TRANSCRIBE_KEY: 'secret',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: ' Hi there.', segments: [{ start: 0, end: 1.2 }] });
    expect(ai.calls[ai.calls.length - 1]).toMatchObject({
      audio: 'AAAA',
      language: 'en',
      condition_on_previous_text: false,
      initial_prompt: 'Elijah, dinosaur',
    });
  });
});
