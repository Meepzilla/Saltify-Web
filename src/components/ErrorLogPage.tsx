import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Info,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { APP_VERSION } from '../data/changelog';
import {
  downloadDiagnosticsJson,
  formatDiagnosticsReport,
  type DiagnosticsRuntimeInfo,
  type ErrorLogEntry,
  type ErrorLogLevel,
} from '../engine/errorLog';
import type { PwaInstallState } from '../hooks/usePwaInstall';
import type { AppSettings } from '../types/saltify';

interface ErrorLogPageProps {
  entries: ErrorLogEntry[];
  settings: AppSettings;
  pwa: PwaInstallState;
  onClearLogs: () => void;
  onNotify: (title: string, description?: string) => void;
}

type LevelFilter = 'all' | ErrorLogLevel;

function formatLogTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ErrorLogPage({
  entries,
  settings,
  pwa,
  onClearLogs,
  onNotify,
}: ErrorLogPageProps) {
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);

  const counts = useMemo(() => {
    let error = 0;
    let warning = 0;
    let info = 0;
    for (const e of entries) {
      if (e.level === 'error') error += 1;
      else if (e.level === 'warning') warning += 1;
      else info += 1;
    }
    return { total: entries.length, error, warning, info };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false;
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.message.toLowerCase().includes(q) ||
        entry.source.toLowerCase().includes(q) ||
        (entry.details?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, level, query]);

  const runtimeInfo: DiagnosticsRuntimeInfo = useMemo(
    () => ({
      appVersion: APP_VERSION,
      isOnline: pwa.isOnline,
      isStandalone: pwa.isStandalone,
      modelId: settings.modelId,
      modelSource: settings.modelSource,
      device: settings.device,
      customModelBaseUrl: settings.customModelBaseUrl,
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    }),
    [
      pwa.isOnline,
      pwa.isStandalone,
      settings.modelId,
      settings.modelSource,
      settings.device,
      settings.customModelBaseUrl,
    ]
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyReport = async () => {
    const report = formatDiagnosticsReport(entries, runtimeInfo);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      onNotify(
        'Diagnostics report copied',
        `Copied v${APP_VERSION} runtime info and ${entries.length} log ${
          entries.length === 1 ? 'entry' : 'entries'
        }.`
      );
    } catch {
      onNotify('Copy failed', 'Use Download JSON to save the error log instead.');
    }
  };

  const handleDownloadJson = () => {
    const file = downloadDiagnosticsJson(entries, runtimeInfo);
    onNotify('Diagnostics downloaded', `Saved ${file} locally.`);
  };

  const handleClear = () => {
    if (entries.length === 0) return;
    if (
      !window.confirm(
        `Clear all ${entries.length} logged diagnostic entries from this device?`
      )
    ) {
      return;
    }
    onClearLogs();
    setExpandedIds(new Set());
    onNotify('Error log cleared');
  };

  const hasFilter = level !== 'all' || query.trim().length > 0;

  return (
    <section
      id="settings-panel-logs"
      className="settings-panel"
      aria-labelledby="error-log-heading"
    >
      <div className="settings-panel-header">
        <div>
          <h2 id="error-log-heading" className="settings-panel-title">
            Error Log &amp; Diagnostics
          </h2>
          <p className="settings-panel-subtitle">
            On-device log of model downloads, transcription, audio, and runtime errors.
            Stored strictly locally — never uploaded, and never logs transcript text.
          </p>
        </div>
      </div>

      {/* Runtime Summary & Export Actions */}
      <div className="settings-card">
        <div className="errorlog-summary-top">
          <div className="errorlog-runtime-chips">
            <span className="version-pill current">v{APP_VERSION}</span>
            <span className="pane-count-badge">
              {settings.modelId.replace('onnx-community/', '')}
            </span>
            <span className="pane-count-badge">source: {settings.modelSource}</span>
            <span className="pane-count-badge">device: {settings.device}</span>
            <span className="pane-count-badge">
              {pwa.isOnline ? 'online' : 'offline'}
            </span>
          </div>

          <div className="errorlog-actions">
            <button
              id="errorlog-copy-report-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleCopyReport()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy Report'}</span>
            </button>

            <button
              id="errorlog-download-json-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadJson}
            >
              <Download size={14} />
              <span>Export JSON</span>
            </button>

            <button
              id="errorlog-clear-btn"
              type="button"
              className="btn btn-danger-soft btn-sm"
              disabled={entries.length === 0}
              onClick={handleClear}
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Pills & Search */}
      <div className="changelog-toolbar" role="search" aria-label="Filter error log">
        <div
          className="changelog-filter-pills"
          role="group"
          aria-label="Filter by severity"
        >
          <button
            id="errorlog-filter-all"
            type="button"
            className={`changelog-filter-btn ${level === 'all' ? 'active' : ''}`}
            aria-pressed={level === 'all'}
            onClick={() => setLevel('all')}
          >
            <span>All</span>
            <span className="changelog-filter-count">{counts.total}</span>
          </button>
          <button
            id="errorlog-filter-error"
            type="button"
            className={`changelog-filter-btn ${level === 'error' ? 'active' : ''}`}
            aria-pressed={level === 'error'}
            onClick={() => setLevel('error')}
          >
            <AlertCircle size={13} />
            <span>Errors</span>
            <span className="changelog-filter-count">{counts.error}</span>
          </button>
          <button
            id="errorlog-filter-warning"
            type="button"
            className={`changelog-filter-btn ${level === 'warning' ? 'active' : ''}`}
            aria-pressed={level === 'warning'}
            onClick={() => setLevel('warning')}
          >
            <AlertTriangle size={13} />
            <span>Warnings</span>
            <span className="changelog-filter-count">{counts.warning}</span>
          </button>
          <button
            id="errorlog-filter-info"
            type="button"
            className={`changelog-filter-btn ${level === 'info' ? 'active' : ''}`}
            aria-pressed={level === 'info'}
            onClick={() => setLevel('info')}
          >
            <Info size={13} />
            <span>Info</span>
            <span className="changelog-filter-count">{counts.info}</span>
          </button>
        </div>

        <div className="changelog-search-wrap">
          <Search size={15} className="changelog-search-icon" aria-hidden="true" />
          <input
            id="errorlog-search-input"
            type="search"
            className="field-input changelog-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search error messages..."
            aria-label="Search error log entries"
          />
          {query && (
            <button
              type="button"
              className="changelog-search-clear"
              aria-label="Clear error log search"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Log Entries */}
      {entries.length === 0 ? (
        <div className="settings-card changelog-empty">
          <ShieldCheck size={26} style={{ color: 'var(--success)' }} />
          <h3>No errors logged</h3>
          <p>
            Everything is running smoothly. If a model download, microphone capture, or
            transcription error occurs, full diagnostic details will appear here
            automatically.
          </p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="settings-card changelog-empty">
          <AlertCircle size={24} className="changelog-empty-icon" />
          <h3>No matching log entries</h3>
          <p>Try clearing the search query or switching back to all severities.</p>
          {hasFilter && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setLevel('all');
                setQuery('');
              }}
            >
              <RotateCcw size={14} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      ) : (
        <div className="errorlog-list">
          {filteredEntries.map((entry) => {
            const hasExtra =
              Boolean(entry.details) ||
              (entry.context && Object.keys(entry.context).length > 0);
            const isExpanded = expandedIds.has(entry.id);

            return (
              <article
                key={entry.id}
                className={`settings-card errorlog-entry ${entry.level}`}
              >
                <div className="errorlog-entry-header">
                  <div className="errorlog-entry-meta">
                    <span className={`errorlog-level-badge ${entry.level}`}>
                      {entry.level === 'error' ? (
                        <AlertCircle size={12} />
                      ) : entry.level === 'warning' ? (
                        <AlertTriangle size={12} />
                      ) : (
                        <Info size={12} />
                      )}
                      <span>{entry.level}</span>
                    </span>
                    <span className="pane-count-badge">{entry.source}</span>
                    <strong className="errorlog-entry-title">{entry.title}</strong>
                  </div>
                  <time
                    className="errorlog-entry-time mono"
                    dateTime={new Date(entry.timestamp).toISOString()}
                  >
                    {formatLogTimestamp(entry.timestamp)}
                  </time>
                </div>

                <p className="errorlog-entry-message">{entry.message}</p>

                {hasExtra && (
                  <div className="errorlog-entry-details-wrap">
                    <button
                      type="button"
                      className="errorlog-expand-btn"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpand(entry.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>
                        {isExpanded ? 'Hide technical details' : 'Show technical details'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="errorlog-details-box">
                        {entry.context && Object.keys(entry.context).length > 0 && (
                          <div className="errorlog-context-grid mono">
                            {Object.entries(entry.context).map(([k, v]) => (
                              <span key={k} className="errorlog-context-pill">
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                        {entry.details && (
                          <pre className="errorlog-pre mono">{entry.details}</pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
