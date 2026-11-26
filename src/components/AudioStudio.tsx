import {
  AudioLines,
  BookText,
  Cpu,
  Download,
  Maximize2,
  Mic,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Upload,
  Volume1,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useRef } from 'react';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import { formatDurationPadded } from '../engine/transcriptFormat';
import {
  MAX_PLAYBACK_BOOST,
  type AudioPlayerState,
} from '../hooks/useAudioPlayer';
import {
  WHISPER_MODELS,
  type AudioMetadata,
  type ProcessingState,
  type WhisperModelId,
} from '../types/saltify';
import { WaveformCanvas } from './WaveformCanvas';

interface AudioStudioProps {
  audioMeta: AudioMetadata | null;
  hasAudio: boolean;
  player: AudioPlayerState;
  isRecording: boolean;
  isRecordingPaused: boolean;
  recordingSeconds: number;
  recordingLevel: number;
  processing: ProcessingState | null;
  modelId: WhisperModelId;
  utteranceTimestamps: number[];
  onFileNameChange: (name: string) => void;
  onUploadFile: (file: File) => void;
  onStartRecording: () => void;
  onTogglePauseRecording: () => void;
  onStopRecording: () => void;
  onDownloadAudio: () => void;
  onToggleTranscribe: () => void;
  onOpenModelManager: () => void;
  onExpandWaveform: () => void;
  onOpenSpectrogram?: () => void;
  /** Opens the session's expected-words (vocabulary hint) editor. */
  onEditVocabulary?: () => void;
  /** Number of expected words currently set for this session. */
  vocabularyCount?: number;
  onLoadDemoSample: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5];

