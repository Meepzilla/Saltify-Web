#!/usr/bin/env node
/**
 * Downloads quantized Whisper ONNX models from Hugging Face into public/models/
 * so your self-hosted Saltify Web server can serve models over your LAN/domain
 * with ZERO outbound internet access from client devices (Android, Windows, iPad).
 *
 * Usage:
 *   npm run models:download                     # downloads tiny + base (~112 MB)
 *   npm run models:download -- --all            # downloads tiny + base + small (~350 MB)
 *   npm run models:download -- --models=tiny    # downloads only whisper-tiny.en (~39 MB)
 *   npm run models:download -- --models=tiny,base --webgpu  # also fetch WebGPU fp32/q4 weights
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsRoot = path.join(rootDir, 'public', 'models');

const MODEL_MAP = {
  tiny: 'onnx-community/whisper-tiny.en',
  base: 'onnx-community/whisper-base.en',
  small: 'onnx-community/whisper-small.en',
};

const REQUIRED_ROOT_FILES = [
  'added_tokens.json',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'normalizer.json',
  'preprocessor_config.json',
  'quantize_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
];

const WASM_Q8_FILES = [
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

const WEBGPU_FILES = [
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
];

function parseArgs(argv) {
  let selected = ['tiny', 'base'];
  let includeWebGpu = false;
  let force = false;

  for (const arg of argv) {
    if (arg === '--all') {
      selected = ['tiny', 'base', 'small'];
    } else if (arg === '--webgpu') {
      includeWebGpu = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--models=')) {
      selected = arg
        .slice('--models='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Saltify Web — Self-Hosted Whisper Model Downloader

Usage:
  npm run models:download                       Download tiny.en + base.en (default, ~112 MB)
  npm run models:download -- --all              Download tiny.en + base.en + small.en (~350 MB)
  npm run models:download -- --models=tiny      Download specific models (comma-separated: tiny,base,small)
  npm run models:download -- --webgpu           Also download larger fp32/q4 weights for WebGPU acceleration
  npm run models:download -- --force            Re-download existing files
`);
      process.exit(0);
    }
  }

  for (const key of selected) {
    if (!MODEL_MAP[key]) {
      console.error(`Unknown model "${key}". Valid choices: tiny, base, small.`);
      process.exit(1);
    }
  }

  return { selected, includeWebGpu, force };
}

async function downloadFile(url, destPath, force) {
  if (!force && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return { skipped: true, bytes: fs.statSync(destPath).size };
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.part`;

  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Saltify-Web-Model-Downloader/1.0' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }

  const outStream = fs.createWriteStream(tmpPath);
  await finished(Readable.fromWeb(response.body).pipe(outStream));
  fs.renameSync(tmpPath, destPath);

  return { skipped: false, bytes: fs.statSync(destPath).size };
}

function rebuildManifest() {
  const available = [];

  for (const repoId of Object.values(MODEL_MAP)) {
    const dir = path.join(modelsRoot, ...repoId.split('/'));
    const hasConfig = fs.existsSync(path.join(dir, 'config.json'));
    const hasWasmQ8 =
      fs.existsSync(path.join(dir, 'onnx', 'encoder_model_quantized.onnx')) &&
      fs.existsSync(path.join(dir, 'onnx', 'decoder_model_merged_quantized.onnx'));
    const hasWebGpu =
      fs.existsSync(path.join(dir, 'onnx', 'encoder_model.onnx')) &&
      fs.existsSync(path.join(dir, 'onnx', 'decoder_model_merged_q4.onnx'));

    if (hasConfig && (hasWasmQ8 || hasWebGpu)) {
      available.push({
        id: repoId,
        wasmQ8: hasWasmQ8,
        webgpu: hasWebGpu,
      });
    }
  }

  fs.mkdirSync(modelsRoot, { recursive: true });
  const manifestPath = path.join(modelsRoot, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        models: available,
      },
      null,
      2
    ) + '\n'
  );
  return available;
}

async function main() {
  const { selected, includeWebGpu, force } = parseArgs(process.argv.slice(2));
  const filesToFetch = [
    ...REQUIRED_ROOT_FILES,
    ...WASM_Q8_FILES,
    ...(includeWebGpu ? WEBGPU_FILES : []),
  ];

  console.log(
    `\nDownloading self-hosted Whisper models: ${selected.join(', ')}${
      includeWebGpu ? ' (+ WebGPU weights)' : ' (universal q8 WASM)'
    }\nDestination: ${modelsRoot}\n`
  );

  for (const key of selected) {
    const repoId = MODEL_MAP[key];
    console.log(`==> ${repoId}`);
    let modelBytes = 0;

    for (const relPath of filesToFetch) {
      const url = `https://huggingface.co/${repoId}/resolve/main/${relPath}`;
      const destPath = path.join(modelsRoot, ...repoId.split('/'), relPath);
      const label = relPath.padEnd(44, ' ');
      process.stdout.write(`  - ${label}`);

      const res = await downloadFile(url, destPath, force);
      modelBytes += res.bytes;
      const mb = (res.bytes / (1024 * 1024)).toFixed(2);
      console.log(res.skipped ? ` [cached ${mb} MB]` : ` [saved ${mb} MB]`);
    }

    console.log(
      `  ✓ ${repoId} ready (${(modelBytes / (1024 * 1024)).toFixed(1)} MB total)\n`
    );
  }

  const manifestModels = rebuildManifest();
  console.log(
    `Updated public/models/manifest.json with ${manifestModels.length} self-hosted model(s):`
  );
  for (const m of manifestModels) {
    console.log(
      `  • ${m.id} (WASM q8: ${m.wasmQ8 ? 'yes' : 'no'}, WebGPU: ${m.webgpu ? 'yes' : 'no'})`
    );
  }
  console.log('\nNext step: run `npm run build` or `docker compose up -d` to serve Saltify Web locally.\n');
}

main().catch((err) => {
  console.error('\nModel download failed:', err.message);
  process.exit(1);
});
