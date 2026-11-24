import { APP_VERSION } from '../data/changelog';

export type ErrorLogLevel = 'error' | 'warning' | 'info';

export interface ErrorLogEntry {
  id: string;
  timestamp: number;
  level: ErrorLogLevel;
  source: string;
  title: string;
  message: string;
  details?: string;
  context?: Record<string, string | number | boolean>;
}

export interface DiagnosticsRuntimeInfo {
  appVersion: string;
  isOnline: boolean;
  isStandalone: boolean;
  modelId: string;
  modelSource: string;
  device: string;
  customModelBaseUrl: string;
  userAgent: string;
  url: string;
}

const ERROR_LOG_STORAGE_KEY = 'saltify-web-error-log-v1';
const MAX_ERROR_LOG_ENTRIES = 100;

type ErrorLogListener = (entries: ErrorLogEntry[]) => void;

const listeners = new Set<ErrorLogListener>();
let memoryCache: ErrorLogEntry[] | null = null;
let globalHandlersInstalled = false;

function readFromStorage(): ErrorLogEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(ERROR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ErrorLogEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as ErrorLogEntry).id === 'string' &&
        typeof (item as ErrorLogEntry).timestamp === 'number' &&
        typeof (item as ErrorLogEntry).title === 'string'
    );
  } catch {
    return [];
  }
}

function writeToStorage(entries: ErrorLogEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

function notifyListeners(entries: ErrorLogEntry[]): void {
  const snapshot = [...entries];
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Never allow subscriber errors to cascade
    }
  }
}

export function loadErrorLogs(): ErrorLogEntry[] {
  if (memoryCache === null) {
    memoryCache = readFromStorage();
  }
  return [...memoryCache];
}

export function appendErrorLog(input: {
  level: ErrorLogLevel;
  source: string;
  title: string;
  message: string;
  details?: string;
  context?: Record<string, string | number | boolean>;
}): ErrorLogEntry {
  const current = loadErrorLogs();
  const entry: ErrorLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    level: input.level,
    source: input.source,
    title: input.title,
    message: input.message,
    details: input.details?.trim() || undefined,
    context: input.context,
  };

  const next = [entry, ...current].slice(0, MAX_ERROR_LOG_ENTRIES);
  memoryCache = next;
  writeToStorage(next);
  notifyListeners(next);
  return entry;
}

export function clearErrorLogs(): void {
  memoryCache = [];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ERROR_LOG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  notifyListeners([]);
}

export function subscribeErrorLogs(listener: ErrorLogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resets the in-memory cache (primarily for unit tests).
 */
export function resetErrorLogMemoryCache(): void {
  memoryCache = null;
}

/**
 * Attaches global window error and unhandledrejection listeners once per app lifetime
 * so unexpected runtime crashes are captured in the on-device Error Log.
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === 'undefined') return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const details =
      event.error instanceof Error
        ? event.error.stack || event.error.message
        : event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined;
    appendErrorLog({
      level: 'error',
      source: 'Runtime',
      title: 'Uncaught application error',
      message: event.message || 'An unexpected runtime error occurred.',
      details,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : 'Unhandled asynchronous rejection.';
    const details = reason instanceof Error ? reason.stack : undefined;
    appendErrorLog({
      level: 'error',
      source: 'Async',
      title: 'Unhandled promise rejection',
      message,
      details,
    });
  });
}

export function formatDiagnosticsReport(
  entries: readonly ErrorLogEntry[],
  runtime: DiagnosticsRuntimeInfo
): string {
  const header = [
    `Saltify Web Diagnostics Report`,
    `Generated: ${new Date().toISOString()}`,
    `Version: v${runtime.appVersion || APP_VERSION}`,
    `URL: ${runtime.url}`,
    `Mode: ${runtime.isStandalone ? 'Installed PWA' : 'Browser'} · ${
      runtime.isOnline ? 'Online' : 'Offline'
    }`,
    `Model: ${runtime.modelId} (source=${runtime.modelSource}, device=${runtime.device}${
      runtime.customModelBaseUrl ? `, customUrl=${runtime.customModelBaseUrl}` : ''
    })`,
    `User-Agent: ${runtime.userAgent}`,
    `Logged Entries: ${entries.length}`,
    '',
  ].join('\n');

  if (entries.length === 0) {
    return `${header}No errors or warnings logged.`;
  }

  const body = entries
    .map((entry) => {
      const iso = new Date(entry.timestamp).toISOString();
      const lines = [
        `[${iso}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.title}`,
        `  Message: ${entry.message}`,
      ];
      if (entry.context && Object.keys(entry.context).length > 0) {
        const ctxStr = Object.entries(entry.context)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', ');
        lines.push(`  Context: ${ctxStr}`);
      }
      if (entry.details) {
        lines.push(`  Details: ${entry.details}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `${header}${body}\n`;
}

export function downloadDiagnosticsJson(
  entries: readonly ErrorLogEntry[],
  runtime: DiagnosticsRuntimeInfo
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `saltify-diagnostics-v${runtime.appVersion}-${stamp}.json`;
  const payload = {
    schema: 'saltify-web-diagnostics-v1',
    exportedAt: new Date().toISOString(),
    runtime,
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1500);
  return filename;
}
