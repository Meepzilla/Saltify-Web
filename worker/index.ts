import { handleTranscribe, type TranscribeEnv } from './transcribe';

interface Env extends TranscribeEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/**
 * Saltify Web Worker: serves the static PWA (dist/) and, only under /api/transcribe, the optional
 * cloud transcription endpoint. Everything else goes straight to the static assets.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/transcribe' || pathname === '/api/transcribe/status') {
      return handleTranscribe(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
