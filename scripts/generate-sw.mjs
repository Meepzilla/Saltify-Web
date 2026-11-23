import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const distDir = path.resolve('dist');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

const precacheUrls = new Set([
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
]);

function collectFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.vite') continue;
      collectFiles(full, rel);
    } else if (
      entry.name !== 'sw.js' &&
      !entry.name.endsWith('.map') &&
      !entry.name.endsWith('.wasm') &&
      !entry.name.includes('whisper.worker')
    ) {
      precacheUrls.add(`./${rel}`);
    }
  }
}

collectFiles(distDir);

if (fs.existsSync(manifestPath)) {
  const viteManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const item of Object.values(viteManifest)) {
    if (item && typeof item === 'object') {
      if (item.file && !item.file.endsWith('.wasm') && !item.file.includes('whisper.worker')) {
        precacheUrls.add(`./${item.file}`);
      }
      if (Array.isArray(item.css)) {
        for (const cssFile of item.css) precacheUrls.add(`./${cssFile}`);
      }
      if (Array.isArray(item.assets)) {
        for (const assetFile of item.assets) {
          if (!assetFile.endsWith('.wasm')) precacheUrls.add(`./${assetFile}`);
        }
      }
    }
  }
}

const urlList = Array.from(precacheUrls).sort();
const hash = crypto
  .createHash('sha256')
  .update(urlList.join('\n') + Date.now().toString())
  .digest('hex')
  .slice(0, 12);

const swContent = `/* Saltify Web Service Worker — Auto-generated for offline PWA support */
const APP_CACHE = 'saltify-app-${hash}';
const LEGACY_MODEL_CACHE = 'saltify-whisper-models-v1';
const FONT_CACHE = 'saltify-fonts-v1';

const PRECACHE_URLS = ${JSON.stringify(urlList, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              (key.startsWith('saltify-app-') && key !== APP_CACHE) ||
              key === LEGACY_MODEL_CACHE
          )
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Do NOT intercept Hugging Face / ONNX CDN requests in the Service Worker:
  // @huggingface/transformers caches models & WASM binaries natively in 'transformers-cache'.
  // Intercepting 150-240 MB streams with response.clone() doubles RAM & storage usage and
  // causes Safari Service Worker timeouts / Jetsam reloads on iPads.
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('hf.co') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    return;
  }

  // Stale-while-revalidate for Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((response) => {
            if (response.ok) cache.put(req, response.clone()).catch(() => {});
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Same-origin app shell & assets: Cache-first for hashed assets, Network-first for navigation
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(
        fetch(req)
          .then((response) => {
            if (response.ok) {
              caches.open(APP_CACHE).then((cache) => cache.put(req, response.clone())).catch(() => {});
            }
            return response;
          })
          .catch(async () => {
            const cache = await caches.open(APP_CACHE);
            return (await cache.match('./index.html')) || (await cache.match('./'));
          })
      );
      return;
    }

    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response.ok) {
            caches.open(APP_CACHE).then((cache) => cache.put(req, response.clone())).catch(() => {});
          }
          return response;
        });
      })
    );
  }
});
`;

fs.writeFileSync(path.join(distDir, 'sw.js'), swContent, 'utf8');
console.log(`Generated dist/sw.js precaching ${urlList.length} assets (cache ${hash})`);
