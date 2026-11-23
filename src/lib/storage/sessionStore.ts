import type { SessionRecord, ThemePreference, WhisperModelId } from '../../types/session';

const DB_NAME = 'saltify-web-db';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const AUDIO_STORE = 'audioBlobs';

const THEME_KEY = 'saltify_theme';
const MODEL_KEY = 'saltify_whisper_model';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function loadAllSessions(): Promise<SessionRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise<SessionRecord[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readonly');
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => {
        const items = (req.result as SessionRecord[]) ?? [];
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveSessionRecord(session: SessionRecord): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readwrite');
      tx.objectStore(SESSIONS_STORE).put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal in private browsing contexts without IndexedDB
  }
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SESSIONS_STORE, AUDIO_STORE], 'readwrite');
      tx.objectStore(SESSIONS_STORE).delete(sessionId);
      tx.objectStore(AUDIO_STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

export async function saveSessionAudio(sessionId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).put(blob, sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

export async function loadSessionAudio(sessionId: string): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, 'readonly');
      const req = tx.objectStore(AUDIO_STORE).get(sessionId);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearAllLocalData(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SESSIONS_STORE, AUDIO_STORE], 'readwrite');
      tx.objectStore(SESSIONS_STORE).clear();
      tx.objectStore(AUDIO_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export function loadThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Ignore
  }
  return 'light';
}

export function saveThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore
  }
}

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isMemoryConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouchMobile = /iPad|iPhone|iPod|Android/i.test(ua) || isAppleTouchDevice();
  const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return isTouchMobile || (deviceMemory !== undefined && deviceMemory <= 4);
}

export function detectRecommendedWhisperModel(): WhisperModelId {
  if (isMemoryConstrainedDevice()) {
    return 'Xenova/whisper-tiny.en';
  }
  return 'Xenova/whisper-base.en';
}

export function resolveSafeWhisperModel(model: WhisperModelId): WhisperModelId {
  // Full 12-layer Whisper Small (~240 MB weights, ~1.5-2.2 GB peak WASM RAM) triggers
  // iOS/iPadOS Safari Jetsam tab reloads. Route automatically to Distil-Whisper Small
  // (same 12-layer Small encoder + 4-layer distilled decoder, ~165 MB, 2.5-3x faster).
  if (model === 'Xenova/whisper-small.en' && isAppleTouchDevice()) {
    return 'onnx-community/distil-small.en';
  }
  return model;
}

export function loadWhisperModelPreference(): WhisperModelId {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    if (
      saved === 'Xenova/whisper-tiny.en' ||
      saved === 'Xenova/whisper-base.en' ||
      saved === 'onnx-community/distil-small.en' ||
      saved === 'Xenova/whisper-small.en'
    ) {
      const safe = resolveSafeWhisperModel(saved);
      if (safe !== saved) {
        saveWhisperModelPreference(safe);
      }
      return safe;
    }
  } catch {
    // Ignore
  }
  return detectRecommendedWhisperModel();
}

export function saveWhisperModelPreference(model: WhisperModelId): void {
  try {
    localStorage.setItem(MODEL_KEY, resolveSafeWhisperModel(model));
  } catch {
    // Ignore
  }
}
