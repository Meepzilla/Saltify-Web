import { afterEach, describe, expect, it } from 'vitest';
import { isHtmlCacheResponse, purgeHtmlModelCacheEntries } from '../modelCache';

function createFakeCacheStorage(entries: Record<string, Response>) {
  const store = new Map<string, Response>(Object.entries(entries));
  const cache = {
    async keys() {
      return [...store.keys()].map((url) => new Request(url));
    },
    async match(req: Request) {
      return store.get(req.url);
    },
    async delete(req: Request) {
      return store.delete(req.url);
    },
  };
  return {
    store,
    storage: {
      async keys() {
        return ['transformers-cache'];
      },
      async open() {
        return cache;
      },
    },
  };
}

describe('modelCache', () => {
  const originalCaches = (globalThis as { caches?: unknown }).caches;

  afterEach(() => {
    (globalThis as { caches?: unknown }).caches = originalCaches;
  });

  it('detects HTML responses', () => {
    expect(
      isHtmlCacheResponse(
        new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
      )
    ).toBe(true);
    expect(
      isHtmlCacheResponse(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    ).toBe(false);
    expect(isHtmlCacheResponse(undefined)).toBe(false);
  });

  it('removes SPA index.html fallbacks and keeps real model files', async () => {
    const htmlUrl = 'https://app.example/models/onnx-community/whisper-tiny.en/config.json';
    const jsonUrl =
      'https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/config.json';
    const { store, storage } = createFakeCacheStorage({
      [htmlUrl]: new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
      [jsonUrl]: new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    (globalThis as { caches?: unknown }).caches = storage;

    const removed = await purgeHtmlModelCacheEntries();

    expect(removed).toBe(1);
    expect(store.has(htmlUrl)).toBe(false);
    expect(store.has(jsonUrl)).toBe(true);
  });
});
