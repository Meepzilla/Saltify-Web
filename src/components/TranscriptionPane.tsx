import {
  AlignLeft,
  AudioLines,
  List,
  Lock,
  Sparkles,
  Tag,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  applySpeakerLabelsToLines,
  parseUtteranceLines,
} from '../engine/transcriptFormat';
import {
  countFlaggedWords,
  flaggedWordsForLine,
  VERY_LOW_CONFIDENCE_THRESHOLD,
  type WordConfidenceMap,
} from '../engine/wordConfidence';
import type { SpeakerAliases } from '../types/saltify';
import { OverflowMenu } from './OverflowMenu';
import { IpaUtteranceText } from './IpaText';
import { PosColoredText, PosLegend } from './PartsOfSpeech';

interface TranscriptionPaneProps {
  text: string;
  aliases: SpeakerAliases;
  hasAudio: boolean;
  currentTime: number;
  disabled?: boolean;
  /** Color each word by part of speech (Settings → SALT & Export). */
  colorPartsOfSpeech?: boolean;
  /** Replaces the title area (e.g. with Transcript / SALT tabs). */
  headerLeft?: ReactNode;
  /** Display utterances in International Phonetic Alphabet (IPA) broad transcription. */
  showIpaTranscription?: boolean;
  onToggleIpaTranscription?: () => void;
  onChangeText: (nextText: string) => void;
  onSeekToTime: (seconds: number) => void;
  onOpenLabelSpeakers: () => void;
  onOpenAliases: () => void;
  onLoadDemoSample: () => void;
  /** Uncertain words from Whisper, per line (see engine/wordConfidence). */
  wordConfidence?: WordConfidenceMap | null;
  highlightUncertainWords?: boolean;
  onToggleHighlightUncertainWords?: () => void;
  /** Opens the spectrogram for a line (by line index). */
  onInspectLine?: (lineIndex: number) => void;
}

