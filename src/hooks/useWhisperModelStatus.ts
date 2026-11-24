import { useCallback, useEffect, useState } from 'react';
import {
  clearCachedWhisperModels,
  inspectCachedWhisperModels,
} from '../engine/storage';
import type { ProcessingState } from '../types/saltify';

interface SelfHostedManifest {
  models?: Array<{
    id: string;
    wasmQ8: boolean;
    webgpu: boolean;
  }>;
}

export interface WhisperModelStatus {
  cachedModels: string[];
  cacheBytes: number;
  selfHostedModels: string[];
  refresh: () => Promise<void>;
  clearCache: () => Promise<boolean>;
}

/**
 * Inspects local browser Cache Storage for offline Whisper models and probes the
 * configured self-hosted manifest. Shared by SettingsPage and ModelManagerModal.
 */
export function useWhisperModelStatus(
  active: boolean,
  customModelBaseUrl: string,
  processing: ProcessingState | null
): WhisperModelStatus {
  const [cachedModels, setCachedModels] = useState<string[]>([]);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [selfHostedModels, setSelfHostedModels] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const info = await inspectCachedWhisperModels();
    setCachedModels(info.cachedModelIds);
    setCacheBytes(info.estimatedBytes);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void inspectCachedWhisperModels().then((info) => {
      if (cancelled) return;
      setCachedModels(info.cachedModelIds);
      setCacheBytes(info.estimatedBytes);
    });

    const base = customModelBaseUrl.trim()
      ? customModelBaseUrl.trim().replace(/\/?$/, '/')
      : './models/';

    void fetch(`${base}manifest.json`, { cache: 'no-cache' })
      .then(async (resp) => {
        if (!resp.ok) return [];
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('json')) return [];
        const data = (await resp.json()) as SelfHostedManifest;
        return (data.models ?? []).map((m) => m.id);
      })
      .catch(() => [] as string[])
      .then((ids) => {
        if (!cancelled) setSelfHostedModels(ids);
      });

    return () => {
      cancelled = true;
    };
  }, [active, processing, customModelBaseUrl]);

  const clearCache = useCallback(async (): Promise<boolean> => {
    if (
      !window.confirm(
        'Remove cached on-device Whisper models from browser storage? You can re-download them anytime from your server or Wi-Fi.'
      )
    ) {
      return false;
    }
    await clearCachedWhisperModels();
    await refresh();
    return true;
  }, [refresh]);

  return {
    cachedModels,
    cacheBytes,
    selfHostedModels,
    refresh,
    clearCache,
  };
}
