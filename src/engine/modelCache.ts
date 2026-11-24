/**
 * Helpers for the Transformers.js browser Cache Storage (`transformers-cache`).
 *
 * Background: on SPA hosts (e.g. Cloudflare Workers with
 * `not_found_handling: "single-page-application"`), a request for a missing
 * `/models/<id>/config.json` returns HTTP 200 with `index.html`. Earlier builds
 * let Transformers.js fetch that path, and it cached the HTML response under the
 * local-path key. Transformers.js always checks the cache by local path first —
 * even when `env.allowLocalModels = false` — so that poisoned entry keeps
 * producing `Unexpected token '<', "<!doctype "... is not valid JSON` until it
 * is removed.
 */

export function isHtmlCacheResponse(resp: Response | undefined | null): boolean {
  if (!resp) return false;
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/html');
}

/**
 * Deletes any HTML responses (SPA fallbacks) stored in Transformers.js caches.
 * Returns the number of entries removed. Never throws.
 */
export async function purgeHtmlModelCacheEntries(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let removed = 0;
  try {
    const names = await caches.keys();
    for (const name of names) {
      if (!name.includes('transformers')) continue;
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const req of requests) {
        const resp = await cache.match(req);
        if (isHtmlCacheResponse(resp)) {
          await cache.delete(req);
          removed += 1;
        }
      }
    }
  } catch {
    // Cache Storage may be unavailable (private mode, blocked storage) — ignore.
  }
  return removed;
}
