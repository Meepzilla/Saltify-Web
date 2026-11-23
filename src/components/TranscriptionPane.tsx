import {
  AlignLeft,
  List,
  Lock,
  Sparkles,
  Tag,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  applySpeakerLabelsToLines,
  parseUtteranceLines,
} from '../engine/transcriptFormat';
import type { SpeakerAliases } from '../types/saltify';

interface TranscriptionPaneProps {
  text: string;
  aliases: SpeakerAliases;
  hasAudio: boolean;
  currentTime: number;
  disabled?: boolean;
  onChangeText: (nextText: string) => void;
  onSeekToTime: (seconds: number) => void;
  onOpenLabelSpeakers: () => void;
  onOpenAliases: () => void;
  onLoadDemoSample: () => void;
}

export function TranscriptionPane({
  text,
  aliases,
  hasAudio,
  currentTime,
  disabled = false,
  onChangeText,
  onSeekToTime,
  onOpenLabelSpeakers,
  onOpenAliases,
  onLoadDemoSample,
}: TranscriptionPaneProps) {
  const [locked, setLocked] = useState(true);
  const [viewMode, setViewMode] = useState<'interactive' | 'raw'>('interactive');

  const lines = useMemo(
    () => parseUtteranceLines(text, aliases),
    [text, aliases]
  );
  const nonEmptyLines = useMemo(
    () => lines.filter((l) => l.raw.trim().length > 0),
    [lines]
  );

  // Determine active line index matching current audio playhead
  const activeLineIndex = useMemo(() => {
    if (!hasAudio || currentTime <= 0) return -1;
    let active = -1;
    for (const line of lines) {
      if (line.timestampSec !== null && line.timestampSec <= currentTime + 0.4) {
        active = line.index;
      }
    }
    return active;
  }, [lines, hasAudio, currentTime]);

  const cycleLineSpeaker = (lineIndex: number, currentSlot: 'speaker1' | 'speaker2' | null) => {
    const nextSpeaker =
      currentSlot === null
        ? aliases.speaker1
        : currentSlot === 'speaker1'
        ? aliases.speaker2
        : null;
    const updated = applySpeakerLabelsToLines(
      text,
      new Set([lineIndex]),
      nextSpeaker,
      aliases
    );
    onChangeText(updated);
  };

  const handleClear = () => {
    if (!text.trim()) return;
    if (window.confirm('Clear all text in the Transcription Box?')) {
      onChangeText('');
    }
  };

  return (
    <section className="pane-card" aria-label="Transcription Box">
      <div className="pane-header">
        <div className="pane-title-group">
          <h2 className="pane-title">Transcription Box</h2>
          <span className="pane-count-badge">{nonEmptyLines.length} lines</span>
        </div>

        <div className="pane-toolbar">
          <button
            id="transcript-view-toggle-btn"
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={() => setViewMode((m) => (m === 'interactive' ? 'raw' : 'interactive'))}
            title={
              viewMode === 'interactive'
                ? 'Switch to plain text editor'
                : 'Switch to interactive utterance lines'
            }
          >
            {viewMode === 'interactive' ? <AlignLeft size={14} /> : <List size={14} />}
            <span>{viewMode === 'interactive' ? 'Edit Text' : 'Interactive'}</span>
          </button>

          <button
            id="transcript-lock-btn"
            type="button"
            className={`btn btn-icon ${locked ? 'btn-subtle' : 'btn-primary'}`}
            title={locked ? 'Unlock to manually edit transcript' : 'Lock transcript editing'}
            aria-label={locked ? 'Unlock transcription box' : 'Lock transcription box'}
            onClick={() => {
              const nextLocked = !locked;
              setLocked(nextLocked);
              if (!nextLocked) setViewMode('raw');
            }}
          >
            {locked ? <Lock size={15} /> : <Unlock size={15} />}
          </button>

          <button
            id="transcript-clear-btn"
            type="button"
            className="btn btn-ghost btn-icon"
            title="Clear Transcription Box"
            aria-label="Clear Transcription Box"
            disabled={!text.trim() || disabled}
            onClick={handleClear}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Speaker Labeling & Alias Subtoolbar (Desktop Saltify parity) */}
      <div className="pane-subtoolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            id="label-speakers-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!text.trim() || disabled}
            onClick={onOpenLabelSpeakers}
          >
            <Users size={14} />
            <span>Label Speakers</span>
          </button>

          <button
            id="apply-aliases-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={onOpenAliases}
          >
            <Tag size={14} />
            <span>
              Aliases ({aliases.speaker1} / {aliases.speaker2})
            </span>
          </button>
        </div>

        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Tap speaker badge to toggle {aliases.speaker1}/{aliases.speaker2}
        </span>
      </div>

      <div className="pane-body">
        {!text.trim() && viewMode === 'interactive' ? (
          <div className="pane-empty">
            <h3>No transcript yet</h3>
            <p>
              Record or upload a child language sample and click{' '}
              <strong>Transcribe</strong> to run Whisper 100% on this device, or unlock
              this box to type/paste directly.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setLocked(false);
                  setViewMode('raw');
                }}
              >
                <Unlock size={14} />
                <span>Type or Paste Transcript</span>
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                onClick={onLoadDemoSample}
              >
                <Sparkles size={14} />
                <span>Load Demo Sample</span>
              </button>
            </div>
          </div>
        ) : viewMode === 'raw' ? (
          <textarea
            id="transcription-textarea"
            className="pane-textarea"
            value={text}
            readOnly={locked || disabled}
            placeholder="Transcribed speech will appear here... Click the lock icon to type or edit manually."
            aria-label="Transcription text editor"
            onChange={(e) => onChangeText(e.target.value)}
          />
        ) : (
          <div className="utterance-list">
            {nonEmptyLines.map((line) => (
              <div
                key={line.index}
                className={`utterance-row ${line.speakerSlot ?? ''} ${
                  line.index === activeLineIndex ? 'active-time' : ''
                }`}
              >
                {line.timestampStr && (
                  <button
                    type="button"
                    className="utterance-ts-btn"
                    title={
                      hasAudio
                        ? `Jump audio to ${line.timestampStr}`
                        : `Timestamp ${line.timestampStr}`
                    }
                    onClick={() => {
                      if (line.timestampSec !== null) {
                        onSeekToTime(line.timestampSec);
                      }
                    }}
                  >
                    {line.timestampStr}
                  </button>
                )}

                <button
                  type="button"
                  className={`speaker-pill-btn ${line.speakerSlot ?? ''}`}
                  title="Tap to cycle speaker label"
                  disabled={disabled}
                  onClick={() => cycleLineSpeaker(line.index, line.speakerSlot)}
                >
                  {line.speaker ?? '—'}
                </button>

                <span
                  className="utterance-text"
                  style={{
                    color:
                      line.speakerSlot === 'speaker1'
                        ? 'var(--speaker1)'
                        : line.speakerSlot === 'speaker2'
                        ? 'var(--speaker2)'
                        : 'var(--text-primary)',
                  }}
                >
                  {line.body}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
