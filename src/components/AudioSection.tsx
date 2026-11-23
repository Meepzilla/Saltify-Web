import { useRef, type ChangeEvent } from 'react';
import { Mic, Square, Upload } from 'lucide-react';
import { formatTimestamp } from '../lib/salt/speakers';
import { WaveformPlayer } from './WaveformPlayer';

interface AudioSectionProps {
  fileName: string;
  hasAudio: boolean;
  isRecording: boolean;
  recordingSeconds: number;
  recordingLevel: number;
  peaks: number[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  isProcessing: boolean;
  onChangeFileName: (name: string) => void;
  onUploadFile: (file: File) => void;
  onToggleRecord: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onRestart: () => void;
  onStep: (deltaSeconds: number) => void;
  onChangeRate: (rate: number) => void;
}

export function AudioSection({
  fileName,
  hasAudio,
  isRecording,
  recordingSeconds,
  recordingLevel,
  peaks,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  isProcessing,
  onChangeFileName,
  onUploadFile,
  onToggleRecord,
  onTogglePlay,
  onSeek,
  onRestart,
  onStep,
  onChangeRate,
}: AudioSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
    // Reset input so re-selecting the same file works cleanly
    e.target.value = '';
  };

  return (
    <section className="card audio-card" aria-label="Audio recording and playback">
      <div className="audio-input-col">
        <div className="audio-filename-row">
          <input
            id="input-audio-filename"
            type="text"
            className="text-input"
            placeholder="Sample file name (e.g. Child_Story_Retell)"
            value={fileName}
            onChange={(e) => onChangeFileName(e.target.value)}
            aria-label="Audio sample file name"
          />
        </div>

        <input
          ref={fileInputRef}
          id="input-upload-audio"
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.aac"
          onChange={handleFileChange}
          hidden
        />

        <div className="audio-capture-buttons">
          <button
            id="btn-upload-audio"
            type="button"
            className="btn btn-lg"
            disabled={isRecording || isProcessing}
            onClick={() => fileInputRef.current?.click()}
            title="Upload MP3, WAV, M4A (iPad Voice Memos), WEBM, or OGG audio"
          >
            <Upload size={16} aria-hidden="true" />
            {hasAudio ? 'Replace File' : 'Upload Audio'}
          </button>

          <button
            id="btn-record-audio"
            type="button"
            className={`btn btn-lg ${isRecording ? 'btn-danger' : 'btn-primary'}`}
            disabled={isProcessing}
            onClick={onToggleRecord}
            title={isRecording ? 'Stop live microphone recording' : 'Record live speech sample'}
          >
            {isRecording ? (
              <>
                <Square size={15} aria-hidden="true" />
                Stop ({formatTimestamp(recordingSeconds)})
              </>
            ) : (
              <>
                <Mic size={16} aria-hidden="true" />
                Record
              </>
            )}
          </button>
        </div>

        {isRecording && (
          <div className="recording-banner" role="status" aria-live="polite">
            <span className="rec-dot" aria-hidden="true" />
            <span>Recording live</span>
            <div className="vu-meter" aria-label="Microphone input level">
              <div
                className="vu-meter-fill"
                style={{ width: `${Math.max(6, Math.round(recordingLevel * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <WaveformPlayer
        hasAudio={hasAudio}
        peaks={peaks}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        disabled={isRecording || isProcessing}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        onRestart={onRestart}
        onStep={onStep}
        onChangeRate={onChangeRate}
      />
    </section>
  );
}
