import { useEffect, useRef, type PointerEvent } from 'react';
import {
  AudioWaveform,
  FastForward,
  Pause,
  Play,
  Rewind,
  RotateCcw,
} from 'lucide-react';
import { formatTimestamp } from '../lib/salt/speakers';

interface WaveformPlayerProps {
  hasAudio: boolean;
  peaks: number[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  disabled?: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onRestart: () => void;
  onStep: (deltaSeconds: number) => void;
  onChangeRate: (rate: number) => void;
}

export function WaveformPlayer({
  hasAudio,
  peaks,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  disabled = false,
  onTogglePlay,
  onSeek,
  onRestart,
  onStep,
  onChangeRate,
}: WaveformPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Draw crisp Retina/HiDPI waveform bars + playhead cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasAudio || peaks.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const playedColor = styles.getPropertyValue('--wave-played').trim() || '#1d6ce0';
    const unplayedColor = styles.getPropertyValue('--wave-unplayed').trim() || '#cbd5e1';
    const cursorColor = styles.getPropertyValue('--wave-cursor').trim() || '#e85d34';

    const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const barCount = peaks.length;
    const step = width / barCount;
    const barWidth = Math.max(1.5, step * 0.65);
    const centerY = height / 2;
    const maxBarHeight = height - 12;

    for (let i = 0; i < barCount; i++) {
      const barFrac = (i + 0.5) / barCount;
      const amp = peaks[i];
      const barH = Math.max(3, amp * maxBarHeight);
      const x = i * step + (step - barWidth) / 2;
      const y = centerY - barH / 2;

      ctx.fillStyle = barFrac <= progress ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 2);
      ctx.fill();
    }

    // Playhead vertical cursor
    const cursorX = Math.max(1, Math.min(width - 1, progress * width));
    ctx.fillStyle = cursorColor;
    ctx.fillRect(cursorX - 1, 3, 2, height - 6);

    ctx.restore();
  }, [hasAudio, peaks, currentTime, duration]);

  const seekFromPointer = (clientX: number) => {
    if (!hasAudio || disabled || !wrapRef.current || duration <= 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(frac * duration);
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!hasAudio || disabled) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekFromPointer(e.clientX);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div className="waveform-player">
      <div
        ref={wrapRef}
        className={`waveform-canvas-wrap ${hasAudio ? '' : 'is-empty'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role={hasAudio ? 'slider' : undefined}
        aria-label={hasAudio ? 'Audio waveform timeline — tap or drag to seek' : undefined}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
      >
        {hasAudio ? (
          <canvas ref={canvasRef} className="waveform-canvas" />
        ) : (
          <>
            <AudioWaveform size={16} aria-hidden="true" />
            <span>Upload an audio file or record live to view the interactive waveform</span>
          </>
        )}
      </div>

      <div className="playback-controls-row">
        <div className="transport-group">
          <button
            id="btn-audio-restart"
            type="button"
            className="icon-btn"
            onClick={onRestart}
            disabled={!hasAudio || disabled}
            title="Restart audio (0:00)"
            aria-label="Restart audio"
          >
            <RotateCcw size={17} />
          </button>
          <button
            id="btn-audio-rewind"
            type="button"
            className="icon-btn"
            onClick={() => onStep(-5)}
            disabled={!hasAudio || disabled}
            title="Rewind 5 seconds"
            aria-label="Rewind 5 seconds"
          >
            <Rewind size={18} />
          </button>
          <button
            id="btn-audio-play-pause"
            type="button"
            className="play-btn"
            onClick={onTogglePlay}
            disabled={!hasAudio || disabled}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
          >
            {isPlaying ? <Pause size={19} /> : <Play size={19} style={{ marginLeft: 2 }} />}
          </button>
          <button
            id="btn-audio-forward"
            type="button"
            className="icon-btn"
            onClick={() => onStep(5)}
            disabled={!hasAudio || disabled}
            title="Forward 5 seconds"
            aria-label="Forward 5 seconds"
          >
            <FastForward size={18} />
          </button>
        </div>

        <div className="timeline-wrap">
          <span className="time-readout" aria-label="Current playback time">
            {formatTimestamp(currentTime)}
          </span>
          <input
            id="slider-audio-timeline"
            type="range"
            className="timeline-slider"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.05}
            value={Math.min(currentTime, duration || 0)}
            disabled={!hasAudio || disabled}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Seek audio position"
          />
          <span className="time-readout" aria-label="Total audio duration">
            {hasAudio ? formatTimestamp(duration) : '--:--'}
          </span>
        </div>

        <select
          id="select-playback-speed"
          className="speed-select"
          value={playbackRate}
          disabled={!hasAudio || disabled}
          onChange={(e) => onChangeRate(Number(e.target.value))}
          aria-label="Playback speed"
          title="Playback speed (slow down for detailed child speech transcription)"
        >
          <option value={0.65}>0.65×</option>
          <option value={0.75}>0.75×</option>
          <option value={0.85}>0.85×</option>
          <option value={1}>1.0×</option>
          <option value={1.25}>1.25×</option>
          <option value={1.5}>1.5×</option>
        </select>
      </div>
    </div>
  );
}
