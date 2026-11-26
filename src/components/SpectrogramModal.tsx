import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeSpectrogram,
  trackFormants,
  trackPitch,
  type FormantFrame,
  type PitchFrame,
  type SpectrogramResult,
} from '../engine/acousticAnalysis';
import {
  flaggedWordsForLine,
  VERY_LOW_CONFIDENCE_THRESHOLD,
  type WordConfidenceMap,
} from '../engine/wordConfidence';
import type { AudioPlayerState } from '../hooks/useAudioPlayer';
import type { UtteranceLine } from '../types/saltify';

const SAMPLE_RATE = 16000;
const MAX_HZ = 6000; // children's F3 can reach ~4.5 kHz
const PITCH_MAX_HZ = 600;
const PAD_SEC = 0.15;
const MAX_SEGMENT_SEC = 12;

const SPEC_H = 240;
const PITCH_H = 64;
const GAP = 12;
const AXIS_H = 20;
const LEFT = 44;
const RIGHT = 10;
const CANVAS_H = SPEC_H + GAP + PITCH_H + AXIS_H;

const FORMANT_COLORS = ['#ff5c8a', '#4ae0c9', '#c4f25a'] as const;

interface SpectrogramModalProps {
  open: boolean;
  lines: UtteranceLine[];
  lineIndex: number;
  onChangeLine: (lineIndex: number) => void;
  loadSamples: () => Promise<Float32Array | null>;
  player: AudioPlayerState;
  wordConfidence?: WordConfidenceMap | null;
  onClose: () => void;
}

interface Analysis {
  spec: SpectrogramResult;
  formants: FormantFrame[];
  pitch: PitchFrame[];
  /** Absolute start/end of the analysed audio in seconds. */
  start: number;
  end: number;
}

/** Magma-like colormap: dark purple (quiet) → orange → pale yellow (loud). */
function colormap(v: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [
    [0, 8, 6, 22],
    [0.3, 74, 16, 104],
    [0.55, 182, 54, 99],
    [0.78, 250, 136, 60],
    [1, 252, 245, 186],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, r0, g0, b0] = stops[i - 1];
      const [p1, r1, g1, b1] = stops[i];
      const t = (v - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  return [252, 245, 186];
}

function nearest<T extends { t: number }>(frames: T[], t: number): T | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(0, lo - 1)];
  const b = frames[lo];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

