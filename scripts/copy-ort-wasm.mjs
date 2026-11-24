#!/usr/bin/env node
/**
 * Copies ONNX Runtime Web WASM & JS factory binaries from node_modules into
 * public/ort/ so Saltify Web runs 100% self-hosted with zero CDN requests
 * (no calls to cdn.jsdelivr.net).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(rootDir, 'node_modules', 'onnxruntime-web', 'dist');
const destDir = path.join(rootDir, 'public', 'ort');

const COMPACT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

const LARGE_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

const includeLarge =
  process.argv.includes('--all') || process.env.SALTIFY_SELF_HOSTED_ORT === '1';
const FILES = includeLarge
  ? [...COMPACT_FILES, ...LARGE_FILES]
  : COMPACT_FILES;

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-ort-wasm] onnxruntime-web/dist not found — skipping.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

// Remove >25 MiB ORT binaries when building for static hosts like Cloudflare Workers
let removed = 0;
if (!includeLarge) {
  for (const file of LARGE_FILES) {
    const target = path.join(destDir, file);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed += 1;
    }
  }
}

let copied = 0;
for (const file of FILES) {
  const from = path.join(srcDir, file);
  const to = path.join(destDir, file);
  if (!fs.existsSync(from)) continue;

  const srcStat = fs.statSync(from);
  const needsCopy =
    !fs.existsSync(to) || fs.statSync(to).size !== srcStat.size;

  if (needsCopy) {
    fs.copyFileSync(from, to);
    copied += 1;
  }
}

console.log(
  `[copy-ort-wasm] ONNX Runtime assets ready in public/ort/ (${
    includeLarge ? 'full self-hosted' : 'compact <25 MiB'
  }, ${copied} updated${removed > 0 ? `, ${removed} oversized removed` : ''}).`
);
