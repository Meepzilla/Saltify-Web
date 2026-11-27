import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bug,
  Columns2,
  Cpu,
  Download,
  FileText,
  HelpCircle,
  History,
  Menu,
  Mic,
  Pause,
  Play,
  RectangleVertical,
  Settings,
  Share,
  SpellCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioStudio } from './components/AudioStudio';
import { ClauseCoderModal } from './components/ClauseCoderModal';
import { ClientInfoModal } from './components/ClientInfoModal';
import { ConventionPane } from './components/ConventionPane';
import { ExportModal } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { MetricsPanel } from './components/MetricsPanel';
import { ModelManagerModal } from './components/ModelManagerModal';
import { OverflowMenu } from './components/OverflowMenu';
import { SettingsPage } from './components/SettingsPage';
import { Sidebar } from './components/Sidebar';
import { SpectrogramModal } from './components/SpectrogramModal';
import { LabelSpeakersModal, SpeakerAliasesModal } from './components/SpeakerModals';
import { ToastStack } from './components/Toast';
import { TranscriptionPane } from './components/TranscriptionPane';
import { WaveformModal } from './components/WaveformCanvas';
import { APP_VERSION } from './data/changelog';
import {
  applySoftLimitedGain,
  decodeAudioBlob,
  encodeWavBlob,
} from './engine/audioProcessing';
import { CrossPlatformAudioRecorder } from './engine/audioRecorder';
import {
  parseUtteranceClauseCoding,
  setUtteranceSiCode,
} from './engine/clauseAnalysis';
import {
  appendErrorLog,
  clearErrorLogs,
  installGlobalErrorHandlers,
  loadErrorLogs,
  subscribeErrorLogs,
  type ErrorLogEntry,
} from './engine/errorLog';
import { downloadSessionAudio } from './engine/exporter';
import { GrammarCheckerSession } from './engine/grammarSession';
import {
  addInflectionalMorphemes,
  formatCorrectionForConventionBox,
} from './engine/saltConventions';
import { replaceWordInBody } from './engine/modelFusion';
import { insertPosCodes } from './engine/partsOfSpeech';
import { hasPosCodes, stripPosCodes } from './engine/posCodes';
import { resolveFlagInMap } from './engine/wordConfidence';
import { computeSaltMetrics } from './engine/saltMetrics';
import { DEMO_CLIENT_INFO, DEMO_TRANSCRIPT } from './engine/sampleData';
import {
  autoAssignSpeakersInTranscript,
  type SpeakerDetectionMode,
} from './engine/speakerDiarizer';
import {
  deleteSessionRecord,
  loadAllSessions,
  loadAppSettings,
  loadAudioBlob,
  resetAppSettings,
  saveAppSettings,
  saveAudioBlob,
  saveSessionRecord,
} from './engine/storage';
import {
  formatDurationPadded,
  parseUtteranceLines,
  remapSpeakerAliases,
  swapSpeakersInTranscript,
} from './engine/transcriptFormat';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { usePwaInstall } from './hooks/usePwaInstall';
import { useTheme } from './hooks/useTheme';
import {
  DEFAULT_SPEAKER_ALIASES,
  EMPTY_CLIENT_INFO,
  type AppSettings,
  type AppView,
  type ClientInfo,
  type ProcessingState,
  type SessionRecord,
  type SettingsTab,
  type SpeakerAliases,
  type ToastMessage,
  type WhisperModelId,
  WHISPER_MODELS,
} from './types/saltify';
import { getErrorDetails, isCancelledError, whisperClient } from './workers/whisperClient';

type MobileTab = 'audio' | 'transcript' | 'salt' | 'metrics';

/** At or below this width the sessions sidebar is a slide-out drawer (iPad, laptops). Keep in sync with app.css. */
const DRAWER_MAX_WIDTH = 1440;
const SPLIT_VIEW_KEY = 'saltify-web-split-view';