export function SpectrogramModal({
  open,
  lines,
  lineIndex,
  onChangeLine,
  loadSamples,
  player,
  wordConfidence,
  onClose,
}: SpectrogramModalProps) {
  const [samples, setSamples] = useState<Float32Array | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [band, setBand] = useState<'wide' | 'narrow'>('wide');
  const [showFormants, setShowFormants] = useState(true);
  const [showPitch, setShowPitch] = useState(true);
  const [hover, setHover] = useState<{ t: number; hz: number | null } | null>(null);
  const [segmentPlaying, setSegmentPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const specImageRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(700);

  // Lines that can be analysed: have a timestamp and spoken text
  const navigable = useMemo(
    () => lines.filter((l) => l.timestampSec !== null && l.body.trim().length > 0),
    [lines]
  );
  const pos = Math.max(
    0,
    navigable.findIndex((l) => l.index === lineIndex)
  );
  const line = navigable[pos] ?? null;

  useEffect(() => {
    if (!open || samples) return;
    let cancelled = false;
    loadSamples()
      .then((s) => {
        if (cancelled) return;
        if (s) setSamples(s);
        else setLoadError('No audio is loaded for this session.');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, samples, loadSamples]);

  // Segment: from this line's timestamp to the next line's (capped), with a little padding
  const segment = useMemo(() => {
    if (!line || line.timestampSec === null) return null;
    const totalSec = samples ? samples.length / SAMPLE_RATE : player.duration || 0;
    const next = navigable.slice(pos + 1).find((l) => (l.timestampSec ?? 0) > (line.timestampSec ?? 0));
    let end = next?.timestampSec ?? totalSec;
    if (!end || end <= line.timestampSec) end = line.timestampSec + 2;
    end = Math.min(end, line.timestampSec + MAX_SEGMENT_SEC);
    const start = Math.max(0, line.timestampSec - PAD_SEC);
    return { start, end: totalSec ? Math.min(totalSec, end + PAD_SEC) : end + PAD_SEC };
  }, [line, navigable, pos, samples, player.duration]);

  const analysis: Analysis | null = useMemo(() => {
    if (!samples || !segment) return null;
    const a = Math.floor(segment.start * SAMPLE_RATE);
    const b = Math.min(samples.length, Math.ceil(segment.end * SAMPLE_RATE));
    if (b - a < SAMPLE_RATE * 0.05) return null;
    const slice = samples.subarray(a, b);
    const spec = computeSpectrogram(slice, SAMPLE_RATE, {
      windowSec: band === 'wide' ? 0.005 : 0.03,
      hopSec: band === 'wide' ? 0.002 : 0.004,
      maxHz: MAX_HZ,
    });
    const pitch = trackPitch(slice, SAMPLE_RATE);
    const voiced = (t: number) => (nearest(pitch, t)?.f0 ?? 0) > 0;
    const formants = trackFormants(slice, SAMPLE_RATE, { voicedTimes: voiced });
    return { spec, pitch, formants, start: segment.start, end: segment.end };
  }, [samples, segment, band]);

  // Render the spectrogram once per analysis into an offscreen canvas (frames × bins pixels)
  useEffect(() => {
    if (!analysis) {
      specImageRef.current = null;
      return;
    }
    const { spec } = analysis;
    const off = document.createElement('canvas');
    off.width = spec.frames;
    off.height = spec.bins;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(spec.frames, spec.bins);
    const RANGE_DB = 55;
    const floor = spec.maxDb - RANGE_DB;
    for (let f = 0; f < spec.frames; f++) {
      for (let b = 0; b < spec.bins; b++) {
        const v = Math.min(1, Math.max(0, (spec.db[f * spec.bins + b] - floor) / RANGE_DB));
        const [r, g, bl] = colormap(v);
        const y = spec.bins - 1 - b;
        const idx = (y * spec.frames + f) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = bl;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    specImageRef.current = off;
  }, [analysis]);

  // Track container width for a crisp canvas
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, [open]);

  const plotW = width - LEFT - RIGHT;
  const timeToX = useCallback(
    (t: number) => (analysis ? LEFT + ((t - analysis.start) / (analysis.end - analysis.start)) * plotW : LEFT),
    [analysis, plotW]
  );

  // Draw: spectrogram image, formant dots, pitch strip, axes, playhead
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CANVAS_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(canvas);
    const textColor = styles.getPropertyValue('--text-secondary').trim() || '#555';
    const gridColor = styles.getPropertyValue('--border-subtle').trim() || '#ddd';
    ctx.clearRect(0, 0, width, CANVAS_H);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = textColor;

    // Panels background
    ctx.fillStyle = '#08061a';
    ctx.fillRect(LEFT, 0, plotW, SPEC_H);
    ctx.fillRect(LEFT, SPEC_H + GAP, plotW, PITCH_H);

    if (analysis && specImageRef.current) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(specImageRef.current, LEFT, 0, plotW, SPEC_H);

      if (showFormants) {
        analysis.formants.forEach((fr) => {
          fr.f.forEach((hz, k) => {
            if (hz === null || hz > MAX_HZ) return;
            const x = LEFT + (fr.t / (analysis.end - analysis.start)) * plotW;
            const y = SPEC_H - (hz / MAX_HZ) * SPEC_H;
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = FORMANT_COLORS[k];
            ctx.fill();
          });
        });
      }

      if (showPitch) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let penDown = false;
        analysis.pitch.forEach((p) => {
          const x = LEFT + (p.t / (analysis.end - analysis.start)) * plotW;
          if (p.f0 <= 0) {
            penDown = false;
            return;
          }
          const y = SPEC_H + GAP + PITCH_H - (Math.min(p.f0, PITCH_MAX_HZ) / PITCH_MAX_HZ) * PITCH_H;
          if (penDown) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          penDown = true;
        });
        ctx.stroke();
      }

      // Playhead
      const ph = player.currentTime;
      if (ph >= analysis.start && ph <= analysis.end) {
        const x = timeToX(ph);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, SPEC_H + GAP + PITCH_H);
        ctx.stroke();
      }

      // Hover cursor
      if (hover) {
        const x = timeToX(hover.t);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, SPEC_H + GAP + PITCH_H);
        ctx.stroke();
        if (hover.hz !== null) {
          const y = SPEC_H - (hover.hz / MAX_HZ) * SPEC_H;
          ctx.beginPath();
          ctx.moveTo(LEFT, y);
          ctx.lineTo(LEFT + plotW, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // Axes labels
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let khz = 0; khz <= MAX_HZ / 1000; khz++) {
      const y = SPEC_H - ((khz * 1000) / MAX_HZ) * SPEC_H;
      ctx.fillText(`${khz}k`, LEFT - 6, Math.min(SPEC_H - 6, Math.max(6, y)));
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(LEFT - 3, y);
      ctx.lineTo(LEFT, y);
      ctx.stroke();
    }
    ctx.fillText('F0', LEFT - 6, SPEC_H + GAP + PITCH_H / 2);
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillText(String(PITCH_MAX_HZ), LEFT - 6, SPEC_H + GAP + 6);
    ctx.fillText('0', LEFT - 6, SPEC_H + GAP + PITCH_H - 5);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    if (analysis) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const dur = analysis.end - analysis.start;
      // Widest-first spacing that keeps labels at least ~56 px apart (phones get fewer ticks)
      const step =
        [0.1, 0.25, 0.5, 1, 2, 5].find((st) => (st / dur) * plotW >= 56) ?? 5;
      const decimals = step >= 1 ? 0 : step >= 0.5 ? 1 : 2;
      for (let t = Math.ceil(analysis.start / step) * step; t <= analysis.end + 1e-6; t += step) {
        const x = timeToX(t);
        ctx.fillText(`${t.toFixed(decimals)}s`, x, SPEC_H + GAP + PITCH_H + 4);
      }
    }
  }, [open, analysis, width, plotW, showFormants, showPitch, player.currentTime, hover, timeToX]);

  // Stop at the end of the segment when playing just this utterance
  const segmentActive = segmentPlaying && player.isPlaying;
  useEffect(() => {
    if (segmentActive && analysis && player.currentTime >= analysis.end) player.pause();
  }, [segmentActive, analysis, player]);

  // Keyboard: Esc closes, ←/→ move between utterances, Space plays
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && pos > 0) onChangeLine(navigable[pos - 1].index);
      else if (e.key === 'ArrowRight' && pos < navigable.length - 1) onChangeLine(navigable[pos + 1].index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onChangeLine, navigable, pos]);

  if (!open) return null;

  const pointerToReadout = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!analysis) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < LEFT || x > LEFT + plotW) return null;
    const t = analysis.start + ((x - LEFT) / plotW) * (analysis.end - analysis.start);
    const hz = y >= 0 && y <= SPEC_H ? ((SPEC_H - y) / SPEC_H) * MAX_HZ : null;
    return { t, hz };
  };

  const playSegment = () => {
    if (!analysis) return;
    if (segmentActive) {
      player.pause();
      setSegmentPlaying(false);
      return;
    }
    player.seek(analysis.start, true);
    setSegmentPlaying(true);
  };

  const readoutTime = hover?.t ?? (analysis && player.currentTime >= analysis.start && player.currentTime <= analysis.end ? player.currentTime : null);
  const relT = readoutTime !== null && analysis ? readoutTime - analysis.start : null;
  const fr = relT !== null && analysis ? nearest(analysis.formants, relT) : null;
  const pf = relT !== null && analysis ? nearest(analysis.pitch, relT) : null;
  const flagged = line ? flaggedWordsForLine(line.body, wordConfidence) : new Map();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card spectrogram-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spectrogram-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="spectrogram-title" className="modal-title">
            Spectrogram
          </h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close spectrogram" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body spectrogram-body">
          <div className="spectrogram-utterance">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Previous utterance"
              disabled={pos <= 0}
              onClick={() => onChangeLine(navigable[pos - 1].index)}
            >
              <ChevronLeft size={18} />
            </button>
            <div className="spectrogram-utterance-text">
              {line ? (
                <>
                  <span className="mono spectrogram-ts">{line.timestampStr}</span>
                  {line.speaker && <span className="spectrogram-speaker">{line.speaker}</span>}
                  <span>
                    {line.body.split(/(\s+)/).map((piece, idx, arr) => {
                      if (/^\s+$/.test(piece) || !piece) return piece;
                      const wi = arr.slice(0, idx).filter((p) => p && !/^\s+$/.test(p)).length;
                      const f = flagged.get(wi);
                      return f ? (
                        <mark
                          key={idx}
                          className={`uncertain-word static ${f.p < VERY_LOW_CONFIDENCE_THRESHOLD ? 'very' : ''}`}
                          title={`Whisper was ${Math.round(f.p * 100)}% sure`}
                        >
                          {piece}
                        </mark>
                      ) : (
                        <span key={idx}>{piece}</span>
                      );
                    })}
                  </span>
                </>
              ) : (
                <span>No timestamped utterances to analyse.</span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Next utterance"
              disabled={pos >= navigable.length - 1}
              onClick={() => onChangeLine(navigable[pos + 1].index)}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="spectrogram-controls">
            <button type="button" className="btn btn-primary btn-sm" disabled={!analysis} onClick={playSegment}>
              {segmentActive ? <Pause size={14} /> : <Play size={14} />}
              <span>{segmentActive ? 'Pause' : 'Play utterance'}</span>
            </button>
            <div className="editor-tablist" role="group" aria-label="Spectrogram bandwidth">
              <button
                type="button"
                className={`editor-tab ${band === 'wide' ? 'active' : ''}`}
                aria-pressed={band === 'wide'}
                onClick={() => setBand('wide')}
                title="Wideband (5 ms): formants show as dark bands"
              >
                Wideband
              </button>
              <button
                type="button"
                className={`editor-tab ${band === 'narrow' ? 'active' : ''}`}
                aria-pressed={band === 'narrow'}
                onClick={() => setBand('narrow')}
                title="Narrowband (30 ms): harmonics and pitch contour"
              >
                Narrowband
              </button>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={showFormants} onChange={(e) => setShowFormants(e.target.checked)} />
              <span>Formants</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={showPitch} onChange={(e) => setShowPitch(e.target.checked)} />
              <span>Pitch</span>
            </label>
          </div>

          <div ref={wrapRef} className="spectrogram-canvas-wrap">
            {loadError ? (
              <div className="spectrogram-empty">{loadError}</div>
            ) : !samples ? (
              <div className="spectrogram-empty">Preparing audio…</div>
            ) : null}
            <canvas
              ref={canvasRef}
              className="spectrogram-canvas"
              style={{ width, height: CANVAS_H }}
              aria-label="Spectrogram with formant and pitch tracks. Tap to move the playhead."
              onPointerMove={(e) => setHover(pointerToReadout(e))}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => {
                const r = pointerToReadout(e);
                if (r) {
                  setHover(r);
                  player.seek(r.t);
                }
              }}
            />
          </div>

          <div className="spectrogram-readout mono" aria-live="polite">
            <span>t {readoutTime !== null ? `${readoutTime.toFixed(2)}s` : '—'}</span>
            {hover?.hz != null && <span>cursor {Math.round(hover.hz)} Hz</span>}
            {fr?.f.map((hz, k) => (
              <span key={k} style={{ color: FORMANT_COLORS[k] }} className="spectrogram-formant-chip">
                F{k + 1} {hz !== null ? `${Math.round(hz)} Hz` : '—'}
              </span>
            ))}
            <span className="spectrogram-pitch-chip">F0 {pf && pf.f0 > 0 ? `${Math.round(pf.f0)} Hz` : '—'}</span>
          </div>

          <p className="spectrogram-note">
            Formants (F1 pink, F2 teal, F3 green) and pitch are estimated on this device to help you listen
            and decide. They are approximate, especially for children&apos;s high voices, and never change
            your transcript. Tap the spectrogram to move the playhead; use ← / → for other utterances.
          </p>
        </div>
      </div>
    </div>
  );
}