export function AudioStudio({
  audioMeta,
  hasAudio,
  player,
  isRecording,
  isRecordingPaused,
  recordingSeconds,
  recordingLevel,
  processing,
  modelId,
  utteranceTimestamps,
  onFileNameChange,
  onUploadFile,
  onStartRecording,
  onTogglePauseRecording,
  onStopRecording,
  onDownloadAudio,
  onToggleTranscribe,
  onOpenModelManager,
  onExpandWaveform,
  onOpenSpectrogram,
  onEditVocabulary,
  vocabularyCount = 0,
  onLoadDemoSample,
}: AudioStudioProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentModel =
    WHISPER_MODELS.find((m) => m.id === modelId) ?? WHISPER_MODELS[0];
  const isTranscribing = processing?.kind === 'transcription';
  const isBusyOther = processing !== null && !isTranscribing;

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(player.playbackRate);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    player.setPlaybackRate(next);
  };

  const canPlay = hasAudio && !isRecording;
  const boosted = !player.muted && player.volume > 1.05;

  const audioMenuItems: OverflowMenuItem[] = [
    {
      key: 'volume',
      label: 'Volume',
      render: () => (
        <div className="audio-menu-volume" aria-label="Output volume and boost">
          <button
            id="audio-mute-btn"
            type="button"
            className="btn btn-ghost btn-icon"
            title={player.muted || player.volume === 0 ? 'Unmute audio' : 'Mute audio'}
            aria-label={player.muted || player.volume === 0 ? 'Unmute audio' : 'Mute audio'}
            disabled={!canPlay}
            onClick={player.toggleMute}
          >
            {player.muted || player.volume === 0 ? (
              <VolumeX size={15} />
            ) : player.volume <= 1 ? (
              <Volume1 size={15} />
            ) : (
              <Volume2 size={15} style={{ color: 'var(--warning)' }} />
            )}
          </button>
          <input
            id="audio-volume-slider"
            type="range"
            className={`volume-slider ${boosted ? 'boosted' : ''}`}
            min={0}
            max={MAX_PLAYBACK_BOOST}
            step={0.1}
            value={player.muted ? 0 : player.volume}
            disabled={!canPlay}
            aria-label="Output volume boost from 0% to 400%"
            onChange={(e) => player.setVolume(parseFloat(e.target.value))}
          />
          <span className="mono audio-menu-volume-val">
            {player.muted ? 'Mute' : `${Math.round(player.volume * 100)}%`}
          </span>
        </div>
      ),
    },
    {
      key: 'restart',
      label: 'Restart from beginning',
      icon: <RotateCcw size={15} />,
      disabled: !canPlay,
      onSelect: player.restart,
      dividerBefore: true,
    },
    {
      key: 'expand',
      label: 'Large waveform',
      icon: <Maximize2 size={15} />,
      disabled: !hasAudio,
      onSelect: onExpandWaveform,
    },
    ...(onOpenSpectrogram
      ? [
          {
            key: 'spectrogram',
            label: 'Spectrogram & formants',
            icon: <AudioLines size={15} />,
            disabled: !hasAudio || isRecording,
            onSelect: onOpenSpectrogram,
          },
        ]
      : []),
    {
      key: 'rename',
      label: 'Rename audio',
      icon: <Pencil size={15} />,
      disabled: !hasAudio,
      onSelect: () => {
        const next = window.prompt('Audio file name', audioMeta?.fileName ?? '');
        if (next !== null && next.trim()) onFileNameChange(next.trim());
      },
    },
    {
      key: 'download',
      label: 'Download WAV',
      icon: <Download size={15} />,
      disabled: !hasAudio || isRecording || processing !== null,
      onSelect: onDownloadAudio,
    },
    ...(onEditVocabulary
      ? [
          {
            key: 'vocabulary',
            label: 'Expected words…',
            hint: vocabularyCount > 0 ? `${vocabularyCount} set` : 'none',
            icon: <BookText size={15} />,
            dividerBefore: true,
            onSelect: onEditVocabulary,
          },
        ]
      : []),
    {
      key: 'sample',
      label: 'Load demo sample',
      icon: <Sparkles size={15} />,
      dividerBefore: true,
      disabled: processing !== null || isRecording,
      onSelect: onLoadDemoSample,
    },
  ];

  return (
    <section className="audio-studio" aria-label="Audio recording and playback">
      <div className="audio-bar">
        {/* Capture: record / upload, or live recording meter */}
        <div className="audio-bar-capture">
          {!isRecording ? (
            <>
              <button
                id="record-audio-btn"
                type="button"
                className="btn btn-danger-soft btn-sm"
                disabled={processing !== null}
                onClick={onStartRecording}
                title={hasAudio ? 'Record again (replaces current audio)' : 'Record from microphone'}
              >
                <Mic size={15} />
                <span>{hasAudio ? 'Re-record' : 'Record'}</span>
              </button>
              <button
                id="upload-audio-btn"
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={processing !== null}
                onClick={() => fileInputRef.current?.click()}
                title={hasAudio ? 'Replace audio with a file' : 'Upload an audio file'}
              >
                <Upload size={15} />
                <span>{hasAudio ? 'Replace' : 'Upload'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.aac,.flac"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUploadFile(file);
                    e.target.value = '';
                  }
                }}
              />
            </>
          ) : (
            <div className="live-meter-wrap" role="status" aria-live="polite">
              <span className="rec-dot" />
              <span className="mono">{formatDurationPadded(recordingSeconds)}</span>
              <div className="live-meter-bar" aria-hidden="true">
                <div
                  className="live-meter-fill"
                  style={{ width: `${Math.max(4, Math.round(recordingLevel * 100))}%` }}
                />
              </div>
              <button
                id="pause-recording-btn"
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onTogglePauseRecording}
              >
                {isRecordingPaused ? <Play size={14} /> : <Pause size={14} />}
                <span>{isRecordingPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                id="stop-recording-btn"
                type="button"
                className="btn btn-danger btn-sm"
                onClick={onStopRecording}
              >
                <Square size={13} fill="currentColor" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>

        {/* Transport */}
        <div className="audio-bar-transport">
          <button
            id="audio-rewind-btn"
            type="button"
            className="btn btn-ghost btn-icon"
            title="Back 5 seconds"
            aria-label="Rewind 5 seconds"
            disabled={!canPlay}
            onClick={() => player.skip(-5)}
          >
            <SkipBack size={16} />
          </button>
          <button
            id="audio-play-pause-btn"
            type="button"
            className="transport-play-btn"
            title={player.isPlaying ? 'Pause' : 'Play'}
            aria-label={player.isPlaying ? 'Pause audio' : 'Play audio'}
            disabled={!canPlay}
            onClick={() => void player.togglePlayPause()}
          >
            {player.isPlaying ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />
            )}
          </button>
          <button
            id="audio-forward-btn"
            type="button"
            className="btn btn-ghost btn-icon"
            title="Forward 5 seconds"
            aria-label="Forward 5 seconds"
            disabled={!canPlay}
            onClick={() => player.skip(5)}
          >
            <SkipForward size={16} />
          </button>
          <span className="transport-time">
            {formatDurationPadded(player.currentTime)} /{' '}
            {hasAudio ? formatDurationPadded(player.duration) : '--:--'}
          </span>
        </div>

        {/* Waveform (tap to seek) */}
        <div className="audio-bar-wave" title={audioMeta?.fileName || undefined}>
          <WaveformCanvas
            peaks={audioMeta?.waveformPeaks ?? []}
            currentTime={player.currentTime}
            duration={player.duration}
            markers={utteranceTimestamps}
            onSeek={(sec) => player.seek(sec)}
            disabled={!canPlay}
          />
        </div>

        {/* Speed, volume, more, transcribe */}
        <div className="audio-bar-end">
          <button
            id="playback-speed-btn"
            type="button"
            className="speed-pill"
            disabled={!canPlay}
            onClick={cycleSpeed}
            title="Playback speed (tap to change)"
          >
            {player.playbackRate}x
          </button>
          <button
            id="audio-boost-pill-btn"
            type="button"
            className={`boost-pill ${boosted ? 'boosted' : ''}`}
            disabled={!canPlay}
            onClick={player.cycleBoost}
            title="Volume boost (tap to cycle 100–400%; fine control in the ⋯ menu)"
          >
            {player.muted ? 'Mute' : `${Math.round(player.volume * 100)}%`}
          </button>
          <OverflowMenu id="audio-menu-btn" label="Audio options" items={audioMenuItems} />

          <div className="transcribe-group">
            <button
              id="transcribe-btn"
              type="button"
              className={`btn btn-sm transcribe-main-btn ${isTranscribing ? 'btn-danger' : 'btn-primary'}`}
              disabled={(!hasAudio && !isTranscribing) || isRecording || isBusyOther}
              onClick={onToggleTranscribe}
            >
              {isTranscribing ? <XCircle size={16} /> : <Sparkles size={15} />}
              <span>{isTranscribing ? 'Cancel' : 'Transcribe'}</span>
            </button>
            <button
              id="model-chip-btn"
              type="button"
              className="model-selector-chip"
              onClick={onOpenModelManager}
              title={`Speech model: ${currentModel.shortLabel} (${currentModel.sizeLabel}). Tap to change.`}
            >
              <Cpu size={13} />
              <span>{currentModel.shortLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Progress Bar during Transcription / Model Download / Grammar Check */}
      {processing && (
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
              style={{ width: `${Math.max(3, Math.round(processing.progress * 100))}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