function parseHashRoute(hash: string): { view: AppView; tab: SettingsTab } {
  const clean = hash.replace(/^#\/?/, '').toLowerCase();
  if (clean === 'changelog' || clean === 'settings/changelog') {
    return { view: 'settings', tab: 'changelog' };
  }
  if (clean === 'logs' || clean === 'settings/logs') {
    return { view: 'settings', tab: 'logs' };
  }
  if (clean === 'settings/models') {
    return { view: 'settings', tab: 'models' };
  }
  if (clean === 'settings/salt') {
    return { view: 'settings', tab: 'salt' };
  }
  if (clean === 'settings' || clean === 'settings/general') {
    return { view: 'settings', tab: 'general' };
  }
  return { view: 'workspace', tab: 'general' };
}

function createFreshSession(
  number: number,
  defaultAliases: SpeakerAliases = DEFAULT_SPEAKER_ALIASES
): SessionRecord {
  const now = Date.now();
  const stamp = new Date(now).toISOString().replace('T', ' ').slice(0, 19);
  return {
    id: `sess_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name: `Session ${number} - ${stamp}`,
    createdAt: now,
    updatedAt: now,
    clientInfo: { ...EMPTY_CLIENT_INFO, dateOfSample: stamp.slice(0, 10) },
    speakerAliases: {
      speaker1: defaultAliases.speaker1.trim() || DEFAULT_SPEAKER_ALIASES.speaker1,
      speaker2: defaultAliases.speaker2.trim() || DEFAULT_SPEAKER_ALIASES.speaker2,
    },
    audioMeta: null,
    hasAudioBlob: false,
    transcriptionText: '',
    conventionText: '',
    grammarCheckPerformed: false,
    morphemesApplied: false,
    notes: '',
  };
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const resolvedTheme = useTheme(settings.theme);
  const pwa = usePwaInstall();

  const initialRoute = useMemo(
    () =>
      parseHashRoute(typeof window !== 'undefined' ? window.location.hash : ''),
    []
  );
  const [activeView, setActiveView] = useState<AppView>(initialRoute.view);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialRoute.tab);

  const [sessions, setSessions] = useState<SessionRecord[]>(() => [
    createFreshSession(1, loadAppSettings().defaultSpeakerAliases),
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);

  // Active session's in-memory audio blob & decoded 16kHz PCM cache
  const [activeAudioBlob, setActiveAudioBlob] = useState<Blob | null>(null);
  const mono16kCacheRef = useRef<Map<string, Float32Array>>(new Map());

  // Recorder state
  const recorderRef = useRef<CrossPlatformAudioRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);

  // Processing state (transcription / model download)
  const [processing, setProcessing] = useState<ProcessingState | null>(null);

  // Interactive step-by-step Grammar Check session
  const grammarRunnerRef = useRef<GrammarCheckerSession | null>(null);
  const [grammarActive, setGrammarActive] = useState(false);
  const [checkAllSentences, setCheckAllSentences] = useState(false);
  const [currentOriginalLine, setCurrentOriginalLine] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState('');
  const [grammarProgress, setGrammarProgress] = useState({ remaining: 0, total: 0 });

  // Layout & Modals
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileTab, setMobileTabState] = useState<MobileTab>('audio');
  // Tablet/desktop editor: Transcript or SALT tab, or both side by side (remembered per device)
  const [editorTab, setEditorTab] = useState<'transcript' | 'salt'>('transcript');
  const [splitView, setSplitView] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SPLIT_VIEW_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_VIEW_KEY, splitView ? '1' : '0');
    } catch {
      // storage unavailable (private mode) — keep in memory only
    }
  }, [splitView]);
  // Actions that jump to the SALT or Transcript view on phones also switch the tablet tab
  const setMobileTab = useCallback((tab: MobileTab) => {
    setMobileTabState(tab);
    if (tab === 'transcript' || tab === 'salt') setEditorTab(tab);
  }, []);
  const [iosBannerDismissed, setIosBannerDismissed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [showClientModal, setShowClientModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showLabelSpeakersModal, setShowLabelSpeakersModal] = useState(false);
  const [showAliasesModal, setShowAliasesModal] = useState(false);
  const [showClauseModal, setShowClauseModal] = useState(false);
  const [showWaveformModal, setShowWaveformModal] = useState(false);
  /** Transcript line index shown in the Spectrogram view, or null when closed. */
  const [spectrogramLine, setSpectrogramLine] = useState<number | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>(() => loadErrorLogs());
  const openLogsRef = useRef<() => void>(() => {});
  const runtimeCtxRef = useRef({
    modelId: settings.modelId,
    modelSource: settings.modelSource,
    device: settings.device,
    isOnline: pwa.isOnline,
  });

  useEffect(() => {
    runtimeCtxRef.current = {
      modelId: settings.modelId,
      modelSource: settings.modelSource,
      device: settings.device,
      isOnline: pwa.isOnline,
    };
  }, [settings.modelId, settings.modelSource, settings.device, pwa.isOnline]);

  useEffect(() => {
    installGlobalErrorHandlers();
    return subscribeErrorLogs(setErrorLogs);
  }, []);

  const pushToast = useCallback(
    (
      tone: ToastMessage['tone'],
      title: string,
      description?: string,
      retry?: { label?: string; onRetry: () => void },
      details?: string
    ) => {
      if (tone === 'error' || tone === 'warning') {
        const ctx = runtimeCtxRef.current;
        appendErrorLog({
          level: tone,
          source: 'App',
          title,
          message: description || title,
          details,
          context: {
            version: APP_VERSION,
            model: ctx.modelId,
            source: ctx.modelSource,
            device: ctx.device,
            online: ctx.isOnline,
          },
        });
      }

      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => {
        const filtered =
          tone === 'error'
            ? prev.slice(-1)
            : prev.filter((t) => t.tone === 'error').slice(-1);
        return [
          ...filtered,
          {
            id,
            tone,
            title,
            description,
            retryLabel: retry?.label,
            onRetry: retry?.onRetry,
            actionLabel: tone === 'error' ? 'View Log' : undefined,
            onAction: tone === 'error' ? () => openLogsRef.current() : undefined,
          },
        ];
      });
      if (tone !== 'error') {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3200);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Hydrate persisted sessions from IndexedDB on startup
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadAllSessions();
      if (cancelled) return;
      if (stored.length > 0) {
        setSessions(stored);
        setActiveSessionId(stored[0].id);
      } else {
        const first = createFreshSession(1);
        setSessions([first]);
        setActiveSessionId(first.id);
        await saveSessionRecord(first).catch(() => {});
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId]
  );

  const activeId = activeSession.id;
  const activeHasAudio = activeSession.hasAudioBlob;

  // Load audio Blob from IndexedDB when switching sessions
  useEffect(() => {
    if (!hydrated || !activeId) return;
    let cancelled = false;
    void (async () => {
      if (!activeHasAudio) {
        setActiveAudioBlob(null);
        return;
      }
      const blob = await loadAudioBlob(activeId);
      if (!cancelled) {
        setActiveAudioBlob(blob);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, activeId, activeHasAudio]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveAppSettings(next);
      return next;
    });
  }, []);

  const syncHash = useCallback((view: AppView, tab: SettingsTab) => {
    if (typeof window === 'undefined') return;
    const targetHash =
      view === 'workspace'
        ? ''
        : tab === 'general'
        ? '#settings'
        : `#settings/${tab}`;
    if (window.location.hash !== targetHash) {
      const nextUrl = targetHash
        ? `${window.location.pathname}${window.location.search}${targetHash}`
        : `${window.location.pathname}${window.location.search}`;
      window.history.pushState(null, '', nextUrl);
    }
  }, []);

  const openSettings = useCallback(
    (tab: SettingsTab = 'general') => {
      setSettingsTab(tab);
      setActiveView('settings');
      syncHash('settings', tab);
    },
    [syncHash]
  );

  useEffect(() => {
    openLogsRef.current = () => openSettings('logs');
  }, [openSettings]);

  const closeSettings = useCallback(() => {
    setActiveView('workspace');
    syncHash('workspace', settingsTab);
  }, [syncHash, settingsTab]);

  // Keep view state synchronized with browser Back/Forward hash changes
  useEffect(() => {
    const onRouteChange = () => {
      const next = parseHashRoute(window.location.hash);
      setActiveView(next.view);
      setSettingsTab(next.tab);
    };
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, []);

  // Update browser document title to match active page
  useEffect(() => {
    if (activeView === 'settings') {
      document.title =
        settingsTab === 'changelog'
          ? `Change Log — Saltify Web v${APP_VERSION}`
          : settingsTab === 'logs'
          ? `Error Log — Saltify Web v${APP_VERSION}`
          : `Settings — Saltify Web v${APP_VERSION}`;
    } else {
      document.title = 'Saltify — On-Device SALT Speech Transcription & Analysis';
    }
  }, [activeView, settingsTab]);

  const anyModalOpen =
    showClientModal ||
    showExportModal ||
    showModelModal ||
    showHelpModal ||
    showLabelSpeakersModal ||
    showAliasesModal ||
    showClauseModal ||
    showWaveformModal ||
    spectrogramLine !== null;

  useEffect(() => {
    if (activeView !== 'settings' || anyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeView, anyModalOpen, closeSettings]);

  const handleResetSettings = useCallback(() => {
    const defaults = resetAppSettings();
    setSettings(defaults);
    pushToast(
      'info',
      'Preferences restored',
      'App settings were reset to factory defaults. Saved sessions were kept.'
    );
  }, [pushToast]);

  const handleVolumeChange = useCallback(
    (playbackVolume: number) => {
      updateSettings({ playbackVolume });
    },
    [updateSettings]
  );

  const player = useAudioPlayer(
    activeAudioBlob,
    activeSession.audioMeta?.duration ?? 0,
    settings.playbackVolume,
    handleVolumeChange,
    useCallback((msg: string) => pushToast('error', 'Playback Error', msg), [pushToast])
  );

  const updateActiveSession = useCallback(
    (updater: (session: SessionRecord) => SessionRecord) => {
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const updated = { ...updater(s), updatedAt: Date.now() };
          void saveSessionRecord(updated).catch(() => {});
          return updated;
        });
        return next;
      });
    },
    [activeId]
  );

  const resetGrammarReview = useCallback(() => {
    grammarRunnerRef.current = null;
    setGrammarActive(false);
    setCurrentOriginalLine(null);
    setCorrectionDraft('');
    setGrammarProgress({ remaining: 0, total: 0 });
  }, []);

  // Session Management
  const handleNewSession = useCallback(() => {
    if (isRecording) {
      recorderRef.current?.cancel();
      setIsRecording(false);
      setIsRecordingPaused(false);
    }
    if (processing?.kind === 'transcription') {
      whisperClient.cancel();
      setProcessing(null);
    }
    resetGrammarReview();
    player.pause();

    const fresh = createFreshSession(
      sessions.length + 1,
      settings.defaultSpeakerAliases
    );
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setActiveAudioBlob(null);
    if (activeView !== 'workspace') {
      closeSettings();
    }
    void saveSessionRecord(fresh).catch(() => {});
  }, [
    isRecording,
    processing,
    resetGrammarReview,
    player,
    sessions.length,
    settings.defaultSpeakerAliases,
    activeView,
    closeSettings,
  ]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === activeId) {
        if (activeView !== 'workspace') {
          closeSettings();
        }
        return;
      }
      if (isRecording) {
        pushToast('warning', 'Recording in progress', 'Stop recording before switching sessions.');
        return;
      }
      if (processing?.kind === 'transcription') {
        whisperClient.cancel();
        setProcessing(null);
      }
      resetGrammarReview();
      player.pause();
      setActiveSessionId(id);
      if (activeView !== 'workspace') {
        closeSettings();
      }
    },
    [
      activeId,
      activeView,
      closeSettings,
      isRecording,
      processing,
      resetGrammarReview,
      player,
      pushToast,
    ]
  );

  const handleRenameSession = useCallback((id: string, nextName: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, name: nextName, updatedAt: Date.now() };
        void saveSessionRecord(updated).catch(() => {});
        return updated;
      })
    );
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!target) return;
      if (!window.confirm(`Delete "${target.name}"? This cannot be undone.`)) {
        return;
      }
      if (id === activeId) {
        if (processing?.kind === 'transcription') {
          whisperClient.cancel();
          setProcessing(null);
        }
        resetGrammarReview();
        player.pause();
      }
      mono16kCacheRef.current.delete(id);
      void deleteSessionRecord(id).catch(() => {});

      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        if (remaining.length === 0) {
          const fallback = createFreshSession(1, settings.defaultSpeakerAliases);
          setActiveSessionId(fallback.id);
          setActiveAudioBlob(null);
          void saveSessionRecord(fallback).catch(() => {});
          return [fallback];
        }
        if (id === activeId) {
          setActiveSessionId(remaining[0].id);
        }
        return remaining;
      });
    },
    [
      sessions,
      activeId,
      processing,
      resetGrammarReview,
      player,
      settings.defaultSpeakerAliases,
    ]
  );

  const handleImportSessionJson = useCallback(
    async (file: File) => {
      try {
        const raw = await file.text();
        const parsed = JSON.parse(raw) as {
          schema?: string;
          session?: Partial<SessionRecord>;
        };
        const imported = parsed.session;
        if (!imported || typeof imported.name !== 'string') {
          throw new Error('File is not a valid Saltify session backup (.saltify.json).');
        }
        const now = Date.now();
        const record: SessionRecord = {
          ...createFreshSession(sessions.length + 1, settings.defaultSpeakerAliases),
          ...imported,
          id: `sess_${now}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: imported.createdAt ?? now,
          updatedAt: now,
          audioMeta: null,
          hasAudioBlob: false,
        };
        setSessions((prev) => [record, ...prev]);
        setActiveSessionId(record.id);
        setActiveAudioBlob(null);
        if (activeView !== 'workspace') {
          closeSettings();
        }
        await saveSessionRecord(record);
        pushToast('success', 'Session imported', `Loaded "${record.name}".`);
      } catch (err) {
        pushToast(
          'error',
          'Import failed',
          err instanceof Error ? err.message : 'Invalid JSON file.'
        );
      }
    },
    [
      sessions.length,
      settings.defaultSpeakerAliases,
      activeView,
      closeSettings,
      pushToast,
    ]
  );

  // Audio Ingest (Upload or Recording stop)
  const ingestAudioBlob = useCallback(
    async (rawBlob: Blob, fileName: string) => {
      player.pause();
      try {
        const decoded = await decodeAudioBlob(rawBlob);
        mono16kCacheRef.current.set(activeId, decoded.mono16k);
        await saveAudioBlob(activeId, decoded.wavBlob);
        setActiveAudioBlob(decoded.wavBlob);

        updateActiveSession((s) => ({
          ...s,
          hasAudioBlob: true,
          audioMeta: {
            fileName,
            mimeType: 'audio/wav',
            duration: decoded.duration,
            sampleRate: 16000,
            sizeBytes: decoded.wavBlob.size,
            waveformPeaks: decoded.waveformPeaks,
          },
        }));

        pushToast(
          'success',
          'Audio ready',
          `${fileName} (${formatDurationPadded(decoded.duration)}) normalized locally.`
        );
      } catch (err) {
        pushToast(
          'error',
          'Audio could not be processed',
          err instanceof Error ? err.message : 'Try another WAV, MP3, M4A, or WebM file.'
        );
      }
    },
    [activeId, player, updateActiveSession, pushToast]
  );

  const handleUploadFile = useCallback(
    (file: File) => {
      void ingestAudioBlob(file, file.name);
    },
    [ingestAudioBlob]
  );

  const handleStartRecording = useCallback(async () => {
    player.pause();
    const recorder = new CrossPlatformAudioRecorder();
    recorderRef.current = recorder;
    try {
      setRecordingSeconds(0);
      setRecordingLevel(0);
      await recorder.start({
        onLevel: setRecordingLevel,
        onDuration: setRecordingSeconds,
      });
      setIsRecording(true);
      setIsRecordingPaused(false);
    } catch (err) {
      recorderRef.current = null;
      pushToast(
        'error',
        'Microphone Error',
        err instanceof Error ? err.message : 'Could not start recording.'
      );
    }
  }, [player, pushToast]);

  const handleTogglePauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.isPaused) {
      recorder.resume();
      setIsRecordingPaused(false);
    } else {
      recorder.pause();
      setIsRecordingPaused(true);
    }
  }, []);

  const handleStopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setIsRecording(false);
    setIsRecordingPaused(false);
    recorderRef.current = null;

    try {
      const blob = await recorder.stop();
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      await ingestAudioBlob(blob, `Recording_${stamp}.wav`);
    } catch (err) {
      pushToast(
        'error',
        'Recording could not be saved',
        err instanceof Error ? err.message : 'Empty recording.'
      );
    }
  }, [ingestAudioBlob, pushToast]);

  const handleDownloadAudio = useCallback(async () => {
    if (!activeAudioBlob || !activeSession) return;
    let blobToSave = activeAudioBlob;
    const gain = player.muted ? 1 : player.volume;

    if (gain > 1.05) {
      try {
        let mono16k = mono16kCacheRef.current.get(activeId);
        if (!mono16k) {
          const decoded = await decodeAudioBlob(activeAudioBlob);
          mono16k = decoded.mono16k;
          mono16kCacheRef.current.set(activeId, mono16k);
        }
        const boosted = applySoftLimitedGain(mono16k, gain);
        blobToSave = encodeWavBlob(boosted, 16000);
      } catch {
        blobToSave = activeAudioBlob;
      }
    }

    const saved = downloadSessionAudio(
      blobToSave,
      activeSession.audioMeta?.fileName || activeSession.name
    );
    pushToast(
      'success',
      'WAV Audio Downloaded',
      gain > 1.05
        ? `${saved} (exported with ${Math.round(gain * 100)}% loudness boost)`
        : saved
    );
  }, [activeAudioBlob, activeId, activeSession, player.muted, player.volume, pushToast]);

  // On-Device Whisper Transcription
  const startTranscriptionRef = useRef<() => Promise<void>>(async () => {});

  const startTranscription = useCallback(async () => {
    if (!activeAudioBlob || !activeId) return;
    player.pause();
    resetGrammarReview();

    setProcessing({
      kind: 'transcription',
      stage: 'Preparing 16 kHz audio',
      progress: 0.03,
    });

    try {
      let mono16k = mono16kCacheRef.current.get(activeId);
      if (!mono16k) {
        const decoded = await decodeAudioBlob(activeAudioBlob);
        mono16k = decoded.mono16k;
        mono16kCacheRef.current.set(activeId, mono16k);
      }

      const result = await whisperClient.transcribe(
        mono16k,
        {
          modelId: settings.modelId,
          compareModelId:
            settings.secondOpinionModelId !== 'off' &&
            settings.secondOpinionModelId !== settings.modelId
              ? settings.secondOpinionModelId
              : undefined,
          vocabulary: activeSession.vocabulary,
          device: settings.device,
          modelSource: settings.modelSource,
          customModelBaseUrl: settings.customModelBaseUrl,
          aliases: activeSession.speakerAliases,
        },
        {
          onProgress: (stage, progress, detail) => {
            setProcessing({
              kind: 'transcription',
              stage,
              progress,
              detail,
            });
          },
          onPartial: (partialTranscript) => {
            if (partialTranscript.trim()) {
              updateActiveSession((s) => ({
                ...s,
                transcriptionText: partialTranscript,
              }));
            }
          },
        }
      );

      setProcessing(null);

      if (!result.transcript.trim()) {
        pushToast(
          'warning',
          'No speech detected',
          'Check that the recording has audible speech and try again.',
          { label: 'Retry', onRetry: () => void startTranscriptionRef.current() }
        );
        return;
      }

      updateActiveSession((s) => ({
        ...s,
        transcriptionText: result.transcript,
        wordConfidence: result.wordConfidence,
        secondOpinionModelId: result.secondOpinionModelId,
      }));
      setMobileTab('transcript');
      pushToast(
        'success',
        'On-device transcription complete',
        `Auto-labeled ${result.speakerCount} speaker${result.speakerCount > 1 ? 's' : ''} locally via ${result.backendUsed.toUpperCase()}.`
      );
    } catch (err) {
      setProcessing(null);
      if (isCancelledError(err)) {
        pushToast('info', 'Transcription cancelled', 'Your audio and previous text were preserved.');
        return;
      }
      pushToast(
        'error',
        'Transcription failed',
        err instanceof Error
          ? err.message
          : `Unexpected error during Whisper inference: ${String(err)}`,
        { label: 'Retry', onRetry: () => void startTranscriptionRef.current() },
        getErrorDetails(err)
      );
    }
  }, [
    activeAudioBlob,
    activeId,
    activeSession.speakerAliases,
    activeSession.vocabulary,
    player,
    resetGrammarReview,
    settings.modelId,
    settings.secondOpinionModelId,
    settings.device,
    settings.modelSource,
    settings.customModelBaseUrl,
    updateActiveSession,
    pushToast,
    setMobileTab,
  ]);

  useEffect(() => {
    startTranscriptionRef.current = startTranscription;
  }, [startTranscription]);

  const handleToggleTranscribe = useCallback(() => {
    if (processing?.kind === 'transcription') {
      whisperClient.cancel();
      setProcessing(null);
      return;
    }
    void startTranscription();
  }, [processing, startTranscription]);

  const handlePreloadModel = useCallback(
    async (modelId: WhisperModelId) => {
      setProcessing({
        kind: 'model-download',
        stage: 'Loading Whisper model for offline use',
        progress: 0.04,
      });
      try {
        const res = await whisperClient.preloadModel(
          {
            modelId,
            device: settings.device,
            modelSource: settings.modelSource,
            customModelBaseUrl: settings.customModelBaseUrl,
          },
          (stage, progress, detail) => {
            setProcessing({ kind: 'model-download', stage, progress, detail });
          }
        );
        setProcessing(null);
        pushToast(
          'success',
          'Whisper model ready offline',
          `Cached locally using ${res.backendUsed.toUpperCase()}.`
        );
      } catch (err) {
        setProcessing(null);
        if (!isCancelledError(err)) {
          pushToast(
            'error',
            'Model load failed',
            err instanceof Error ? err.message : `Unexpected error: ${String(err)}`,
            undefined,
            getErrorDetails(err)
          );
        }
      }
    },
    [settings.device, settings.modelSource, settings.customModelBaseUrl, pushToast]
  );

  // Load Demo Sample for instant testing without needing a recording first
  const handleLoadDemoSample = useCallback(() => {
    resetGrammarReview();
    updateActiveSession((s) => ({
      ...s,
      name: 'Demo Child Language Sample (4;8)',
      clientInfo: { ...DEMO_CLIENT_INFO },
      speakerAliases: { speaker1: 'C', speaker2: 'E' },
      transcriptionText: DEMO_TRANSCRIPT,
      conventionText: '',
      grammarCheckPerformed: false,
      morphemesApplied: false,
    }));
    setMobileTab('transcript');
    pushToast(
      'info',
      'Demo language sample loaded',
      'Click Grammar Check → Add Morphemes to preview full SALT coding and clinical metrics.'
    );
  }, [resetGrammarReview, updateActiveSession, pushToast, setMobileTab]);

  // Step-by-Step SALT Grammar Check Workflow (Desktop Saltify parity + batch option)
  const advanceGrammarStep = useCallback(
    (runner: GrammarCheckerSession, baseConventionLines: string[]) => {
      const step = runner.getNextCorrection();
      const merged = [...baseConventionLines, ...step.passedLines].filter(Boolean);
      const nextConventionText = merged.join('\n');

      updateActiveSession((s) => ({
        ...s,
        conventionText: nextConventionText,
        grammarCheckPerformed: step.done ? true : s.grammarCheckPerformed,
        morphemesApplied: false,
      }));

      if (step.done || step.nextCorrection === null) {
        grammarRunnerRef.current = null;
        setGrammarActive(false);
        setCurrentOriginalLine(null);
        setCorrectionDraft('');
        setGrammarProgress({ remaining: 0, total: runner.getTotalCount() });
        pushToast(
          'success',
          'Grammar check complete',
          'Click "Add Morphemes" to tag bound inflectional morphemes.'
        );
      } else {
        setGrammarActive(true);
        setCurrentOriginalLine(step.originalLine);
        setCorrectionDraft(step.nextCorrection);
        setGrammarProgress({
          remaining: runner.getRemainingCount(),
          total: runner.getTotalCount(),
        });
      }
    },
    [updateActiveSession, pushToast]
  );

  const handleStartOrCancelGrammarCheck = useCallback(() => {
    if (grammarActive) {
      resetGrammarReview();
      pushToast('info', 'Grammar review stopped');
      return;
    }
    if (!activeSession?.transcriptionText.trim()) return;

    const runner = new GrammarCheckerSession(
      activeSession.transcriptionText,
      {
        checkAllSentences,
        codeFillerMazes: settings.codeFillerMazes,
        useOverregularizationTag: settings.useOverregularizationTag,
      },
      [activeSession.speakerAliases.speaker1, activeSession.speakerAliases.speaker2]
    );
    grammarRunnerRef.current = runner;
    setMobileTab('salt');
    advanceGrammarStep(runner, []);
  }, [
    grammarActive,
    resetGrammarReview,
    activeSession,
    checkAllSentences,
    settings.codeFillerMazes,
    settings.useOverregularizationTag,
    advanceGrammarStep,
    pushToast,
    setMobileTab,
  ]);

  const handleSubmitCorrection = useCallback(() => {
    const runner = grammarRunnerRef.current;
    if (!runner || !activeSession) return;
    const formatted = formatCorrectionForConventionBox(correctionDraft);
    const existingLines = activeSession.conventionText
      ? activeSession.conventionText.split(/\r?\n/).filter(Boolean)
      : [];
    const nextLines = formatted ? [...existingLines, formatted] : existingLines;
    advanceGrammarStep(runner, nextLines);
  }, [activeSession, correctionDraft, advanceGrammarStep]);

  const handleSkipCorrection = useCallback(() => {
    const runner = grammarRunnerRef.current;
    if (!runner || !activeSession) return;
    const existingLines = activeSession.conventionText
      ? activeSession.conventionText.split(/\r?\n/).filter(Boolean)
      : [];
    const nextLines = currentOriginalLine
      ? [...existingLines, currentOriginalLine]
      : existingLines;
    advanceGrammarStep(runner, nextLines);
  }, [activeSession, currentOriginalLine, advanceGrammarStep]);

  const handleAutoApplyAllRemaining = useCallback(() => {
    const runner = grammarRunnerRef.current;
    if (!runner || !activeSession) return;
    const existingLines = activeSession.conventionText
      ? activeSession.conventionText.split(/\r?\n/).filter(Boolean)
      : [];
    const currentLine = formatCorrectionForConventionBox(correctionDraft);
    const rest = runner.applyAllRemaining();
    const combined = [...existingLines, ...(currentLine ? [currentLine] : []), ...rest].join('\n');

    grammarRunnerRef.current = null;
    setGrammarActive(false);
    setCurrentOriginalLine(null);
    setCorrectionDraft('');
    setGrammarProgress({ remaining: 0, total: runner.getTotalCount() });

    updateActiveSession((s) => ({
      ...s,
      conventionText: combined,
      grammarCheckPerformed: true,
      morphemesApplied: false,
    }));
    pushToast(
      'success',
      'Applied SALT coding to all utterances',
      'Review any line or click "Add Morphemes" next.'
    );
  }, [activeSession, correctionDraft, updateActiveSession, pushToast]);

  // Bound Inflectional Morphemes (Desktop Saltify parity)
  const handleAddMorphemes = useCallback(() => {
    if (!activeSession) return;
    const sourceText =
      activeSession.conventionText.trim() || activeSession.transcriptionText.trim();
    if (!sourceText) return;

    const morphemeCoded = addInflectionalMorphemes(sourceText, [
      activeSession.speakerAliases.speaker1,
      activeSession.speakerAliases.speaker2,
    ]);
    // Keep part-of-speech codes if the user had inserted them (morpheme coding strips them)
    const coded = hasPosCodes(sourceText)
      ? insertPosCodes(morphemeCoded, activeSession.speakerAliases)
      : morphemeCoded;

    updateActiveSession((s) => ({
      ...s,
      conventionText: coded,
      morphemesApplied: true,
    }));
    setMobileTab('salt');
    pushToast(
      'success',
      'Inflectional morphemes coded',
      'Applied SALT /s, /z, /ed, /3s, /ing, and contraction conventions.'
    );
  }, [activeSession, updateActiveSession, pushToast, setMobileTab]);

  // Part-of-speech codes: insert dog[N] run/3s[V] on every word, or remove them
  const handleTogglePosCodes = useCallback(() => {
    if (!activeSession) return;
    const sourceText =
      activeSession.conventionText.trim() || activeSession.transcriptionText.trim();
    if (!sourceText) return;

    if (hasPosCodes(sourceText)) {
      const cleaned = stripPosCodes(sourceText)
        .split(/\r?\n/)
        .map((l) => l.replace(/[ \t]{2,}/g, ' ').trimEnd())
        .join('\n');
      updateActiveSession((s) => ({ ...s, conventionText: cleaned }));
      pushToast('info', 'Part-of-speech codes removed', 'All other SALT coding was kept.');
      return;
    }

    const coded = insertPosCodes(sourceText, activeSession.speakerAliases);
    updateActiveSession((s) => ({ ...s, conventionText: coded }));
    setMobileTab('salt');
    pushToast(
      'success',
      'Part-of-speech codes inserted',
      'Each spoken word now has a code such as [N], [V] or [PRO]. Mazes, comments and SALT codes were left as they were. Review them before exporting.'
    );
  }, [activeSession, updateActiveSession, pushToast, setMobileTab]);

  // SALT Clause Marking & Clausal Density (Subordination Index)
  const handleApplyClauseText = useCallback(
    (nextText: string) => {
      if (!activeSession) return;
      updateActiveSession((s) => ({
        ...s,
        conventionText: nextText,
      }));
      setMobileTab('salt');
      const updated = computeSaltMetrics(
        nextText,
        activeSession.speakerAliases,
        activeSession.audioMeta?.duration ?? null
      );
      const primary =
        updated.speaker1.totalUtterances > 0 ? updated.speaker1 : updated.overall;
      pushToast(
        'success',
        'Clause marks updated',
        primary.clausalDensity !== null
          ? `${primary.speaker} Clausal Density: ${primary.clausalDensity.toFixed(2)} (${primary.totalClauses} clauses / ${primary.clauseScoredUtterances} utterances)`
          : 'Clause codes cleared.'
      );
    },
    [activeSession, updateActiveSession, pushToast, setMobileTab]
  );

  const handleQuickCycleLineSi = useCallback(
    (lineIndex: number) => {
      if (!activeSession) return;
      const sourceText =
        activeSession.conventionText.trim() || activeSession.transcriptionText.trim();
      if (!sourceText) return;
      const rawLines = sourceText.split(/\r?\n/);
      if (lineIndex < 0 || lineIndex >= rawLines.length) return;

      const parsed = parseUtteranceLines(rawLines[lineIndex], activeSession.speakerAliases)[0];
      const coding = parseUtteranceClauseCoding(parsed?.body ?? rawLines[lineIndex]);

      // Quick tap cycle: unmarked -> SI-1 -> SI-2 -> SI-3 -> SI-0 -> SI-X -> unmarked
      let nextSi: number | 'X' | null;
      if (coding.isExcluded) {
        nextSi = null;
      } else if (coding.clauseCount === null) {
        nextSi = 1;
      } else if (coding.clauseCount === 1) {
        nextSi = 2;
      } else if (coding.clauseCount === 2) {
        nextSi = 3;
      } else if (coding.clauseCount === 3) {
        nextSi = 0;
      } else if (coding.clauseCount === 0) {
        nextSi = 'X';
      } else {
        nextSi = null;
      }

      rawLines[lineIndex] = setUtteranceSiCode(rawLines[lineIndex], nextSi);
      updateActiveSession((s) => ({
        ...s,
        conventionText: rawLines.join('\n'),
      }));
    },
    [activeSession, updateActiveSession]
  );

  // Speaker Aliases Update
  const handleSaveAliases = useCallback(
    (nextAliases: SpeakerAliases) => {
      if (!activeSession) return;
      const prev = activeSession.speakerAliases;
      updateActiveSession((s) => ({
        ...s,
        speakerAliases: nextAliases,
        transcriptionText: remapSpeakerAliases(s.transcriptionText, prev, nextAliases),
        conventionText: remapSpeakerAliases(s.conventionText, prev, nextAliases),
      }));
      pushToast(
        'success',
        'Speaker aliases updated',
        `Speaker 1 → ${nextAliases.speaker1}, Speaker 2 → ${nextAliases.speaker2}`
      );
    },
    [activeSession, updateActiveSession, pushToast]
  );

  const handleAutoAssignSpeakers = useCallback(
    async (mode: SpeakerDetectionMode = 'auto') => {
      if (!activeSession?.transcriptionText.trim()) return;
      let audio16k = mono16kCacheRef.current.get(activeId) ?? null;
      if (mode !== 'single' && !audio16k && activeAudioBlob) {
        try {
          const decoded = await decodeAudioBlob(activeAudioBlob);
          audio16k = decoded.mono16k;
          mono16kCacheRef.current.set(activeId, audio16k);
        } catch {
          audio16k = null;
        }
      }
      const result = autoAssignSpeakersInTranscript(
        activeSession.transcriptionText,
        activeSession.speakerAliases,
        audio16k,
        16000,
        { mode }
      );
      updateActiveSession((s) => ({
        ...s,
        transcriptionText: result.transcript,
      }));
      const primaryAlias = activeSession.speakerAliases.speaker1.trim() || 'C';
      const description =
        mode === 'single'
          ? `Labeled all utterances as 1 speaker (${primaryAlias}).`
          : mode === 'two'
          ? `Labeled ${result.speakerCount} speaker${result.speakerCount > 1 ? 's' : ''} using local ${result.method} analysis.`
          : `Detected ${result.speakerCount} speaker${result.speakerCount > 1 ? 's' : ''} using local ${result.method} analysis.`;
      pushToast('success', 'Speakers auto-assigned', description);
    },
    [activeSession, activeId, activeAudioBlob, updateActiveSession, pushToast]
  );

  const handleSwapSpeakers = useCallback(() => {
    if (!activeSession) return;
    const aliases = activeSession.speakerAliases;
    updateActiveSession((s) => ({
      ...s,
      transcriptionText: swapSpeakersInTranscript(s.transcriptionText, aliases),
      conventionText: swapSpeakersInTranscript(s.conventionText, aliases),
    }));
    pushToast(
      'info',
      'Swapped speakers',
      `Swapped ${aliases.speaker1} ↔ ${aliases.speaker2} labels across this session.`
    );
  }, [activeSession, updateActiveSession, pushToast]);

  // Derived utterance timestamps for Waveform markers & live SALT metrics
  const activeTranscript = activeSession.transcriptionText;
  const activeConventions = activeSession.conventionText;
  const activeAliases = activeSession.speakerAliases;
  const activeDuration = activeSession.audioMeta?.duration ?? null;
  const activeClientInfo = activeSession.clientInfo;

  const transcriptLines = useMemo(
    () => parseUtteranceLines(activeTranscript, activeAliases),
    [activeTranscript, activeAliases]
  );

  /** 16 kHz mono samples for the active session (cached after the first decode). */
  const loadSessionSamples = useCallback(async () => {
    if (!activeId || !activeAudioBlob) return null;
    const cached = mono16kCacheRef.current.get(activeId);
    if (cached) return cached;
    const decoded = await decodeAudioBlob(activeAudioBlob);
    mono16kCacheRef.current.set(activeId, decoded.mono16k);
    return decoded.mono16k;
  }, [activeId, activeAudioBlob]);

  /**
   * Resolves a flagged transcript word: swap in the other model's word, remove the word ('')
   * or keep it (null). Only that flag is cleared; the line's other flags stay.
   */
  const handleResolveUncertainWord = useCallback(
    (lineIndex: number, wordIndex: number, replacement: string | null) => {
      updateActiveSession((s) => {
        const parsed = parseUtteranceLines(s.transcriptionText, s.speakerAliases);
        const line = parsed[lineIndex];
        if (!line) return s;
        const newBody =
          replacement === null ? line.body : replaceWordInBody(line.body, wordIndex, replacement);
        const rawTrim = line.raw.trim();
        const prefix = rawTrim.slice(0, rawTrim.length - line.body.length);
        const rawLines = s.transcriptionText.split(/\r?\n/);
        rawLines[lineIndex] = `${prefix}${newBody}`;
        return {
          ...s,
          transcriptionText: rawLines.join('\n'),
          wordConfidence: resolveFlagInMap(s.wordConfidence, line.body, newBody, wordIndex),
        };
      });
    },
    [updateActiveSession]
  );

  const flagThresholds = useMemo(
    () => ({
      uncertainBelow: settings.uncertainWordThreshold,
      disagreementBelow: settings.disagreementThreshold,
    }),
    [settings.uncertainWordThreshold, settings.disagreementThreshold]
  );


  /** Opens the Spectrogram at the line under the playhead (or the first line). */
  const openSpectrogramAtPlayhead = useCallback(() => {
    let target = -1;
    for (const l of transcriptLines) {
      if (l.timestampSec !== null && l.body.trim() && l.timestampSec <= player.currentTime + 0.4) {
        target = l.index;
      }
    }
    if (target < 0) {
      target = transcriptLines.find((l) => l.timestampSec !== null && l.body.trim())?.index ?? 0;
    }
    setSpectrogramLine(target);
  }, [transcriptLines, player.currentTime]);

  const utteranceTimestamps = useMemo(() => {
    if (!activeTranscript) return [];
    return parseUtteranceLines(activeTranscript, activeAliases)
      .map((u) => u.timestampSec)
      .filter((sec): sec is number => sec !== null);
  }, [activeTranscript, activeAliases]);

  const metricsSourceText = activeConventions.trim() || activeTranscript;

  const metrics = useMemo(
    () => computeSaltMetrics(metricsSourceText, activeAliases, activeDuration),
    [metricsSourceText, activeAliases, activeDuration]
  );

  const clientChipSummary = useMemo(() => {
    const parts = [
      activeClientInfo.name,
      activeClientInfo.age ? `CA ${activeClientInfo.age}` : '',
      activeClientInfo.samplingContext,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Add Client Info';
  }, [activeClientInfo]);

  if (!activeSession) return null;

  const transcriptLineCount = activeSession.transcriptionText
    .split(/\r?\n/)
    .filter((l) => l.trim()).length;
  const saltLineCount = activeSession.conventionText
    .split(/\r?\n/)
    .filter((l) => l.trim()).length;
  const selectEditorTab = (tab: 'transcript' | 'salt') => {
    setEditorTab(tab);
    setMobileTab(tab);
  };

  // Rendered in whichever box is showing; ids only on the active copy to keep them unique
  const editorTabsFor = (slot: 'transcript' | 'salt') => {
    const primary = slot === editorTab;
    return (
      <div className="editor-tabs">
        <div className="editor-tablist" role="tablist" aria-label="Editor view">
          <button
            id={primary ? 'editor-tab-transcript' : undefined}
            type="button"
            role="tab"
            aria-selected={editorTab === 'transcript'}
            className={`editor-tab ${editorTab === 'transcript' ? 'active' : ''}`}
            onClick={() => selectEditorTab('transcript')}
          >
            <FileText size={14} />
            <span>Transcript</span>
            <span className="editor-tab-count">{transcriptLineCount}</span>
          </button>
          <button
            id={primary ? 'editor-tab-salt' : undefined}
            type="button"
            role="tab"
            aria-selected={editorTab === 'salt'}
            className={`editor-tab ${editorTab === 'salt' ? 'active' : ''}`}
            onClick={() => selectEditorTab('salt')}
          >
            <SpellCheck size={14} />
            <span>SALT</span>
            <span className="editor-tab-count">{saltLineCount}</span>
          </button>
        </div>
        <button
          id={primary ? 'split-view-btn' : undefined}
          type="button"
          className="btn btn-ghost btn-icon split-toggle"
          title="Show Transcript and SALT side by side"
          aria-label="Show Transcript and SALT side by side"
          onClick={() => setSplitView(true)}
        >
          <Columns2 size={17} />
        </button>
      </div>
    );
  };

  const splitTranscriptHeader = (
    <>
      <button
        id="single-view-btn"
        type="button"
        className="btn btn-ghost btn-icon split-toggle"
        title="Show one box at a time"
        aria-label="Show one box at a time (tabs)"
        onClick={() => setSplitView(false)}
      >
        <RectangleVertical size={16} />
      </button>
      <h2 className="pane-title">Transcript</h2>
      <span className="pane-count-badge">{transcriptLineCount}</span>
    </>
  );

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
        mobileDrawerOpen ? 'mobile-drawer-open' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && (file.type.startsWith('audio/') || /\.(wav|mp3|m4a|mp4|webm|ogg|flac)$/i.test(file.name))) {
          if (activeView !== 'workspace') {
            closeSettings();
          }
          handleUploadFile(file);
        }
      }}
    >
      <div
        className="sidebar-backdrop"
        onClick={() => setMobileDrawerOpen(false)}
      />

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSession.id}
        activeView={activeView}
        isOnline={pwa.isOnline}
        canPromptInstall={pwa.canPromptInstall}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onImportSessionJson={(file) => void handleImportSessionJson(file)}
        onPromptInstall={() => void pwa.promptInstall()}
        onCloseMobileDrawer={() => setMobileDrawerOpen(false)}
        onCollapseSidebar={() => {
          setMobileDrawerOpen(false);
          if (window.innerWidth > DRAWER_MAX_WIDTH) {
            setSidebarCollapsed(true);
          }
        }}
      />

      <div className="workspace">
        {activeView === 'settings' ? (
          <>
            {/* Settings Page Header Bar */}
            <header className="topbar no-print">
              <div className="topbar-left">
                <button
                  id="toggle-sidebar-btn"
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Toggle sessions sidebar"
                  onClick={() => {
                    if (window.innerWidth <= DRAWER_MAX_WIDTH) {
                      setMobileDrawerOpen((v) => !v);
                    } else {
                      setSidebarCollapsed((v) => !v);
                    }
                  }}
                >
                  <Menu size={19} />
                </button>

                <button
                  id="settings-back-btn"
                  type="button"
                  className="btn btn-subtle btn-sm"
                  onClick={closeSettings}
                  title={`Return to ${activeSession.name}`}
                >
                  <ArrowLeft size={15} />
                  <span>Back to Session</span>
                </button>

                <div className="settings-topbar-breadcrumb">
                  <span className="topbar-session-title">
                    {settingsTab === 'changelog'
                      ? 'Change Log'
                      : settingsTab === 'logs'
                      ? 'Error Log'
                      : 'Settings'}
                  </span>
                </div>
              </div>

              <div className="topbar-right">
                {isRecording && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={closeSettings}
                    title="Live microphone recording is active — return to audio studio"
                  >
                    <span className="rec-dot" />
                    <span className="mono">{formatDurationPadded(recordingSeconds)}</span>
                  </button>
                )}

                <button
                  id="topbar-version-btn"
                  type="button"
                  className={`version-pill version-pill-btn ${
                    settingsTab === 'changelog' ? 'current' : ''
                  }`}
                  title="Current Saltify Web version — view Change Log"
                  onClick={() => openSettings('changelog')}
                >
                  v{APP_VERSION}
                </button>
              </div>
            </header>

            <SettingsPage
              activeTab={settingsTab}
              settings={settings}
              resolvedTheme={resolvedTheme}
              processing={processing}
              sessionCount={sessions.length}
              errorLogs={errorLogs}
              pwa={pwa}
              onSelectTab={(tab) => openSettings(tab)}
              onUpdateSettings={updateSettings}
              onResetSettings={handleResetSettings}
              onClearErrorLogs={clearErrorLogs}
              onPreloadModel={(id) => void handlePreloadModel(id)}
              onNotify={(title, desc) => pushToast('info', title, desc)}
            />
          </>
        ) : (
          <>
            {/* Top Clinical Header Bar */}
            <header className="topbar no-print">
              <div className="topbar-left">
                <button
                  id="toggle-sidebar-btn"
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Toggle sessions sidebar"
                  onClick={() => {
                    if (window.innerWidth <= DRAWER_MAX_WIDTH) {
                      setMobileDrawerOpen((v) => !v);
                    } else {
                      setSidebarCollapsed((v) => !v);
                    }
                  }}
                >
                  <Menu size={19} />
                </button>

                <h2 className="topbar-session-title" title={activeSession.name}>
                  {activeSession.name}
                </h2>

                <button
                  id="client-info-btn"
                  type="button"
                  className="topbar-client-chip"
                  onClick={() => setShowClientModal(true)}
                  title="Edit Client Info and SALT Header fields"
                >
                  <UserRound size={14} />
                  <span>{clientChipSummary}</span>
                </button>
              </div>

              <div className="topbar-right">
                <OverflowMenu
                  id="app-menu-btn"
                  label="More options"
                  items={[
                    {
                      key: 'client',
                      label: 'Client & sample info',
                      icon: <UserRound size={15} />,
                      onSelect: () => setShowClientModal(true),
                    },
                    {
                      key: 'models',
                      label: 'Speech models',
                      icon: <Cpu size={15} />,
                      onSelect: () => openSettings('models'),
                    },
                    {
                      key: 'help',
                      label: 'Help & SALT guide',
                      icon: <HelpCircle size={15} />,
                      onSelect: () => setShowHelpModal(true),
                    },
                    {
                      key: 'settings',
                      label: 'Settings',
                      icon: <Settings size={15} />,
                      dividerBefore: true,
                      onSelect: () => openSettings('general'),
                    },
                    {
                      key: 'changelog',
                      label: "What's new",
                      icon: <History size={15} />,
                      hint: `v${APP_VERSION}`,
                      onSelect: () => openSettings('changelog'),
                    },
                    ...(errorLogs.length > 0
                      ? [
                          {
                            key: 'logs',
                            label: 'Error log',
                            icon: <Bug size={15} />,
                            hint: String(errorLogs.length),
                            onSelect: () => openSettings('logs'),
                          },
                        ]
                      : []),
                  ]}
                />

                <button
                  id="open-export-btn"
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowExportModal(true)}
                >
                  <Download size={15} />
                  <span>Export</span>
                </button>
              </div>
            </header>

            {/* iPadOS Safari Install Helper Banner */}
            {pwa.isIosOrIpad && !pwa.isStandalone && !iosBannerDismissed && (
              <div className="install-banner no-print">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Share size={15} />
                  <span>
                    Install Saltify on your iPad: tap Safari&apos;s <strong>Share</strong>{' '}
                    button → <strong>Add to Home Screen</strong> for full-screen offline use.
                  </span>
                </span>
                <div className="install-banner-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
                    aria-label="Dismiss iPad install tip"
                    onClick={() => setIosBannerDismissed(true)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Mobile Sticky Mini Audio Bar when viewing Transcript or SALT on Phones */}
            {activeAudioBlob && mobileTab !== 'audio' && (
              <div className="mobile-mini-player no-print">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <button
                    type="button"
                    className="transport-play-btn"
                    style={{ width: 34, height: 34 }}
                    onClick={() => void player.togglePlayPause()}
                    aria-label={player.isPlaying ? 'Pause' : 'Play'}
                  >
                    {player.isPlaying ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeSession.audioMeta?.fileName || 'Recording'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    className={`boost-pill ${!player.muted && player.volume > 1.05 ? 'boosted' : ''}`}
                    onClick={player.cycleBoost}
                    title="Cycle output volume boost"
                  >
                    {player.muted ? 'Mute' : `${Math.round(player.volume * 100)}%`}
                  </button>
                  <span className="transport-time">
                    {formatDurationPadded(player.currentTime)} /{' '}
                    {formatDurationPadded(player.duration)}
                  </span>
                </div>
              </div>
            )}

            {/* Main Workspace Body */}
            <main className="workspace-body">
              <div className={mobileTab !== 'audio' ? 'mobile-hidden' : 'mobile-scroll-slot'}>
                <AudioStudio
                  audioMeta={activeSession.audioMeta}
                  hasAudio={Boolean(activeAudioBlob)}
                  player={player}
                  isRecording={isRecording}
                  isRecordingPaused={isRecordingPaused}
                  recordingSeconds={recordingSeconds}
                  recordingLevel={recordingLevel}
                  processing={processing}
                  modelId={settings.modelId}
                  utteranceTimestamps={utteranceTimestamps}
                  onFileNameChange={(fileName) =>
                    updateActiveSession((s) =>
                      s.audioMeta ? { ...s, audioMeta: { ...s.audioMeta, fileName } } : s
                    )
                  }
                  onUploadFile={handleUploadFile}
                  onStartRecording={() => void handleStartRecording()}
                  onTogglePauseRecording={handleTogglePauseRecording}
                  onStopRecording={() => void handleStopRecording()}
                  onDownloadAudio={() => void handleDownloadAudio()}
                  onToggleTranscribe={handleToggleTranscribe}
                  onOpenModelManager={() => setShowModelModal(true)}
                  onExpandWaveform={() => setShowWaveformModal(true)}
                  onOpenSpectrogram={openSpectrogramAtPlayhead}
                  onEditVocabulary={() => setShowClientModal(true)}
                  vocabularyCount={
                    (activeSession.vocabulary ?? '').split(/[,;\n]+/).filter((w) => w.trim()).length
                  }
                  onLoadDemoSample={handleLoadDemoSample}
                />
              </div>

              <div
                className={`editor-panes ${splitView ? 'split' : 'tabbed'} ${
                  mobileTab === 'audio' || mobileTab === 'metrics' ? 'mobile-hidden' : ''
                }`}
              >
                <div
                  className={`editor-pane-slot ${editorTab === 'transcript' ? 'is-active' : ''} ${
                    mobileTab !== 'transcript' ? 'mobile-hidden' : ''
                  }`}
                >
                  <TranscriptionPane
                    headerLeft={splitView ? splitTranscriptHeader : editorTabsFor('transcript')}
                    wordConfidence={activeSession.wordConfidence}
                    highlightUncertainWords={settings.highlightUncertainWords}
                    onToggleHighlightUncertainWords={() =>
                      updateSettings({ highlightUncertainWords: !settings.highlightUncertainWords })
                    }
                    onInspectLine={activeAudioBlob ? (i) => setSpectrogramLine(i) : undefined}
                    onResolveWord={handleResolveUncertainWord}
                    flagThresholds={flagThresholds}
                    onChangeFlagThresholds={(next) =>
                      updateSettings({
                        uncertainWordThreshold: next.uncertainBelow,
                        disagreementThreshold: next.disagreementBelow,
                      })
                    }
                    secondOpinionLabel={
                      WHISPER_MODELS.find((m) => m.id === activeSession.secondOpinionModelId)
                        ?.shortLabel ?? 'Second model'
                    }
                    text={activeSession.transcriptionText}
                    aliases={activeSession.speakerAliases}
                    hasAudio={Boolean(activeAudioBlob)}
                    currentTime={player.currentTime}
                    disabled={processing !== null}
                    colorPartsOfSpeech={settings.colorCodePartsOfSpeech}
                    showIpaTranscription={settings.showIpaTranscription}
                    onToggleIpaTranscription={() =>
                      updateSettings({ showIpaTranscription: !settings.showIpaTranscription })
                    }
                    onChangeText={(transcriptionText) =>
                      updateActiveSession((s) => ({ ...s, transcriptionText }))
                    }
                    onSeekToTime={(sec) => player.seek(sec, player.isPlaying)}
                    onOpenLabelSpeakers={() => setShowLabelSpeakersModal(true)}
                    onOpenAliases={() => setShowAliasesModal(true)}
                    onLoadDemoSample={handleLoadDemoSample}
                  />
                </div>

                <div
                  className={`editor-pane-slot ${editorTab === 'salt' ? 'is-active' : ''} ${
                    mobileTab !== 'salt' ? 'mobile-hidden' : ''
                  }`}
                >
                  <ConventionPane
                    headerLeft={splitView ? undefined : editorTabsFor('salt')}
                    text={activeSession.conventionText}
                    hasTranscript={activeSession.transcriptionText.trim().length > 0}
                    aliases={activeSession.speakerAliases}
                    grammarActive={grammarActive}
                    grammarCheckPerformed={activeSession.grammarCheckPerformed}
                    morphemesApplied={activeSession.morphemesApplied}
                    currentOriginalLine={currentOriginalLine}
                    correctionDraft={correctionDraft}
                    grammarRemaining={grammarProgress.remaining}
                    grammarTotal={grammarProgress.total}
                    checkAllSentences={checkAllSentences}
                    disabled={processing !== null}
                    onChangeText={(conventionText) =>
                      updateActiveSession((s) => ({ ...s, conventionText }))
                    }
                    onToggleCheckAll={setCheckAllSentences}
                    onStartOrCancelGrammarCheck={handleStartOrCancelGrammarCheck}
                    onChangeCorrectionDraft={setCorrectionDraft}
                    onSubmitCorrection={handleSubmitCorrection}
                    onSkipCorrection={handleSkipCorrection}
                    onAutoApplyAllRemaining={handleAutoApplyAllRemaining}
                    onAddMorphemes={handleAddMorphemes}
                    onTogglePosCodes={handleTogglePosCodes}
                    colorPartsOfSpeech={settings.colorCodePartsOfSpeech}
                    showIpaTranscription={settings.showIpaTranscription}
                    onToggleIpaTranscription={() =>
                      updateSettings({ showIpaTranscription: !settings.showIpaTranscription })
                    }
                    onOpenClauseCoder={() => setShowClauseModal(true)}
                    onQuickCycleLineSi={handleQuickCycleLineSi}
                    onSeekToTime={(sec) => player.seek(sec, player.isPlaying)}
                  />
                </div>
              </div>

              <div className={mobileTab !== 'metrics' ? 'mobile-hidden' : 'mobile-scroll-slot'}>
                <MetricsPanel
                  metrics={metrics}
                  clientInfo={activeSession.clientInfo}
                  onOpenClientInfo={() => setShowClientModal(true)}
                  alwaysExpanded={mobileTab === 'metrics'}
                />
              </div>
            </main>

            {/* Android / Mobile Bottom Tab Navigation */}
            <nav className="mobile-nav no-print" aria-label="Mobile workspace tabs">
              <button
                type="button"
                className={`mobile-nav-btn ${mobileTab === 'audio' ? 'active' : ''}`}
                onClick={() => setMobileTab('audio')}
              >
                {isRecording ? <Activity size={18} /> : <Mic size={18} />}
                <span>Audio</span>
              </button>
              <button
                type="button"
                className={`mobile-nav-btn ${mobileTab === 'transcript' ? 'active' : ''}`}
                onClick={() => setMobileTab('transcript')}
              >
                <FileText size={18} />
                <span>Transcript</span>
              </button>
              <button
                type="button"
                className={`mobile-nav-btn ${mobileTab === 'salt' ? 'active' : ''}`}
                onClick={() => setMobileTab('salt')}
              >
                <SpellCheck size={18} />
                <span>SALT</span>
              </button>
              <button
                type="button"
                className={`mobile-nav-btn ${mobileTab === 'metrics' ? 'active' : ''}`}
                onClick={() => setMobileTab('metrics')}
              >
                <BarChart3 size={18} />
                <span>Metrics</span>
              </button>
            </nav>
          </>
        )}
      </div>

      {/* Drag-and-Drop Audio Overlay */}
      {dragOver && (
        <div
          className="modal-backdrop"
          style={{ pointerEvents: 'none', zIndex: 150 }}
        >
          <div
            className="modal-card"
            style={{ padding: 36, textAlign: 'center', maxWidth: 400 }}
          >
            <h2 style={{ margin: '0 0 8px' }}>Drop Audio File Here</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              WAV, MP3, M4A, MP4, WebM, or OGG — decoded 100% locally.
            </p>
          </div>
        </div>
      )}

      {/* Modals */}
      {showClientModal && (
        <ClientInfoModal
          open
          clientInfo={activeSession.clientInfo}
          aliases={activeSession.speakerAliases}
          vocabulary={activeSession.vocabulary ?? ''}
          onSave={(clientInfo: ClientInfo, vocabulary: string) =>
            updateActiveSession((s) => ({ ...s, clientInfo, vocabulary }))
          }
          onClose={() => setShowClientModal(false)}
        />
      )}

      {showLabelSpeakersModal && (
        <LabelSpeakersModal
          open
          text={activeSession.transcriptionText}
          aliases={activeSession.speakerAliases}
          onApplyText={(transcriptionText) =>
            updateActiveSession((s) => ({ ...s, transcriptionText }))
          }
          onAutoAssignSpeakers={(mode) => void handleAutoAssignSpeakers(mode)}
          onSwapSpeakers={handleSwapSpeakers}
          onClose={() => setShowLabelSpeakersModal(false)}
        />
      )}

      {showAliasesModal && (
        <SpeakerAliasesModal
          open
          aliases={activeSession.speakerAliases}
          onSave={handleSaveAliases}
          onClose={() => setShowAliasesModal(false)}
        />
      )}

      {showClauseModal && (
        <ClauseCoderModal
          open
          text={metricsSourceText}
          aliases={activeSession.speakerAliases}
          hasAudio={Boolean(activeAudioBlob)}
          onApplyText={handleApplyClauseText}
          onSeekToTime={(sec) => player.seek(sec, player.isPlaying)}
          onClose={() => setShowClauseModal(false)}
        />
      )}

      {showExportModal && (
        <ExportModal
          open
          session={activeSession}
          audioBlob={activeAudioBlob}
          includeSaltHeaders={settings.includeSaltHeadersOnExport}
          stripTimestamps={settings.stripTimestampsOnExport}
          defaultConvertToIpa={settings.showIpaTranscription}
          onUpdateExportPrefs={({ includeSaltHeaders, stripTimestamps }) =>
            updateSettings({
              includeSaltHeadersOnExport: includeSaltHeaders,
              stripTimestampsOnExport: stripTimestamps,
            })
          }
          onNotify={(title, desc) => pushToast('success', title, desc)}
          onClose={() => setShowExportModal(false)}
        />
      )}

      <ModelManagerModal
        open={showModelModal}
        settings={settings}
        processing={processing}
        onUpdateSettings={updateSettings}
        onPreloadModel={(id) => void handlePreloadModel(id)}
        onNotify={(title, desc) => pushToast('info', title, desc)}
        onOpenSettings={() => openSettings('models')}
        onClose={() => setShowModelModal(false)}
      />

      {spectrogramLine !== null && (
        <SpectrogramModal
          open
          lines={transcriptLines}
          lineIndex={spectrogramLine}
          onChangeLine={setSpectrogramLine}
          loadSamples={loadSessionSamples}
          player={player}
          wordConfidence={activeSession.wordConfidence}
          flagThresholds={flagThresholds}
          onClose={() => setSpectrogramLine(null)}
        />
      )}

      <WaveformModal
        open={showWaveformModal}
        onClose={() => setShowWaveformModal(false)}
        fileName={activeSession.audioMeta?.fileName ?? activeSession.name}
        peaks={activeSession.audioMeta?.waveformPeaks ?? []}
        currentTime={player.currentTime}
        duration={player.duration}
        markers={utteranceTimestamps}
        onSeek={(sec) => player.seek(sec)}
      />

      <HelpModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
