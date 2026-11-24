import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

const CLOUDFLARE_MAX_ASSET_BYTES = 25 * 1024 * 1024;

/**
 * Transformers.js contains a fallback `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)`
 * that causes Vite to emit a duplicate 25.6 MiB WASM asset into `dist/assets/`.
 * Because `whisper.worker.ts` always sets `env.backends.onnx.wasm.wasmPaths` explicitly,
 * that emitted asset is unused and breaks Cloudflare Workers' 25 MiB per-file static asset limit.
 */
function stripOversizedOrtWasmAsset(): Plugin {
  return {
    name: 'strip-oversized-ort-wasm-asset',
    generateBundle(_options, bundle) {
      if (process.env.SALTIFY_SELF_HOSTED_ORT === '1') return;
      for (const [fileName, item] of Object.entries(bundle)) {
        if (
          item.type === 'asset' &&
          /ort-wasm-.*\.wasm$/i.test(fileName) &&
          item.source.length >= CLOUDFLARE_MAX_ASSET_BYTES
        ) {
          delete bundle[fileName];
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    stripOversizedOrtWasmAsset(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icons/apple-touch-icon-180.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
      ],
      manifest: {
        name: 'Saltify — On-Device SALT Speech Transcription',
        short_name: 'Saltify',
        description:
          'Privacy-focused, 100% on-device PWA for recording, transcribing, and analyzing child language samples with SALT conventions.',
        theme_color: '#0D6E8A',
        background_color: '#F6F7F9',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['medical', 'education', 'productivity', 'utilities'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude large self-hosted models & ORT WASM from initial SW precache;
        // Transformers.js caches them on demand in `transformers-cache`.
        globIgnores: ['models/**', 'ort/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/\/models\//, /\/ort\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'es2022',
  },
});
