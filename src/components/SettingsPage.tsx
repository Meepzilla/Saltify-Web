import {
  ArrowRight,
  Bug,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  History,
  Laptop,
  Moon,
  RotateCcw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SpellCheck,
  Sun,
  Trash2,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, formatReleaseDate, getCurrentRelease } from '../data/changelog';
import type { ErrorLogEntry } from '../engine/errorLog';
import { estimateLocalStorageUsage } from '../engine/storage';
import { MAX_PLAYBACK_BOOST } from '../hooks/useAudioPlayer';
import type { PwaInstallState } from '../hooks/usePwaInstall';
import { useWhisperModelStatus } from '../hooks/useWhisperModelStatus';
import {
  DEFAULT_SPEAKER_ALIASES,
  WHISPER_MODELS,
  type AppSettings,
  type ComputeDevice,
  type ModelSource,
  type ProcessingState,
  type SettingsTab,
  type ThemeMode,
  type WhisperModelId,
} from '../types/saltify';
import { ChangelogPage } from './ChangelogPage';
import { ErrorLogPage } from './ErrorLogPage';
import { PosLegend } from './PartsOfSpeech';

interface SettingsPageProps {
  activeTab: SettingsTab;
  settings: AppSettings;
  resolvedTheme: 'light' | 'dark';
  processing: ProcessingState | null;
  sessionCount: number;
  errorLogs: ErrorLogEntry[];
  pwa: PwaInstallState;
  onSelectTab: (tab: SettingsTab) => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  onClearErrorLogs: () => void;
  onPreloadModel: (modelId: WhisperModelId) => void;
  onNotify: (title: string, description?: string) => void;
}

