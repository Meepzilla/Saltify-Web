import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendErrorLog,
  clearErrorLogs,
  formatDiagnosticsReport,
  loadErrorLogs,
  resetErrorLogMemoryCache,
  subscribeErrorLogs,
} from '../errorLog';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('on-device error log system', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetErrorLogMemoryCache();
  });

  afterEach(() => {
    resetErrorLogMemoryCache();
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  it('appends, persists, notifies subscribers, and clears log entries', () => {
    const listener = vi.fn();
    const unsub = subscribeErrorLogs(listener);

    expect(loadErrorLogs()).toEqual([]);

    const entry = appendErrorLog({
      level: 'error',
      source: 'Whisper',
      title: 'Model load failed',
      message: 'Unexpected token <',
      context: { model: 'whisper-tiny.en', source: 'auto' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadErrorLogs()).toHaveLength(1);
    expect(loadErrorLogs()[0].id).toBe(entry.id);

    // Reload from localStorage directly
    resetErrorLogMemoryCache();
    const reloaded = loadErrorLogs();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].title).toBe('Model load failed');
    expect(reloaded[0].context?.model).toBe('whisper-tiny.en');

    clearErrorLogs();
    expect(loadErrorLogs()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('caps stored log entries at 100 newest items', () => {
    for (let i = 0; i < 115; i += 1) {
      appendErrorLog({
        level: 'warning',
        source: 'Test',
        title: `Entry ${i}`,
        message: `Message ${i}`,
      });
    }
    const all = loadErrorLogs();
    expect(all).toHaveLength(100);
    expect(all[0].title).toBe('Entry 114');
    expect(all[99].title).toBe('Entry 15');
  });

  it('formats a readable diagnostics report including runtime metadata', () => {
    const entry = appendErrorLog({
      level: 'error',
      source: 'App',
      title: 'Model load failed',
      message: 'Network timeout',
      details: 'Error: timeout at worker.ts:42',
      context: { device: 'wasm' },
    });

    const report = formatDiagnosticsReport([entry], {
      appVersion: '1.3.1',
      isOnline: true,
      isStandalone: false,
      modelId: 'onnx-community/whisper-tiny.en',
      modelSource: 'auto',
      device: 'auto',
      customModelBaseUrl: '',
      userAgent: 'TestBrowser/1.0',
      url: 'https://saltify-web.devinllewis-git.workers.dev/',
    });

    expect(report).toContain('Version: v1.3.1');
    expect(report).toContain('[ERROR] [App] Model load failed');
    expect(report).toContain('Message: Network timeout');
    expect(report).toContain('Context: device=wasm');
    expect(report).toContain('Details: Error: timeout at worker.ts:42');
  });
});
