import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  DownloadCloud,
  Info,
  Menu,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  createDefaultClientInfo,
  createDefaultSpeakerAliases,
  type ClientInfo,
  type GrammarSessionState,
  type ProcessingState,
  type SessionRecord,
  type SpeakerAliases,
  type ThemePreference,
  type WhisperModelId,
} from './types/session';
import {
  clearAllLocalData,
  deleteSessionRecord,
  loadAllSessions,
  loadSessionAudio,
  loadThemePreference,
  loadWhisperModelPreference,
  saveSessionAudio,
  saveSessionRecord,
  saveThemePreference,
  saveWhisperModelPreference,
} from './lib/storage/sessionStore';
import {
  decodeAudioBlob,
  encodeWavFromAudioBuffer,
  extractWaveformPeaks,
} from './lib/audio/wavEncoder';
import { BrowserAudioRecorder } from './lib/audio/recorder';
import { TranscriptionService } from './lib/transcription/transcriptionService';
import {
  addInflectionalMorphemesToTranscript,
  formatCorrectionForConventionBox,
} from './lib/salt/conventions';
import { GrammarChecker } from './lib/salt/grammarEngine';
import { renameSpeakerAliasesInText } from './lib/salt/speakers';
import { SAMPLE_TRANSCRIPT } from './lib/salt/sampleTranscript';
import { Sidebar } from './components/Sidebar';
import { AudioSection } from './components/AudioSection';
import { TranscriptionToolbar } from './components/TranscriptionToolbar';
import { DualTranscriptEditor } from './components/DualTranscriptEditor';
import { MetricsBar } from './components/MetricsBar';
import { LabelSpeakersModal } from './components/LabelSpeakersModal';
import { SpeakerAliasesModal } from './components/SpeakerAliasesModal';
import { ClientInfoModal } from './components/ClientInfoModal';
import { ExportMenuModal } from './components/ExportMenuModal';
import { HelpModal } from './components/HelpModal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface BannerAlert {
  tone: 'error' | 'info' | 'success';
  message: string;
}

const EMPTY_GRAMMAR_STATE: GrammarSessionState = {
  active: false,
  sentences: [],
  currentIndex: 0,
  totalSentences: 0,
  currentSuggestion: '',
  currentOriginal: '',
  currentReasons: [],
};

function createNewSession(sessionNumber: number): SessionRecord {
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const iso = now.toISOString();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: `Session ${sessionNumber} · ${stamp}`,
    createdAt: iso,
    updatedAt: iso,
    fileName: '',
    audioDuration: 0,
    hasAudio: false,
    transcriptionText: '',
    conventionText: '',
    transcriptionLocked: true,
    conventionLocked: true,
    grammarCheckPerformed: false,
    morphemesAdded: false,
    speakerAliases: createDefaultSpeakerAliases(),
    clientInfo: createDefaultClientInfo(),
  };
}

