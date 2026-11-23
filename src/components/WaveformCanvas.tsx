import { Maximize2, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDurationPadded } from '../engine/transcriptFormat';

interface WaveformCanvasProps {
  peaks: number[];
  currentTime: number;
  duration: number;
  markers?: number[];
  onSeek: (seconds: number) => void;
  disabled?: boolean;
  height?: number;
  showExpandButton?: boolean;
  onExpand?: () => void;
}

export function WaveformCanvas({
  peaks,
  currentTime,
  duration,
  markers = [],
  onSeek,
  disabled = false,
  height = 52,
  showExpandButton = true,
  onExpand,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [size, setSize] = useState({ width: 400, height });

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(100, size.width);
    const h = Math.max(36, size.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.documentElement);
    const unplayedColor = styles.getPropertyValue('--wave-unplayed').trim() || '#CBD5E1';
    const playedColor = styles.getPropertyValue('--wave-played').trim() || '#0D6E8A';
    const cursorColor = styles.getPropertyValue('--wave-cursor').trim() || '#D9532F';
    const markerColor = styles.getPropertyValue('--border-strong').trim() || '#94A3B8';

    const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
    const cursorX = progress * w;

    // Utterance timestamp guide ticks
    if (duration > 0 && markers.length > 0) {
      ctx.fillStyle = markerColor;
      ctx.globalAlpha = 0.45;
      for (const sec of markers) {
        const mx = Math.round((sec / duration) * w);
        if (mx > 1 && mx < w - 1) {
          ctx.fillRect(mx, 0, 1, 7);
          ctx.fillRect(mx, h - 7, 1, 7);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Center subtle hairline
    ctx.fillStyle = unplayedColor;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, Math.floor(h / 2), w, 1);
    ctx.globalAlpha = 1;

    // Draw symmetric bars
    const barCount = peaks.length;
    const step = w / barCount;
    const barW = Math.max(1.5, Math.min(3.5, step * 0.65));
    const midY = h / 2;
    const maxAmp = h * 0.43;

    for (let i = 0; i < barCount; i++) {
      const x = i * step + (step - barW) / 2;
      const amp = Math.max(2, peaks[i] * maxAmp);
      ctx.fillStyle = x <= cursorX ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, midY - amp, barW, amp * 2, Math.min(2, barW / 2));
      ctx.fill();
    }

    // Playhead cursor
    if (duration > 0) {
      ctx.fillStyle = cursorColor;
      ctx.fillRect(Math.max(0, Math.min(w - 2, cursorX - 1)), 2, 2, h - 4);
    }
  }, [peaks, currentTime, duration, markers, size]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (disabled || duration <= 0 || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [disabled, duration, onSeek]
  );

  if (peaks.length === 0) {
    return (
      <div className="waveform-shell empty" style={{ height }}>
        <Volume2 size={15} />
        <span>Record live or upload WAV, MP3, M4A, or WebM audio</span>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="waveform-shell"
      style={{ height }}
      role="slider"
      aria-label="Audio waveform seek timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(e) => {
        if (disabled) return;
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current || disabled) return;
        seekFromClientX(e.clientX);
      }}
      onPointerUp={(e) => {
        if (draggingRef.current) {
          draggingRef.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSeek(Math.min(duration, currentTime + 5));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 5));
        }
      }}
    >
      <canvas ref={canvasRef} className="waveform-canvas" />
      {showExpandButton && onExpand && (
        <button
          type="button"
          className="waveform-expand-btn"
          title="Open expanded Audio Waveform Graph"
          aria-label="Open expanded Audio Waveform Graph"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
        >
          <Maximize2 size={13} />
        </button>
      )}
    </div>
  );
}

interface WaveformModalProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  peaks: number[];
  currentTime: number;
  duration: number;
  markers: number[];
  onSeek: (seconds: number) => void;
}

export function WaveformModal({
  open,
  onClose,
  fileName,
  peaks,
  currentTime,
  duration,
  markers,
  onSeek,
}: WaveformModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waveform-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="waveform-modal-title" className="modal-title">
            Audio Waveform — {fileName || 'Recording'}
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close waveform graph"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <WaveformCanvas
            peaks={peaks}
            currentTime={currentTime}
            duration={duration}
            markers={markers}
            onSeek={onSeek}
            height={210}
            showExpandButton={false}
          />
          <div className="transport-row">
            <span className="transport-time">
              Playhead: {formatDurationPadded(currentTime)} / {formatDurationPadded(duration)}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Click or drag anywhere on the waveform to scrub audio.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
