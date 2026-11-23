import {
  Cpu,
  Download,
  FileAudio,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Upload,
  XCircle,
} from 'lucide-react';
import { useRef } from 'react';
import { formatDurationPadded } from '../engine/transcriptFormat';
import type { AudioPlayerState } from '../hooks/useAudioPlayer';
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

  return (
    <section className="audio-studio" aria-label="Audio recording and playback studio">
      <div className="audio-studio-top">
        {/* Left: File name + Capture / Upload */}
        <div className="audio-source-block">
          <div className="audio-filename-row">
            <FileAudio size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              id="audio-filename-input"
              type="text"
              className="audio-filename-input"
              value={audioMeta?.fileName ?? ''}
              placeholder="Recording or audio file name..."
              aria-label="Audio file name"
              disabled={!hasAudio}
              onChange={(e) => onFileNameChange(e.target.value)}
            />
            {hasAudio && (
              <button
                id="download-audio-btn"
                type="button"
                className="btn btn-subtle btn-icon"
                title="Download normalized WAV audio"
                aria-label="Download WAV audio"
                disabled={isRecording || processing !== null}
                onClick={onDownloadAudio}
              >
                <Download size={16} />
              </button>
            )}
          </div>

          {!isRecording ? (
            <div className="audio-capture-row">
              <button
                id="record-audio-btn"
                type="button"
                className="btn btn-danger-soft btn-sm"
                disabled={processing !== null}
                onClick={onStartRecording}
              >
                <Mic size={15} />
                <span>{hasAudio ? 'Re-Record' : 'Record'}</span>
              </button>

              <button
                id="upload-audio-btn"
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={processing !== null}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={15} />
                <span>{hasAudio ? 'Replace Audio' : 'Upload Audio'}</span>
              </button>

              {!hasAudio && (
                <button
                  id="load-demo-sample-btn"
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={processing !== null}
                  onClick={onLoadDemoSample}
                  title="Load a sample child language transcript to try SALT coding immediately"
                >
                  <Sparkles size={14} />
                  <span>Try Sample</span>
                </button>
              )}

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
            </div>
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

        {/* Center: Interactive Waveform + Transport */}
        <div className="audio-playback-block">
          <WaveformCanvas
            peaks={audioMeta?.waveformPeaks ?? []}
            currentTime={player.currentTime}
            duration={player.duration}
            markers={utteranceTimestamps}
            onSeek={(sec) => player.seek(sec)}
            disabled={!hasAudio || isRecording}
            onExpand={hasAudio ? onExpandWaveform : undefined}
          />

          <div className="transport-row">
            <div className="transport-buttons">
              <button
                id="audio-restart-btn"
                type="button"
                className="btn btn-ghost btn-icon"
                title="Restart (00:00)"
                aria-label="Restart audio"
                disabled={!hasAudio || isRecording}
                onClick={player.restart}
              >
                <RotateCcw size={16} />
              </button>
              <button
                id="audio-rewind-btn"
                type="button"
                className="btn btn-ghost btn-icon"
                title="Rewind 5 seconds"
                aria-label="Rewind 5 seconds"
                disabled={!hasAudio || isRecording}
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
                disabled={!hasAudio || isRecording}
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
                disabled={!hasAudio || isRecording}
                onClick={() => player.skip(5)}
              >
                <SkipForward size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                id="playback-speed-btn"
                type="button"
                className="speed-pill"
                disabled={!hasAudio || isRecording}
                onClick={cycleSpeed}
                title="Adjust playback speed for clinical verification"
              >
                {player.playbackRate}x
              </button>
              <span className="transport-time">
                {formatDurationPadded(player.currentTime)} /{' '}
                {hasAudio ? formatDurationPadded(player.duration) : '--:--'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: On-Device Transcribe Action */}
        <div className="transcribe-cta-block">
          <button
            id="transcribe-btn"
            type="button"
            className={`btn transcribe-main-btn ${
              isTranscribing ? 'btn-danger' : 'btn-primary'
            }`}
            disabled={(!hasAudio && !isTranscribing) || isRecording || isBusyOther}
            onClick={onToggleTranscribe}
          >
            {isTranscribing ? (
              <>
                <XCircle size={18} />
                <span>Cancel</span>
              </>
            ) : (
              <>
                <Sparkles size={17} />
                <span>Transcribe</span>
              </>
            )}
          </button>

          <button
            id="model-chip-btn"
            type="button"
            className="model-selector-chip"
            onClick={onOpenModelManager}
            title="Manage on-device Whisper speech model"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Cpu size={13} />
              <span>{currentModel.shortLabel}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{currentModel.sizeLabel}</span>
          </button>
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