export function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [whisperModel, setWhisperModel] = useState<WhisperModelId>(() =>
    loadWhisperModelPreference()
  );

  // Audio playback & waveform state for active session
  const [activeAudioBlob, setActiveAudioBlob] = useState<Blob | null>(null);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Live microphone recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);

  // Processing & step-by-step grammar check state
  const [processing, setProcessing] = useState<ProcessingState>({
    kind: null,
    stage: '',
    progress: 0,
    cancellable: false,
  });
  const [grammarState, setGrammarState] = useState<GrammarSessionState>(EMPTY_GRAMMAR_STATE);

  // Modals & Alerts
  const [activeModal, setActiveModal] = useState<
    null | 'labelSpeakers' | 'aliases' | 'clientInfo' | 'export' | 'help'
  >(null);
  const [alert, setAlert] = useState<BannerAlert | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Refs for imperative audio/worker engines
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const transcriptionRef = useRef<TranscriptionService | null>(null);
  const grammarCheckerRef = useRef<GrammarChecker | null>(null);
  const playbackRateRef = useRef(playbackRate);

  const getTranscriptionService = useCallback(() => {
    if (!transcriptionRef.current) {
      transcriptionRef.current = new TranscriptionService();
    }
    return transcriptionRef.current;
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId]
  );

  const notify = useCallback((tone: BannerAlert['tone'], message: string) => {
    setAlert({ tone, message });
  }, []);

  // Apply Light / Dark / System theme to document root
  useEffect(() => {
    const applyTheme = () => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme;
      document.documentElement.setAttribute('data-theme', resolved);
    };
    applyTheme();
    saveThemePreference(theme);

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', applyTheme);
      return () => mql.removeEventListener('change', applyTheme);
    }
    return undefined;
  }, [theme]);

  // Capture Android/Windows PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Load persisted sessions from IndexedDB on initial mount
  useEffect(() => {
    let cancelled = false;
    loadAllSessions().then((loaded) => {
      if (cancelled) return;
      if (loaded.length > 0) {
        setSessions(loaded);
        setActiveSessionId(loaded[loaded.length - 1].id);
      } else {
        const first = createNewSession(1);
        setSessions([first]);
        setActiveSessionId(first.id);
        void saveSessionRecord(first);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Helper to update the active session immutably and persist to IndexedDB
  const updateSession = useCallback(
    (sessionId: string, updater: (prev: SessionRecord) => SessionRecord) => {
      setSessions((prevList) =>
        prevList.map((item) => {
          if (item.id !== sessionId) return item;
          const updated: SessionRecord = {
            ...updater(item),
            updatedAt: new Date().toISOString(),
          };
          void saveSessionRecord(updated);
          return updated;
        })
      );
    },
    []
  );

  // Sync external HTMLAudioElement & IndexedDB audio blob whenever active session changes
  useEffect(() => {
    let cancelled = false;

    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    grammarCheckerRef.current = null;

    if (!activeSessionId) {
      return;
    }

    loadSessionAudio(activeSessionId).then(async (blob) => {
      if (cancelled) return;
      setIsPlaying(false);
      setCurrentTime(0);
      setGrammarState(EMPTY_GRAMMAR_STATE);

      if (!blob) {
        setActiveAudioBlob(null);
        setAudioPeaks([]);
        setDuration(0);
        return;
      }

      setActiveAudioBlob(blob);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      if (audioElRef.current) {
        audioElRef.current.src = url;
        audioElRef.current.playbackRate = playbackRateRef.current;
      }

      try {
        const decoded = await decodeAudioBlob(blob);
        if (!cancelled) {
          setDuration(decoded.duration);
          setAudioPeaks(extractWaveformPeaks(decoded, 180));
        }
      } catch {
        // Fallback: audio element metadata will still report duration
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // Keep playbackRate synced on audio element without reloading audio
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (audioElRef.current) {
      audioElRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Cleanup recorder & worker on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      transcriptionRef.current?.cancel();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const bindNewAudioBlob = useCallback(
    async (sessionId: string, wavBlob: Blob, audioDuration: number, peaks: number[], fileName: string) => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      const url = URL.createObjectURL(wavBlob);
      audioUrlRef.current = url;

      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = url;
        audioElRef.current.playbackRate = playbackRate;
        audioElRef.current.currentTime = 0;
      }

      setActiveAudioBlob(wavBlob);
      setAudioPeaks(peaks);
      setDuration(audioDuration);
      setCurrentTime(0);
      setIsPlaying(false);

      await saveSessionAudio(sessionId, wavBlob);
      updateSession(sessionId, (s) => ({
        ...s,
        fileName,
        audioDuration,
        hasAudio: true,
      }));
    },
    [playbackRate, updateSession]
  );

  // ==================== SESSION HANDLERS ====================
  const handleCreateSession = () => {
    if (isRecording) {
      notify('info', 'Stop the active recording before starting a new session.');
      return;
    }
    if (processing.kind) {
      transcriptionRef.current?.cancel();
      setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });
    }
    const next = createNewSession(sessions.length + 1);
    setSessions((prev) => [...prev, next]);
    setActiveSessionId(next.id);
    void saveSessionRecord(next);
    setAlert(null);
  };

  const handleRenameSession = (id: string, nextName: string) => {
    updateSession(id, (s) => ({ ...s, name: nextName }));
  };

  const handleDeleteSession = (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    if (!window.confirm(`Delete "${target.name}" and its local audio recording?`)) {
      return;
    }
    if (id === activeSessionId && processing.kind) {
      transcriptionRef.current?.cancel();
      setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });
    }
    void deleteSessionRecord(id);

    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = createNewSession(1);
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      void saveSessionRecord(fresh);
    } else {
      setSessions(remaining);
      if (id === activeSessionId) {
        setActiveSessionId(remaining[remaining.length - 1].id);
      }
    }
  };

  const handleClearAllLocalData = async () => {
    if (
      !window.confirm(
        'Erase ALL sessions, transcripts, client info, and audio recordings stored on this device?'
      )
    ) {
      return;
    }
    recorderRef.current?.cancel();
    transcriptionRef.current?.cancel();
    setIsRecording(false);
    setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });
    await clearAllLocalData();

    const fresh = createNewSession(1);
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setActiveAudioBlob(null);
    setAudioPeaks([]);
    setDuration(0);
    setCurrentTime(0);
    void saveSessionRecord(fresh);
    notify('success', 'All local sessions and audio recordings were cleared from this browser.');
  };

  // ==================== AUDIO CAPTURE & PLAYBACK ====================
  const handleUploadFile = async (file: File) => {
    if (!activeSession) return;
    setAlert(null);
    try {
      const decoded = await decodeAudioBlob(file);
      if (decoded.duration <= 0.05) {
        throw new Error('The selected audio file appears to be empty.');
      }
      const wavBlob = encodeWavFromAudioBuffer(decoded, false);
      const peaks = extractWaveformPeaks(decoded, 180);
      await bindNewAudioBlob(activeSession.id, wavBlob, decoded.duration, peaks, file.name);
      notify('success', `Loaded "${file.name}" (${Math.round(decoded.duration)}s). Ready to play or transcribe.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(
        'error',
        `Could not load audio file: ${msg}. Try a standard WAV, MP3, or M4A recording.`
      );
    }
  };

  const handleToggleRecord = async () => {
    if (!activeSession) return;
    setAlert(null);

    if (!isRecording) {
      if (audioElRef.current && !audioElRef.current.paused) {
        audioElRef.current.pause();
        setIsPlaying(false);
      }
      const recorder = new BrowserAudioRecorder();
      recorderRef.current = recorder;
      try {
        setRecordingSeconds(0);
        setRecordingLevel(0);
        await recorder.start((level, elapsed) => {
          setRecordingLevel(level);
          setRecordingSeconds(elapsed);
        });
        setIsRecording(true);
      } catch (err) {
        recorderRef.current = null;
        notify('error', err instanceof Error ? err.message : String(err));
      }
    } else {
      setIsRecording(false);
      setRecordingLevel(0);
      try {
        const result = await recorderRef.current!.stop();
        recorderRef.current = null;
        const name = activeSession.fileName.trim() || 'Live_Recording.wav';
        await bindNewAudioBlob(
          activeSession.id,
          result.wavBlob,
          result.duration,
          result.peaks,
          name
        );
        notify('success', `Recording saved locally (${result.duration.toFixed(1)}s).`);
      } catch (err) {
        recorderRef.current = null;
        notify('error', err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleTogglePlay = async () => {
    const audio = audioElRef.current;
    if (!audio || !activeAudioBlob) return;
    try {
      if (audio.paused) {
        await audio.play();
        setIsPlaying(true);
      } else {
        audio.pause();
        setIsPlaying(false);
      }
    } catch (err) {
      notify('error', `Audio playback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSeek = (seconds: number) => {
    const audio = audioElRef.current;
    if (!audio || !activeAudioBlob) return;
    const clamped = Math.max(0, Math.min(seconds, duration || audio.duration || 0));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const handleSeekAndPlay = (seconds: number) => {
    handleSeek(seconds);
    const audio = audioElRef.current;
    if (audio && audio.paused && activeAudioBlob) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // ==================== ON-DEVICE WHISPER TRANSCRIPTION ====================
  const handleToggleTranscribe = async () => {
    if (!activeSession) return;

    if (processing.kind === 'transcription') {
      transcriptionRef.current?.cancel();
      setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });
      notify('info', 'Transcription cancelled.');
      return;
    }

    if (!activeAudioBlob) {
      notify('error', 'Upload or record an audio file before transcribing.');
      return;
    }

    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
      setIsPlaying(false);
    }

    setAlert(null);
    setProcessing({
      kind: 'transcription',
      stage: 'Preparing & normalizing audio...',
      progress: 0.03,
      cancellable: true,
    });

    const targetSessionId = activeSession.id;

    try {
      const transcript = await getTranscriptionService().transcribeBlob(
        activeAudioBlob,
        whisperModel,
        {
          onProgress: (stage, progress) => {
            setProcessing({
              kind: 'transcription',
              stage,
              progress,
              cancellable: true,
            });
          },
        }
      );

      setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });

      if (!transcript.trim()) {
        notify(
          'info',
          'No speech was detected in this recording. Check the audio volume or try a larger Whisper model.'
        );
        return;
      }

      updateSession(targetSessionId, (s) => ({
        ...s,
        transcriptionText: transcript,
        transcriptionLocked: true,
      }));
      notify('success', 'On-device transcription complete. Click any [m:ss] timestamp to jump playback.');
    } catch (err) {
      setProcessing({ kind: null, stage: '', progress: 0, cancellable: false });
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  // ==================== SPEAKER ALIASES & LABELS ====================
  const handleSaveAliases = (nextAliases: SpeakerAliases) => {
    if (!activeSession) return;
    const prevAliases = activeSession.speakerAliases;
    updateSession(activeSession.id, (s) => ({
      ...s,
      speakerAliases: nextAliases,
      transcriptionText: renameSpeakerAliasesInText(s.transcriptionText, prevAliases, nextAliases),
      conventionText: renameSpeakerAliasesInText(s.conventionText, prevAliases, nextAliases),
    }));
    notify('success', `Updated speaker aliases to "${nextAliases.speaker1}" and "${nextAliases.speaker2}".`);
  };

  // ==================== STEP-BY-STEP SALT GRAMMAR CHECK ====================
  const advanceGrammarStep = useCallback(
    (sessionId: string, accumulatedConvention: string) => {
      const checker = grammarCheckerRef.current;
      if (!checker) return;

      const step = checker.getNextCorrection();
      const nextConvention = accumulatedConvention + step.passedThrough;

      updateSession(sessionId, (s) => ({
        ...s,
        conventionText: nextConvention.trimEnd(),
        grammarCheckPerformed: step.done ? true : s.grammarCheckPerformed,
      }));

      if (step.done || step.nextSuggestion === null) {
        setGrammarState(EMPTY_GRAMMAR_STATE);
        grammarCheckerRef.current = null;
        notify(
          'success',
          'Grammar check complete! Click "Add Morphemes" next to apply SALT bound inflectional morphemes.'
        );
      } else {
        const total = checker.getTotalCount();
        const reviewed = total - checker.getRemainingCount();
        setGrammarState({
          active: true,
          sentences: [],
          currentIndex: reviewed,
          totalSentences: total,
          currentSuggestion: step.nextSuggestion,
          currentOriginal: step.nextOriginal ?? step.nextSuggestion,
          currentReasons: step.reasons,
        });
      }
    },
    [notify, updateSession]
  );

  const handleToggleGrammarCheck = () => {
    if (!activeSession) return;
    if (grammarState.active) {
      setGrammarState(EMPTY_GRAMMAR_STATE);
      grammarCheckerRef.current = null;
      notify('info', 'Grammar check paused. You can re-run it anytime.');
      return;
    }

    if (!activeSession.transcriptionText.trim()) {
      notify('error', 'Transcribe or enter text before running Grammar Check.');
      return;
    }

    const checker = new GrammarChecker();
    checker.start(activeSession.transcriptionText, false, [
      activeSession.speakerAliases.speaker1,
      activeSession.speakerAliases.speaker2,
    ]);
    grammarCheckerRef.current = checker;
    setAlert(null);

    updateSession(activeSession.id, (s) => ({
      ...s,
      conventionText: '',
      grammarCheckPerformed: false,
      morphemesAdded: false,
    }));

    advanceGrammarStep(activeSession.id, '');
  };

  const handleSubmitGrammarLine = (lineText: string) => {
    if (!activeSession) return;
    const formatted = formatCorrectionForConventionBox(lineText);
    const base = activeSession.conventionText.trimEnd();
    const updatedConvention = base ? `${base}\n${formatted}` : formatted;
    advanceGrammarStep(activeSession.id, updatedConvention);
  };

  // ==================== SALT INFLECTIONAL MORPHEMES ====================
  const handleAddMorphemes = () => {
    if (!activeSession) return;
    const source = activeSession.conventionText.trim()
      ? activeSession.conventionText
      : activeSession.transcriptionText;

    if (!source.trim()) {
      notify('error', 'No transcript available to tag morphemes.');
      return;
    }

    const coded = addInflectionalMorphemesToTranscript(source, [
      activeSession.speakerAliases.speaker1,
      activeSession.speakerAliases.speaker2,
    ]);

    updateSession(activeSession.id, (s) => ({
      ...s,
      conventionText: coded,
      conventionLocked: true,
      morphemesAdded: true,
    }));
    notify('success', 'Applied SALT inflectional morphemes (/s, /z, /ed, /3s, /ing, contractions).');
  };

  const handleLoadSample = () => {
    if (!activeSession) return;
    updateSession(activeSession.id, (s) => ({
      ...s,
      name: s.name.startsWith('Session') ? 'Sample Child Narrative' : s.name,
      fileName: s.fileName || 'Sample_Story_Retell',
      transcriptionText: SAMPLE_TRANSCRIPT,
      conventionText: '',
      transcriptionLocked: true,
      grammarCheckPerformed: false,
      morphemesAdded: false,
    }));
    notify(
      'info',
      'Loaded a sample child-examiner narrative. Try clicking "Grammar Check" and then "Add Morphemes"!'
    );
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
      notify('success', 'Saltify Web has been installed on your device!');
    }
  };

  const metricsSourceText =
    activeSession && activeSession.conventionText.trim()
      ? activeSession.conventionText
      : activeSession?.transcriptionText ?? '';
  const metricsSourceLabel =
    activeSession && activeSession.conventionText.trim() ? 'Conventions' : 'Transcript';

  const exportText =
    activeSession && activeSession.conventionText.trim()
      ? activeSession.conventionText
      : activeSession?.transcriptionText ?? '';
  const exportSourceLabel =
    activeSession && activeSession.conventionText.trim()
      ? 'SALT Convention Box'
      : 'Transcription Box';

  return (
    <div className="app-shell">
      {/* Hidden native audio element for rock-solid cross-platform playback on iPad, Android & Windows */}
      <audio
        ref={audioElRef}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSession?.id ?? ''}
        isOpen={sidebarOpen}
        theme={theme}
        onClose={() => setSidebarOpen(false)}
        onSelectSession={setActiveSessionId}
        onCreateSession={handleCreateSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onChangeTheme={setTheme}
        onOpenClientInfo={() => setActiveModal('clientInfo')}
        onOpenHelp={() => setActiveModal('help')}
        onClearAllData={handleClearAllLocalData}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              id="btn-toggle-sidebar"
              type="button"
              className="icon-btn menu-toggle-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sessions menu"
            >
              <Menu size={20} />
            </button>
            <div className="topbar-title-group">
              <h1 className="workspace-title">{activeSession?.name ?? 'Saltify Web'}</h1>
            </div>
            <span className="privacy-pill" title="Audio and transcripts stay 100% inside your device">
              <ShieldCheck size={13} aria-hidden="true" />
              On-Device · Offline Ready
            </span>
          </div>

          <div className="topbar-right">
            {installPrompt && (
              <button
                id="btn-install-pwa"
                type="button"
                className="btn btn-sm"
                onClick={handleInstallPwa}
              >
                <DownloadCloud size={14} aria-hidden="true" />
                Install App
              </button>
            )}

            {activeSession && !activeSession.transcriptionText.trim() && (
              <button
                id="btn-topbar-sample"
                type="button"
                className="btn btn-sm"
                onClick={handleLoadSample}
                title="Load a sample child language transcript to explore SALT coding"
              >
                <Sparkles size={14} aria-hidden="true" />
                Sample
              </button>
            )}

            <button
              id="btn-topbar-client-info"
              type="button"
              className="btn btn-sm"
              onClick={() => setActiveModal('clientInfo')}
              title="Edit Client & Sample metadata for .slt and .docx headers"
            >
              <UserRound size={14} aria-hidden="true" />
              Client
            </button>

            <button
              id="btn-topbar-export"
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!activeSession || (!exportText.trim() && !activeAudioBlob)}
              onClick={() => setActiveModal('export')}
            >
              <Download size={14} aria-hidden="true" />
              Export
            </button>
          </div>
        </header>

        <div className="workspace-scroll">
          {alert && (
            <div className={`alert-banner is-${alert.tone}`} role="status" aria-live="polite">
              <div className="alert-left">
                {alert.tone === 'error' && <AlertCircle size={16} aria-hidden="true" />}
                {alert.tone === 'success' && <CheckCircle2 size={16} aria-hidden="true" />}
                {alert.tone === 'info' && <Info size={16} aria-hidden="true" />}
                <span>{alert.message}</span>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => setAlert(null)}
                aria-label="Dismiss message"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {activeSession && (
            <>
              <AudioSection
                fileName={activeSession.fileName}
                hasAudio={Boolean(activeAudioBlob)}
                isRecording={isRecording}
                recordingSeconds={recordingSeconds}
                recordingLevel={recordingLevel}
                peaks={audioPeaks}
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                isProcessing={processing.kind !== null}
                onChangeFileName={(name) =>
                  updateSession(activeSession.id, (s) => ({ ...s, fileName: name }))
                }
                onUploadFile={handleUploadFile}
                onToggleRecord={handleToggleRecord}
                onTogglePlay={handleTogglePlay}
                onSeek={handleSeek}
                onRestart={() => handleSeek(0)}
                onStep={(delta) => handleSeek(currentTime + delta)}
                onChangeRate={setPlaybackRate}
              />

              <TranscriptionToolbar
                hasAudio={Boolean(activeAudioBlob)}
                hasTranscript={Boolean(activeSession.transcriptionText.trim())}
                hasConventions={Boolean(activeSession.conventionText.trim())}
                isRecording={isRecording}
                grammarActive={grammarState.active}
                processing={processing}
                whisperModel={whisperModel}
                onChangeWhisperModel={(model) => {
                  setWhisperModel(model);
                  saveWhisperModelPreference(model);
                }}
                onToggleTranscribe={handleToggleTranscribe}
                onOpenLabelSpeakers={() => setActiveModal('labelSpeakers')}
                onOpenAliases={() => setActiveModal('aliases')}
                onToggleGrammarCheck={handleToggleGrammarCheck}
                onAddMorphemes={handleAddMorphemes}
              />

              <DualTranscriptEditor
                transcriptionText={activeSession.transcriptionText}
                conventionText={activeSession.conventionText}
                transcriptionLocked={activeSession.transcriptionLocked}
                conventionLocked={activeSession.conventionLocked}
                hasAudio={Boolean(activeAudioBlob)}
                aliases={activeSession.speakerAliases}
                grammarState={grammarState}
                onChangeTranscription={(value) =>
                  updateSession(activeSession.id, (s) => ({ ...s, transcriptionText: value }))
                }
                onChangeConvention={(value) =>
                  updateSession(activeSession.id, (s) => ({ ...s, conventionText: value }))
                }
                onToggleTranscriptionLock={() =>
                  updateSession(activeSession.id, (s) => ({
                    ...s,
                    transcriptionLocked: !s.transcriptionLocked,
                  }))
                }
                onToggleConventionLock={() =>
                  updateSession(activeSession.id, (s) => ({
                    ...s,
                    conventionLocked: !s.conventionLocked,
                  }))
                }
                onClearTranscription={() =>
                  updateSession(activeSession.id, (s) => ({ ...s, transcriptionText: '' }))
                }
                onClearConvention={() =>
                  updateSession(activeSession.id, (s) => ({
                    ...s,
                    conventionText: '',
                    grammarCheckPerformed: false,
                    morphemesAdded: false,
                  }))
                }
                onSeekToTimestamp={handleSeekAndPlay}
                onLoadSample={handleLoadSample}
                onChangeGrammarDraft={(value) =>
                  setGrammarState((prev) => ({ ...prev, currentSuggestion: value }))
                }
                onSubmitGrammarCorrection={() =>
                  handleSubmitGrammarLine(grammarState.currentSuggestion)
                }
                onKeepOriginalSentence={() =>
                  handleSubmitGrammarLine(grammarState.currentOriginal)
                }
              />

              <MetricsBar
                sourceText={metricsSourceText}
                sourceLabel={metricsSourceLabel}
                aliases={activeSession.speakerAliases}
              />
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      {activeModal === 'labelSpeakers' && activeSession && (
        <LabelSpeakersModal
          transcriptText={activeSession.transcriptionText}
          aliases={activeSession.speakerAliases}
          onApply={(updated) =>
            updateSession(activeSession.id, (s) => ({ ...s, transcriptionText: updated }))
          }
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'aliases' && activeSession && (
        <SpeakerAliasesModal
          aliases={activeSession.speakerAliases}
          onSave={handleSaveAliases}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'clientInfo' && activeSession && (
        <ClientInfoModal
          clientInfo={activeSession.clientInfo}
          onSave={(info: ClientInfo) => {
            updateSession(activeSession.id, (s) => ({ ...s, clientInfo: info }));
            notify('success', 'Saved client metadata locally for this session.');
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'export' && activeSession && (
        <ExportMenuModal
          sessionName={activeSession.name}
          fileName={activeSession.fileName}
          exportText={exportText}
          exportSourceLabel={exportSourceLabel}
          clientInfo={activeSession.clientInfo}
          aliases={activeSession.speakerAliases}
          audioBlob={activeAudioBlob}
          onClose={() => setActiveModal(null)}
          onNotify={(msg) => notify('success', msg)}
        />
      )}

      {activeModal === 'help' && <HelpModal onClose={() => setActiveModal(null)} />}
    </div>
  );
}

export default App;