export function TranscriptionPane({
  text,
  aliases,
  hasAudio,
  currentTime,
  disabled = false,
  colorPartsOfSpeech = false,
  headerLeft,
  showIpaTranscription = false,
  onToggleIpaTranscription,
  onChangeText,
  onSeekToTime,
  onOpenLabelSpeakers,
  onOpenAliases,
  onLoadDemoSample,
  wordConfidence = null,
  highlightUncertainWords = true,
  onToggleHighlightUncertainWords,
  onInspectLine,
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

  const uncertainCount = useMemo(
    () => countFlaggedWords(nonEmptyLines.map((l) => l.body), wordConfidence),
    [nonEmptyLines, wordConfidence]
  );
  const showUncertain = highlightUncertainWords && uncertainCount > 0;

  /** Wraps an uncertain word: amber underline (or red when very uncertain), tap to inspect. */
  const decorateFor = (lineIndex: number, body: string) => {
    const flagged = flaggedWordsForLine(body, wordConfidence);
    if (flagged.size === 0) return undefined;
    return (wordIndex: number, node: ReactNode) => {
      const f = flagged.get(wordIndex);
      if (!f) return node;
      const pct = Math.round(f.p * 100);
      return (
        <button
          type="button"
          className={`uncertain-word ${f.p < VERY_LOW_CONFIDENCE_THRESHOLD ? 'very' : ''}`}
          title={`Whisper was ${pct}% sure of this word. Tap to listen and see the spectrogram.`}
          aria-label={`Uncertain word: ${f.w}, ${pct}% confidence. Open spectrogram.`}
          onClick={() => onInspectLine?.(lineIndex)}
        >
          {node}
        </button>
      );
    };
  };

  const renderPlainWithDecor = (lineIndex: number, body: string) => {
    const decorate = decorateFor(lineIndex, body);
    if (!decorate) return body;
    let wi = -1;
    return body.split(/(\s+)/).map((piece, idx) => {
      if (!piece) return null;
      if (/^\s+$/.test(piece)) return <span key={idx}>{piece}</span>;
      wi += 1;
      return <span key={idx}>{decorate(wi, piece)}</span>;
    });
  };

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
          {headerLeft ?? (
            <>
              <h2 className="pane-title">Transcript</h2>
              <span className="pane-count-badge">{nonEmptyLines.length}</span>
            </>
          )}
        </div>

        <div className="pane-toolbar">
          <button
            id="label-speakers-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!text.trim() || disabled}
            onClick={onOpenLabelSpeakers}
            title="Assign Child / Examiner labels to lines (or tap a line's speaker badge)"
          >
            <Users size={14} />
            <span>Speakers</span>
          </button>

          {onToggleIpaTranscription && (
            <button
              id="transcript-ipa-toggle-btn"
              type="button"
              role="switch"
              aria-checked={showIpaTranscription}
              className={`btn btn-sm ${showIpaTranscription ? 'btn-primary' : 'btn-secondary'}`}
              disabled={disabled}
              onClick={onToggleIpaTranscription}
              title={
                showIpaTranscription
                  ? 'Switch back to standard English spelling'
                  : 'Show the transcript in broad IPA (hover a word for its spelling)'
              }
            >
              <span className="ipa-badge-glyph" aria-hidden="true">
                /ə/
              </span>
              <span>IPA</span>
            </button>
          )}

          <OverflowMenu
            id="transcript-menu-btn"
            label="Transcript options"
            items={[
              {
                key: 'view',
                label: viewMode === 'interactive' ? 'Edit as plain text' : 'Show utterance lines',
                icon: viewMode === 'interactive' ? <AlignLeft size={15} /> : <List size={15} />,
                onSelect: () => setViewMode((m) => (m === 'interactive' ? 'raw' : 'interactive')),
              },
              {
                key: 'lock',
                label: locked ? 'Unlock for typing' : 'Lock editing',
                icon: locked ? <Unlock size={15} /> : <Lock size={15} />,
                onSelect: () => {
                  const nextLocked = !locked;
                  setLocked(nextLocked);
                  if (!nextLocked) setViewMode('raw');
                },
              },
              ...(onInspectLine
                ? [
                    {
                      key: 'spectrogram',
                      label: 'Spectrogram',
                      icon: <AudioLines size={15} />,
                      disabled: !hasAudio || nonEmptyLines.length === 0,
                      onSelect: () => {
                        const target =
                          activeLineIndex >= 0 ? activeLineIndex : nonEmptyLines[0]?.index ?? 0;
                        onInspectLine(target);
                      },
                    },
                  ]
                : []),
              ...(onToggleHighlightUncertainWords
                ? [
                    {
                      key: 'uncertain',
                      label: 'Highlight uncertain words',
                      hint: uncertainCount > 0 ? String(uncertainCount) : undefined,
                      checked: highlightUncertainWords,
                      onSelect: onToggleHighlightUncertainWords,
                    },
                  ]
                : []),
              {
                key: 'aliases',
                label: 'Speaker names',
                icon: <Tag size={15} />,
                hint: `${aliases.speaker1} / ${aliases.speaker2}`,
                disabled,
                onSelect: onOpenAliases,
              },
              {
                key: 'clear',
                label: 'Clear transcript',
                icon: <Trash2 size={15} />,
                danger: true,
                dividerBefore: true,
                disabled: !text.trim() || disabled,
                onSelect: handleClear,
              },
            ]}
          />
        </div>
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
            {colorPartsOfSpeech && <PosLegend compact />}
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
                  {showIpaTranscription ? (
                    <IpaUtteranceText
                      body={line.body}
                      colorPartsOfSpeech={colorPartsOfSpeech}
                    />
                  ) : colorPartsOfSpeech ? (
                    <PosColoredText
                      body={line.body}
                      decorateWord={showUncertain ? decorateFor(line.index, line.body) : undefined}
                    />
                  ) : showUncertain ? (
                    renderPlainWithDecor(line.index, line.body)
                  ) : (
                    line.body
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