const VOLUME_PRESETS = [1.0, 1.5, 2.0, 3.0, 4.0] as const;

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'High-contrast clinical alabaster',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Low-glare deep slate for dim rooms',
    icon: Moon,
  },
  {
    value: 'system',
    label: 'System (Auto)',
    description: 'Follows your device OS setting',
    icon: Laptop,
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPage({
  activeTab,
  settings,
  resolvedTheme,
  processing,
  sessionCount,
  errorLogs,
  pwa,
  onSelectTab,
  onUpdateSettings,
  onResetSettings,
  onClearErrorLogs,
  onPreloadModel,
  onNotify,
}: SettingsPageProps) {
  const modelStatus = useWhisperModelStatus(
    activeTab === 'models' || activeTab === 'general',
    settings.customModelBaseUrl,
    processing
  );

  const [storageEstimate, setStorageEstimate] = useState<{
    usageBytes: number | null;
    quotaBytes: number | null;
  }>({ usageBytes: null, quotaBytes: null });

  const currentRelease = getCurrentRelease();
  const errorCount = errorLogs.filter((e) => e.level === 'error').length;

  useEffect(() => {
    if (activeTab !== 'general') return;
    let cancelled = false;
    void estimateLocalStorageUsage().then((est) => {
      if (!cancelled) setStorageEstimate(est);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, sessionCount, modelStatus.cacheBytes]);

  const handleClearModelCache = async () => {
    const cleared = await modelStatus.clearCache();
    if (cleared) {
      onNotify('Model cache cleared', 'Local browser storage has been freed.');
    }
  };

  const handleSpeakerAliasChange = (
    slot: 'speaker1' | 'speaker2',
    rawValue: string
  ) => {
    const clean = rawValue.replace(/\s+/g, '').slice(0, 12);
    onUpdateSettings({
      defaultSpeakerAliases: {
        ...settings.defaultSpeakerAliases,
        [slot]: clean,
      },
    });
  };

  const handleSpeakerAliasBlur = (slot: 'speaker1' | 'speaker2') => {
    const current = settings.defaultSpeakerAliases[slot].trim();
    if (!current) {
      onUpdateSettings({
        defaultSpeakerAliases: {
          ...settings.defaultSpeakerAliases,
          [slot]: DEFAULT_SPEAKER_ALIASES[slot],
        },
      });
    }
  };

  const handleResetConfirm = () => {
    if (
      !window.confirm(
        'Reset all app preferences (theme, volume boost, speech model selection, SALT coding & export defaults) back to factory defaults? Your saved sessions and audio files will NOT be deleted.'
      )
    ) {
      return;
    }
    onResetSettings();
  };

  const navItems: Array<{
    id: SettingsTab;
    label: string;
    icon: typeof SlidersHorizontal;
    badge?: string;
    badgeTone?: 'danger';
    group: 'preferences' | 'application';
  }> = [
    {
      id: 'general',
      label: 'General',
      icon: SlidersHorizontal,
      group: 'preferences',
    },
    {
      id: 'models',
      label: 'Speech & Models',
      icon: Cpu,
      group: 'preferences',
    },
    {
      id: 'salt',
      label: 'SALT & Export',
      icon: SpellCheck,
      group: 'preferences',
    },
    {
      id: 'logs',
      label: 'Error Log',
      icon: Bug,
      badge: errorCount > 0 ? String(errorCount) : undefined,
      badgeTone: errorCount > 0 ? 'danger' : undefined,
      group: 'application',
    },
    {
      id: 'changelog',
      label: 'Change Log',
      icon: History,
      badge: `v${APP_VERSION}`,
      group: 'application',
    },
  ];

  const volumePercent = Math.round(settings.playbackVolume * 100);

  return (
    <div className="settings-shell">
      {/* Settings Navigation Rail (left column on desktop, sticky tab strip on mobile) */}
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-group">
          <div className="settings-nav-heading">Preferences</div>
          {navItems
            .filter((item) => item.group === 'preferences')
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`settings-nav-${item.id}`}
                  type="button"
                  className={`settings-nav-btn ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelectTab(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </div>

        <div className="settings-nav-group">
          <div className="settings-nav-heading">Application</div>
          {navItems
            .filter((item) => item.group === 'application')
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`settings-nav-${item.id}`}
                  type="button"
                  className={`settings-nav-btn ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelectTab(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span
                      className={`settings-nav-badge mono ${
                        item.badgeTone ? item.badgeTone : ''
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {/* Version & Runtime Summary Card at bottom of rail */}
        <div className="settings-version-card" aria-label="Application version info">
          <div className="settings-version-card-top">
            <img src="./favicon.svg" alt="" className="settings-version-mark" />
            <div>
              <div className="settings-version-name">Saltify Web</div>
              <div id="settings-rail-version" className="settings-version-num mono">
                Version {APP_VERSION}
              </div>
            </div>
          </div>
          <div className="settings-version-meta">
            <span>{pwa.isStandalone ? 'Installed PWA' : 'Web App'}</span>
            <span aria-hidden="true">·</span>
            <span>{pwa.isOnline ? 'Online' : 'Offline'}</span>
            <span aria-hidden="true">·</span>
            <span>GPLv3</span>
          </div>
        </div>
      </nav>

      {/* Main Scrollable Settings Content Column */}
      <main className="settings-content">
        <div className="settings-content-inner">
          {activeTab === 'general' && (
            <section
              id="settings-panel-general"
              className="settings-panel"
              aria-labelledby="settings-general-heading"
            >
              <div className="settings-panel-header">
                <div>
                  <h2 id="settings-general-heading" className="settings-panel-title">
                    General Settings
                  </h2>
                  <p className="settings-panel-subtitle">
                    Appearance, default speech playback boost, offline app status, and
                    version details.
                  </p>
                </div>
              </div>

              {/* Appearance */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Appearance</h3>
                  <span className="pane-count-badge">
                    Active: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
                  </span>
                </div>
                <div className="theme-choice-grid" role="radiogroup" aria-label="Color theme">
                  {THEME_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = settings.theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        id={`settings-theme-${opt.value}`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`theme-choice-card ${selected ? 'selected' : ''}`}
                        onClick={() => onUpdateSettings({ theme: opt.value })}
                      >
                        <span className="theme-choice-icon">
                          <Icon size={17} />
                        </span>
                        <span className="theme-choice-label">{opt.label}</span>
                        <span className="theme-choice-desc">{opt.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Default Audio Playback Boost */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Audio Playback Defaults</h3>
                  <span
                    className={`boost-pill ${
                      settings.playbackVolume > 1.05 ? 'boosted' : ''
                    }`}
                  >
                    {volumePercent}%
                  </span>
                </div>
                <p className="settings-card-desc">
                  Default output volume multiplier for clinical playback (up to 400% /
                  +12 dB with soft clipping protection). Values above 100% also apply
                  when exporting normalized WAV files.
                </p>

                <div className="settings-volume-control">
                  <Volume2
                    size={16}
                    style={{
                      color:
                        settings.playbackVolume > 1.05
                          ? 'var(--warning)'
                          : 'var(--text-secondary)',
                      flexShrink: 0,
                    }}
                  />
                  <input
                    id="settings-default-volume-slider"
                    type="range"
                    className={`volume-slider ${
                      settings.playbackVolume > 1.05 ? 'boosted' : ''
                    }`}
                    min={0}
                    max={MAX_PLAYBACK_BOOST}
                    step={0.1}
                    value={settings.playbackVolume}
                    aria-label="Default output volume boost from 0% to 400%"
                    onChange={(e) =>
                      onUpdateSettings({ playbackVolume: parseFloat(e.target.value) })
                    }
                  />
                </div>

                <div className="settings-preset-row">
                  {VOLUME_PRESETS.map((preset) => {
                    const pct = Math.round(preset * 100);
                    const active = Math.abs(settings.playbackVolume - preset) < 0.05;
                    return (
                      <button
                        key={preset}
                        type="button"
                        className={`settings-preset-btn ${active ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ playbackVolume: preset })}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* App Version, Offline & Local Storage */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">About &amp; Device Storage</h3>
                </div>

                <div className="settings-row-list">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Current Version</div>
                      <div className="settings-row-desc">
                        Saltify Web{' '}
                        <strong className="mono">v{APP_VERSION}</strong> · Released{' '}
                        {formatReleaseDate(currentRelease.date)} — {currentRelease.title}
                      </div>
                    </div>
                    <button
                      id="settings-open-changelog-btn"
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelectTab('changelog')}
                    >
                      <span>View Change Log</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Privacy &amp; Connectivity</div>
                      <div className="settings-row-desc">
                        All recordings, transcripts, Whisper inference, and exports run
                        100% locally in your browser.
                      </div>
                    </div>
                    <span
                      className={`settings-status-pill ${
                        pwa.isOnline ? 'success' : 'accent'
                      }`}
                    >
                      {pwa.isOnline ? <ShieldCheck size={14} /> : <WifiOff size={14} />}
                      <span>{pwa.isOnline ? '100% On-Device' : 'Offline Ready'}</span>
                    </span>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">App Installation (PWA)</div>
                      <div className="settings-row-desc">
                        {pwa.isStandalone
                          ? 'Running as an installed standalone application.'
                          : pwa.isIosOrIpad
                          ? 'In Safari, tap Share → Add to Home Screen for full-screen offline use.'
                          : 'Install Saltify Web on this device for full-screen offline sessions.'}
                      </div>
                    </div>
                    {pwa.canPromptInstall ? (
                      <button
                        id="settings-install-pwa-btn"
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void pwa.promptInstall()}
                      >
                        <Download size={14} />
                        <span>Install App</span>
                      </button>
                    ) : (
                      <span className="settings-status-pill muted">
                        <Smartphone size={14} />
                        <span>{pwa.isStandalone ? 'Installed' : 'Browser Mode'}</span>
                      </span>
                    )}
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">Local Sessions &amp; Cache</div>
                      <div className="settings-row-desc">
                        {sessionCount} saved{' '}
                        {sessionCount === 1 ? 'session' : 'sessions'} in IndexedDB
                        {modelStatus.cachedModels.length > 0
                          ? ` · ${modelStatus.cachedModels.length} cached Whisper ${
                              modelStatus.cachedModels.length === 1 ? 'model' : 'models'
                            }`
                          : ''}
                        {storageEstimate.usageBytes !== null
                          ? ` · ~${formatBytes(storageEstimate.usageBytes)} total browser storage`
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm"
                      onClick={() => onSelectTab('models')}
                    >
                      <HardDrive size={14} />
                      <span>Manage Cache</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Reset Preferences */}
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Reset Preferences to Defaults</div>
                    <div className="settings-row-desc">
                      Restores appearance, playback boost, speech model, SALT coding, and
                      export defaults. Your recorded sessions and transcripts stay safe.
                    </div>
                  </div>
                  <button
                    id="settings-reset-defaults-btn"
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    onClick={handleResetConfirm}
                  >
                    <RotateCcw size={14} />
                    <span>Reset Defaults</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'models' && (
            <section
              id="settings-panel-models"
              className="settings-panel"
              aria-labelledby="settings-models-heading"
            >
              <div className="settings-panel-header">
                <div>
                  <h2 id="settings-models-heading" className="settings-panel-title">
                    Speech Recognition &amp; Self-Hosting
                  </h2>
                  <p className="settings-panel-subtitle">
                    Choose your on-device Whisper model, pre-cache weights for offline
                    clinical sessions, and configure air-gapped self-hosting.
                  </p>
                </div>
              </div>

              {processing?.kind === 'model-download' && (
                <div className="processing-strip" role="status" aria-live="polite">
                  <div className="processing-strip-top">
                    <span>
                      {processing.stage}
                      {processing.detail ? ` — ${processing.detail}` : ''}
                    </span>
                    <span className="mono">{Math.round(processing.progress * 100)}%</span>
                  </div>
                  <div className="processing-bar-track">
                    <div
                      className="processing-bar-fill"
                      style={{
                        width: `${Math.max(3, Math.round(processing.progress * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">On-Device Whisper Model</h3>
                  <span className="pane-count-badge">100% Local Inference</span>
                </div>
                <p className="settings-card-desc">
                  Models load from your self-hosted server (<code>/models/</code>) when
                  present, or Hugging Face Hub when enabled, and stay cached in browser
                  storage for offline use.
                </p>

                <div className="settings-model-list">
                  {WHISPER_MODELS.map((model) => {
                    const isSelected = settings.modelId === model.id;
                    const isCached = modelStatus.cachedModels.includes(model.id);
                    const isSelfHosted = modelStatus.selfHostedModels.includes(model.id);

                    return (
                      <div
                        key={model.id}
                        className={`option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => onUpdateSettings({ modelId: model.id })}
                      >
                        <div className="settings-model-info">
                          <div className="settings-model-title-row">
                            <strong className="settings-model-name">{model.label}</strong>
                            <span className="pane-count-badge">{model.sizeLabel}</span>
                            {isSelected && (
                              <span className="settings-inline-badge accent">Active</span>
                            )}
                            {isSelfHosted && (
                              <span className="settings-inline-badge accent">
                                <Server size={12} />
                                <span>Self-Hosted</span>
                              </span>
                            )}
                            {isCached && (
                              <span className="settings-inline-badge success">
                                <CheckCircle2 size={12} />
                                <span>Cached Offline</span>
                              </span>
                            )}
                          </div>
                          <span className="settings-model-desc">{model.description}</span>
                          <span className="settings-model-rec">
                            Best for: {model.recommendedFor}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={processing !== null}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateSettings({ modelId: model.id });
                            onPreloadModel(model.id);
                          }}
                        >
                          <Download size={14} />
                          <span>{isCached ? 'Verify' : 'Cache'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Transcription method: speech-first (default) or classic chunks */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Transcription Method</h3>
                </div>
                <p className="settings-card-desc">
                  <strong>Speech-first</strong> finds the speech, skips silence and re-checks phrases that
                  look missed (at most one extra pass per segment). <strong>Classic</strong> sends the
                  whole recording in fixed ~26-second chunks with no re-checks, as before version 1.12.
                  If a recording comes out with missing words or takes much longer than expected, try
                  the other method and compare.
                </p>
                <div className="form-field">
                  <label className="form-label" htmlFor="setting-transcription-method">
                    Method
                  </label>
                  <select
                    id="setting-transcription-method"
                    className="field-select"
                    value={settings.transcriptionMethod}
                    onChange={(e) =>
                      onUpdateSettings({
                        transcriptionMethod: e.target.value as AppSettings['transcriptionMethod'],
                      })
                    }
                  >
                    <option value="speech-first">Speech-first (recommended)</option>
                    <option value="classic">Classic (pre-1.12)</option>
                  </select>
                </div>
                <label className="settings-toggle-row" htmlFor="setting-live-transcribe" style={{ marginTop: 12 }}>
                  <div className="settings-row-info">
                    <div className="settings-row-title">Transcribe while recording</div>
                    <div className="settings-row-desc">
                      Transcribes in the background during the session, so the transcript is ready a few
                      seconds after you tap Stop. Runs only when the chosen model is already downloaded
                      and the session has no transcript yet. Second Opinion runs only when you tap
                      Transcribe.
                    </div>
                  </div>
                  <input
                    id="setting-live-transcribe"
                    type="checkbox"
                    className="settings-toggle-input"
                    checked={settings.transcribeWhileRecording}
                    onChange={(e) => onUpdateSettings({ transcribeWhileRecording: e.target.checked })}
                  />
                </label>
              </div>

              {/* Second opinion: compare with another model during transcription */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Second Opinion</h3>
                </div>
                <p className="settings-card-desc">
                  Transcribe with a second Whisper model as well and flag the words where the two
                  disagree. Your transcript still comes from the main model; tap a dashed word to
                  see what the other model heard and swap it in with one tap. In testing this
                  caught about 66% of Whisper Small&apos;s mistakes instead of 57%, with a similar
                  number of flags. It adds roughly 50% to transcription time (Small + Base) and
                  is best on a laptop or for shorter samples on iPad.
                </p>
                <div className="form-field">
                  <label className="form-label" htmlFor="setting-second-opinion">
                    Compare with
                  </label>
                  <select
                    id="setting-second-opinion"
                    className="field-select"
                    value={settings.secondOpinionModelId}
                    onChange={(e) =>
                      onUpdateSettings({
                        secondOpinionModelId: e.target.value as AppSettings['secondOpinionModelId'],
                      })
                    }
                  >
                    <option value="off">Off (main model only)</option>
                    {WHISPER_MODELS.filter((m) => m.id !== settings.modelId && m.family !== 'moonshine').map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {m.sizeLabel}
                      </option>
                    ))}
                  </select>
                </div>
                {settings.secondOpinionModelId !== 'off' &&
                  WHISPER_MODELS.find((m) => m.id === settings.modelId)?.family === 'moonshine' && (
                    <p className="settings-card-desc" style={{ marginTop: 8 }}>
                      Second Opinion compares two Whisper models, so it does not run while Moonshine
                      is your main model.
                    </p>
                  )}
                {settings.secondOpinionModelId !== 'off' &&
                  settings.secondOpinionModelId === settings.modelId && (
                    <p className="settings-card-desc" style={{ marginTop: 8 }}>
                      This is the same as your main model, so no comparison will run. Choose a
                      different model.
                    </p>
                  )}
              </div>

              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">
                    Compute Engine &amp; Self-Hosting
                  </h3>
                </div>

                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="settings-model-source-select" className="form-label">
                      Model Hosting Source
                    </label>
                    <select
                      id="settings-model-source-select"
                      className="field-select"
                      value={settings.modelSource}
                      onChange={(e) =>
                        onUpdateSettings({ modelSource: e.target.value as ModelSource })
                      }
                    >
                      <option value="auto">Self-Hosted First, HF Fallback (Auto)</option>
                      <option value="local-only">
                        Self-Hosted Only (Zero External Requests)
                      </option>
                      <option value="huggingface">Hugging Face Hub Only</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="settings-compute-device-select" className="form-label">
                      On-Device Compute Engine
                    </label>
                    <select
                      id="settings-compute-device-select"
                      className="field-select"
                      value={settings.device}
                      onChange={(e) =>
                        onUpdateSettings({ device: e.target.value as ComputeDevice })
                      }
                    >
                      <option value="auto">Auto (WebGPU with WASM fallback)</option>
                      <option value="wasm">Universal WASM (Safest on iPad / Mobile)</option>
                      <option value="webgpu">
                        WebGPU Acceleration (Windows / Chrome)
                      </option>
                    </select>
                  </div>

                  <div className="form-field full">
                    <label htmlFor="settings-custom-model-url" className="form-label">
                      Custom Self-Hosted Model Base URL (optional)
                    </label>
                    <input
                      id="settings-custom-model-url"
                      type="text"
                      className="field-input"
                      value={settings.customModelBaseUrl}
                      onChange={(e) =>
                        onUpdateSettings({ customModelBaseUrl: e.target.value })
                      }
                      placeholder="Default: ./models/ on this server"
                    />
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Local Model Cache</div>
                    <div className="settings-row-desc">
                      {modelStatus.cachedModels.length > 0
                        ? `${modelStatus.cachedModels.length} Whisper ${
                            modelStatus.cachedModels.length === 1 ? 'model' : 'models'
                          } cached locally (~${Math.max(
                            1,
                            Math.round(modelStatus.cacheBytes / (1024 * 1024))
                          )} MB).`
                        : 'No Whisper models are cached in browser storage yet.'}
                    </div>
                  </div>
                  <button
                    id="settings-clear-model-cache-btn"
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    disabled={modelStatus.cachedModels.length === 0}
                    onClick={() => void handleClearModelCache()}
                  >
                    <Trash2 size={14} />
                    <span>Clear Cache</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'salt' && (
            <section
              id="settings-panel-salt"
              className="settings-panel"
              aria-labelledby="settings-salt-heading"
            >
              <div className="settings-panel-header">
                <div>
                  <h2 id="settings-salt-heading" className="settings-panel-title">
                    SALT Coding &amp; Export Defaults
                  </h2>
                  <p className="settings-panel-subtitle">
                    Configure automated SALT convention rules, default speaker labels for
                    new sessions, and document export formatting.
                  </p>
                </div>
              </div>

              {/* Grammar Coding Rules */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">SALT Grammar Check Preferences</h3>
                </div>

                <div className="settings-row-list">
                  <label className="settings-toggle-row" htmlFor="setting-filler-mazes">
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Automatically code verbal fillers as mazes
                      </div>
                      <div className="settings-row-desc">
                        Wraps verbal fillers such as <code>um</code> and <code>uh</code>{' '}
                        in SALT maze parentheses (e.g., <code>(um)</code>) during Grammar
                        Check.
                      </div>
                    </div>
                    <input
                      id="setting-filler-mazes"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.codeFillerMazes}
                      onChange={(e) =>
                        onUpdateSettings({ codeFillerMazes: e.target.checked })
                      }
                    />
                  </label>

                  <label
                    className="settings-toggle-row"
                    htmlFor="setting-overregularization-tag"
                  >
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Use <code>[EO:target]</code> for overregularization errors
                      </div>
                      <div className="settings-row-desc">
                        Codes irregular past/plural overregularizations as{' '}
                        <code>telled[EO:told]</code> instead of the default{' '}
                        <code>telled[EW:told]</code>.
                      </div>
                    </div>
                    <input
                      id="setting-overregularization-tag"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.useOverregularizationTag}
                      onChange={(e) =>
                        onUpdateSettings({ useOverregularizationTag: e.target.checked })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Parts of Speech */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Parts of Speech</h3>
                </div>
                <p className="settings-card-desc">
                  Color each word in the Transcription and SALT Convention boxes by part of
                  speech. Tagging runs on this device. Mazes, comments, omitted words and SALT
                  codes are not colored. To add codes such as <code>dog[N]</code> to the text
                  itself, use <strong>POS Codes</strong> in the SALT Convention box.
                </p>

                <div className="settings-row-list">
                  <label className="settings-toggle-row" htmlFor="setting-color-pos">
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Color-code parts of speech in utterances
                      </div>
                      <div className="settings-row-desc">
                        Display only. Your transcript text, exports and SALT metrics are not
                        changed. Hover or long-press a word to see its part of speech.
                      </div>
                    </div>
                    <input
                      id="setting-color-pos"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.colorCodePartsOfSpeech}
                      onChange={(e) =>
                        onUpdateSettings({ colorCodePartsOfSpeech: e.target.checked })
                      }
                    />
                  </label>
                </div>

                <div style={{ marginTop: 12 }}>
                  <PosLegend />
                </div>
              </div>

              {/* International Phonetic Alphabet (IPA) Broad Transcription */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">
                    International Phonetic Alphabet (IPA)
                  </h3>
                  <span className="pane-count-badge">Broad Phonemic</span>
                </div>
                <p className="settings-card-desc">
                  Converts utterances into General American English broad IPA transcription
                  (<code>/…/</code>) on this device using standard IPA symbols (
                  <code>ɑ æ ʌ ə ɛ ɪ ɔ ʊ ɝ ɚ θ ð ʃ ʒ ŋ ɹ ɡ ˈ ˌ</code>) and syllable stress.
                  Also toggleable directly from the Transcription and SALT Convention boxes.
                </p>

                <div className="settings-row-list">
                  <label className="settings-toggle-row" htmlFor="setting-ipa-transcription">
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Convert utterances to IPA broad transcription (/…/)
                      </div>
                      <div className="settings-row-desc">
                        Non-destructive: your original transcript text, Grammar Check, and
                        SALT metrics stay unchanged. Hover or tap any IPA word to see the
                        original English spelling, or enable IPA in Export to copy/save.
                      </div>
                    </div>
                    <input
                      id="setting-ipa-transcription"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.showIpaTranscription}
                      onChange={(e) =>
                        onUpdateSettings({ showIpaTranscription: e.target.checked })
                      }
                    />
                  </label>
                </div>

                <div className="ipa-preview-strip" aria-label="IPA broad transcription examples">
                  <div className="ipa-preview-row">
                    <span className="ipa-preview-source">The little boy went home.</span>
                    <span className="ipa-utterance" lang="en-fonipa">
                      /ðə ˈlɪtəl bɔɪ wɛnt hoʊm/
                    </span>
                  </div>
                  <div className="ipa-preview-row">
                    <span className="ipa-preview-source">He walked and laughed.</span>
                    <span className="ipa-utterance" lang="en-fonipa">
                      /hi wɔkt ænd læft/
                    </span>
                  </div>
                </div>
              </div>

              {/* Default Speaker Aliases */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">
                    Default Speaker Aliases (New Sessions)
                  </h3>
                </div>
                <p className="settings-card-desc">
                  Applied automatically when creating a new session. Existing sessions
                  retain their own aliases editable from the Transcription pane.
                </p>

                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="settings-default-speaker1" className="form-label">
                      Speaker 1 (Primary / Child)
                    </label>
                    <input
                      id="settings-default-speaker1"
                      type="text"
                      className="field-input mono"
                      value={settings.defaultSpeakerAliases.speaker1}
                      onChange={(e) =>
                        handleSpeakerAliasChange('speaker1', e.target.value)
                      }
                      onBlur={() => handleSpeakerAliasBlur('speaker1')}
                      placeholder="C"
                      maxLength={12}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="settings-default-speaker2" className="form-label">
                      Speaker 2 (Examiner / Partner)
                    </label>
                    <input
                      id="settings-default-speaker2"
                      type="text"
                      className="field-input mono"
                      value={settings.defaultSpeakerAliases.speaker2}
                      onChange={(e) =>
                        handleSpeakerAliasChange('speaker2', e.target.value)
                      }
                      onBlur={() => handleSpeakerAliasBlur('speaker2')}
                      placeholder="E"
                      maxLength={12}
                    />
                  </div>
                </div>
              </div>

              {/* Export Preferences */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h3 className="settings-card-title">Export Formatting Defaults</h3>
                </div>

                <div className="settings-row-list">
                  <label className="settings-toggle-row" htmlFor="setting-salt-headers">
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Include Client Info &amp; SALT Header lines
                      </div>
                      <div className="settings-row-desc">
                        Prepends standard <code>$</code> / <code>+</code> SALT metadata
                        headers (client name, age, examiner, context) to exported files.
                      </div>
                    </div>
                    <input
                      id="setting-salt-headers"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.includeSaltHeadersOnExport}
                      onChange={(e) =>
                        onUpdateSettings({ includeSaltHeadersOnExport: e.target.checked })
                      }
                    />
                  </label>

                  <label
                    className="settings-toggle-row"
                    htmlFor="setting-strip-timestamps"
                  >
                    <div className="settings-row-info">
                      <div className="settings-row-title">
                        Strip <code>[M:SS]</code> timestamps on export
                      </div>
                      <div className="settings-row-desc">
                        Removes audio scrubber timestamps when exporting to Word (
                        <code>.docx</code>), SALT (<code>.slt</code>), or plain text.
                      </div>
                    </div>
                    <input
                      id="setting-strip-timestamps"
                      type="checkbox"
                      className="settings-toggle-input"
                      checked={settings.stripTimestampsOnExport}
                      onChange={(e) =>
                        onUpdateSettings({ stripTimestampsOnExport: e.target.checked })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'logs' && (
            <ErrorLogPage
              entries={errorLogs}
              settings={settings}
              pwa={pwa}
              onClearLogs={onClearErrorLogs}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'changelog' && (
            <ChangelogPage
              isStandalone={pwa.isStandalone}
              isOnline={pwa.isOnline}
              onNotify={onNotify}
            />
          )}
        </div>
      </main>
    </div>
  );
}
