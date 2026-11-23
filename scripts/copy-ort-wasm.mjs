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

const FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-ort-wasm] onnxruntime-web/dist not found — skipping.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

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
  `[copy-ort-wasm] Self-hosted ONNX Runtime assets ready in public/ort/ (${copied} updated).`
);
