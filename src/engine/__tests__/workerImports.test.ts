import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Safari's Web Worker stack is small: evaluating the multi-MB wink-lexicon / wink-pos-tagger
 * CommonJS data modules inside the Whisper worker throws
 * "RangeError: Maximum call stack size exceeded" before any model code runs (iPad).
 * Guard the worker's import graph so those packages never get bundled into it again.
 */
const FORBIDDEN = [/^wink-/, /childGrammarEngine/, /speakerDiarizer/, /grammarSession/];

const here = dirname(fileURLToPath(import.meta.url));
const workerEntry = resolve(here, '../../workers/whisper.worker.ts');

function resolveLocal(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

function collectImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const specs = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    // Runtime imports only (`import type` is erased at build time)
    const re = /^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2];
      specs.add(spec);
      if (spec.startsWith('.')) {
        const next = resolveLocal(file, spec);
        if (next) stack.push(next);
      }
    }
  }
  return specs;
}

describe('whisper worker import graph', () => {
  it('does not pull wink grammar modules into the Web Worker', () => {
    const specs = [...collectImports(workerEntry)];
    const offending = specs.filter((s) => FORBIDDEN.some((re) => re.test(s)));
    expect(offending).toEqual([]);
  });
});
