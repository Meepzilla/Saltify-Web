import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../types/saltify';
import {
  loadAppSettings,
  resetAppSettings,
  saveAppSettings,
} from '../storage';

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

describe('app settings storage', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  it('returns default settings when storage is empty', () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('hydrates legacy saved settings missing defaultSpeakerAliases safely', () => {
    globalThis.localStorage.setItem(
      'saltify-web-settings-v1',
      JSON.stringify({
        theme: 'dark',
        playbackVolume: 2.5,
        codeFillerMazes: false,
      })
    );

    const loaded = loadAppSettings();
    expect(loaded.theme).toBe('dark');
    expect(loaded.playbackVolume).toBe(2.5);
    expect(loaded.codeFillerMazes).toBe(false);
    expect(loaded.defaultSpeakerAliases).toEqual({ speaker1: 'C', speaker2: 'E' });
  });

  it('sanitizes empty default speaker aliases back to C and E', () => {
    saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      defaultSpeakerAliases: { speaker1: '   ', speaker2: 'SLP' },
    });

    const loaded = loadAppSettings();
    expect(loaded.defaultSpeakerAliases).toEqual({ speaker1: 'C', speaker2: 'SLP' });
  });

  it('resets settings back to factory defaults', () => {
    saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      theme: 'dark',
      playbackVolume: 3.5,
      useOverregularizationTag: true,
      defaultSpeakerAliases: { speaker1: 'CHI', speaker2: 'EXA' },
    });

    const restored = resetAppSettings();
    expect(restored).toEqual(DEFAULT_APP_SETTINGS);
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});
