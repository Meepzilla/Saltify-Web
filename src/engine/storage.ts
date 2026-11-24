import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type SessionRecord,
} from '../types/saltify';
import { isHtmlCacheResponse } from './modelCache';

const DB_NAME = 'saltify-web-db';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_AUDIO = 'audioBlobs';
const SETTINGS_KEY = 'saltify-web-settings-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open local IndexedDB storage.'));
  });
}

export async function loadAllSessions(): Promise<SessionRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as SessionRecord[]) ?? [];
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveSessionRecord(session: SessionRecord): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(sessionId);
    tx.objectStore(STORE_AUDIO).delete(sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAudioBlob(sessionId: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).put(blob, sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAudioBlob(sessionId: string): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const req = tx.objectStore(STORE_AUDIO).get(sessionId);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_APP_SETTINGS,
        defaultSpeakerAliases: { ...DEFAULT_APP_SETTINGS.defaultSpeakerAliases },
      };
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const speaker1 = parsed.defaultSpeakerAliases?.speaker1?.trim();
    const speaker2 = parsed.defaultSpeakerAliases?.speaker2?.trim();
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      defaultSpeakerAliases: {
        speaker1: speaker1 || DEFAULT_APP_SETTINGS.defaultSpeakerAliases.speaker1,
        speaker2: speaker2 || DEFAULT_APP_SETTINGS.defaultSpeakerAliases.speaker2,
      },
    };
  } catch {
    return {
      ...DEFAULT_APP_SETTINGS,
      defaultSpeakerAliases: { ...DEFAULT_APP_SETTINGS.defaultSpeakerAliases },
    };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore private browsing quota errors
  }
}

export function resetAppSettings(): AppSettings {
  const defaults: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    defaultSpeakerAliases: { ...DEFAULT_APP_SETTINGS.defaultSpeakerAliases },
  };
  saveAppSettings(defaults);
  return defaults;
}

export async function estimateLocalStorageUsage(): Promise<{
  usageBytes: number | null;
  quotaBytes: number | null;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null };
  }
  try {
    const est = await navigator.storage.estimate();
    return {
      usageBytes: typeof est.usage === 'number' ? est.usage : null,
      quotaBytes: typeof est.quota === 'number' ? est.quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

/**
 * Inspects browser Cache Storage for cached Hugging Face Transformers.js Whisper models.
 */
export async function inspectCachedWhisperModels(): Promise<{
  cacheNames: string[];
  estimatedBytes: number;
  cachedModelIds: string[];
}> {
  if (typeof caches === 'undefined') {
    return { cacheNames: [], estimatedBytes: 0, cachedModelIds: [] };
  }

  try {
    const names = await caches.keys();
    const transformerCaches = names.filter((n) => n.includes('transformers'));
    const modelIds = new Set<string>();
    let totalBytes = 0;

    for (const name of transformerCaches) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const req of requests) {
        const resp = await cache.match(req);
        // Skip SPA index.html fallbacks cached by older builds — they are not model files.
        if (isHtmlCacheResponse(resp)) continue;

        const url = req.url;
        if (url.includes('whisper-tiny.en')) modelIds.add('onnx-community/whisper-tiny.en');
        if (url.includes('whisper-base.en')) modelIds.add('onnx-community/whisper-base.en');
        if (url.includes('whisper-small.en')) modelIds.add('onnx-community/whisper-small.en');

        const len = resp?.headers.get('content-length');
        if (len) {
          totalBytes += parseInt(len, 10) || 0;
        }
      }
    }

    return {
      cacheNames: transformerCaches,
      estimatedBytes: totalBytes,
      cachedModelIds: [...modelIds],
    };
  } catch {
    return { cacheNames: [], estimatedBytes: 0, cachedModelIds: [] };
  }
}

export async function clearCachedWhisperModels(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  for (const name of names) {
    if (name.includes('transformers')) {
      await caches.delete(name);
    }
  }
}
