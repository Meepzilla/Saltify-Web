import {
  AlignLeft,
  AudioLines,
  Check,
  Ear,
  Replace,
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
  confidenceLineKey,
  countFlaggedWords,
  DEFAULT_FLAG_THRESHOLDS,
  flaggedWordsForLine,
  VERY_LOW_CONFIDENCE_THRESHOLD,
  type FlagThresholds,
  type WordConfidenceMap,
} from '../engine/wordConfidence';
import type { SpeakerAliases } from '../types/saltify';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import { FlagSensitivityControls, ReplaceWordField } from './WordReviewControls';
import { IpaUtteranceText } from './IpaText';
import { PosColoredText, PosLegend } from './PartsOfSpeech';
import { PhonologicalProcessSummary, SpeechSoundsLegend, SpeechSoundsLine } from './SpeechSounds';
import { compareUtterance } from '../engine/utteranceSounds';
import { summarizeProcesses, isContentWord } from '../engine/phonologicalProcesses';
import { useIpaDictionaryReady } from '../hooks/useIpaDictionaryReady';
import {
  lineWindow,
  phonesInWindow,
  type SpeechSoundsRecord,
  type WordSoundComparison,
  type UtteranceSpan,
} from '../engine/speechSounds';

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
  /** Short name of the second-opinion model ("Base .en"), for disagreement menus. */
  secondOpinionLabel?: string;
  /**
   * Resolves a flagged word: replacement string swaps it in, '' removes the word,
   * null keeps the word and dismisses the flag.
   */
  onResolveWord?: (lineIndex: number, wordIndex: number, replacement: string | null) => void;
  /** Live review sensitivity for flags. */
  flagThresholds?: FlagThresholds;
  onChangeFlagThresholds?: (next: FlagThresholds) => void;
  /** Sounds heard by the phoneme recognizer (raw speech), shown under the interpreted words. */
  speechSounds?: SpeechSoundsRecord | null;
  /** Precise utterance timing from transcription, for matching heard sounds to lines. */
  utteranceSpans?: UtteranceSpan[];
  audioDurationSec?: number;
  showSpeechSounds?: boolean;
  onToggleShowSpeechSounds?: () => void;
  /** Runs speech-sound detection on the session audio. */
  onDetectSpeechSounds?: () => void;
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
  secondOpinionLabel = 'Second model',
  onResolveWord,
  flagThresholds,
  onChangeFlagThresholds,
  speechSounds = null,
  utteranceSpans,
  audioDurationSec = 0,
  showSpeechSounds = true,
  onToggleShowSpeechSounds,
  onDetectSpeechSounds,
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

  const thresholds = flagThresholds ?? DEFAULT_FLAG_THRESHOLDS;
  const uncertainCount = useMemo(
    () => countFlaggedWords(nonEmptyLines.map((l) => l.body), wordConfidence, thresholds),
    [nonEmptyLines, wordConfidence, thresholds]
  );
  const showUncertain = highlightUncertainWords && uncertainCount > 0;

  const speechSoundsVisible =
    Boolean(speechSounds && speechSounds.phones.length > 0) && showSpeechSounds && !showIpaTranscription;
  const ipaReady = useIpaDictionaryReady(speechSoundsVisible);
  /**
   * Word-by-word comparison (expected vs heard) per line index. Heard sounds are matched to lines by
   * Whisper's utterance timing (or the line timestamps). Empty until the dictionary has loaded.
   */
  const soundsByLine = useMemo(() => {
    const map = new Map<number, Map<number, WordSoundComparison>>();
    if (!speechSoundsVisible || !speechSounds || !ipaReady) return map;
    const used = new Set<number>();
    const duration =
      audioDurationSec > 0 ? audioDurationSec : speechSounds.phones[speechSounds.phones.length - 1]?.[1] ?? 0;
    nonEmptyLines.forEach((line, k) => {
      let next: number | null = null;
      for (let j = k + 1; j < nonEmptyLines.length; j++) {
        if (nonEmptyLines[j].timestampSec !== null) {
          next = nonEmptyLines[j].timestampSec;
          break;
        }
      }
      const win = lineWindow(
        confidenceLineKey(line.body),
        line.timestampSec,
        next,
        utteranceSpans,
        used,
        duration
      );
      if (win) map.set(line.index, compareUtterance(line.body, phonesInWindow(speechSounds.phones, win.start, win.end)));
    });
    return map;
  }, [speechSoundsVisible, speechSounds, ipaReady, nonEmptyLines, utteranceSpans, audioDurationSec]);

  /** Phonological process totals: child utterances when lines are labeled, otherwise all lines. */
  const processSummary = useMemo(() => {
    if (soundsByLine.size === 0) return null;
    const childLines = nonEmptyLines.filter((l) => l.speakerSlot === 'speaker1' && soundsByLine.has(l.index));
    const scope = childLines.length > 0 ? childLines : nonEmptyLines.filter((l) => soundsByLine.has(l.index));
    const words = scope.flatMap((l) => [...soundsByLine.get(l.index)!.values()]);
    return {
      rows: summarizeProcesses(words),
      scopeLabel: childLines.length > 0 ? `${aliases.speaker1} utterances` : 'all utterances',
      wordCount: words.filter((w) => isContentWord(w.word)).length,
    };
  }, [soundsByLine, nonEmptyLines, aliases.speaker1]);

  /**
   * Every flagged word opens the same fix menu: use the other model's word (when the models
   * disagreed), type your own replacement, remove the word, keep it, or listen.
   */
  const decorateFor = (lineIndex: number, body: string) => {
    const flagged = flaggedWordsForLine(body, wordConfidence, thresholds);
    if (flagged.size === 0) return undefined;
    return (wordIndex: number, node: ReactNode) => {
      const f = flagged.get(wordIndex);
      if (!f) return node;
      const pct = Math.round(f.p * 100);
      const isDisagreement = f.a !== undefined;
      const heardNothing = f.a === '';
      const veryLow = f.p < VERY_LOW_CONFIDENCE_THRESHOLD;
      const className = `uncertain-word ${isDisagreement ? 'disagree' : ''} ${veryLow ? 'very' : ''}`;
      const describe = isDisagreement
        ? heardNothing
          ? `“${f.w}”: ${secondOpinionLabel} heard no word here (main model ${pct}% sure).`
          : `“${f.w}”: ${secondOpinionLabel} heard “${f.a}” (main model ${pct}% sure).`
        : `“${f.w}”: Whisper was ${pct}% sure.`;

      if (!onResolveWord) {
        return (
          <button
            type="button"
            className={className}
            title={`${describe} Tap to listen and see the spectrogram.`}
            aria-label={`${describe} Open spectrogram.`}
            onClick={() => onInspectLine?.(lineIndex)}
          >
            {node}
          </button>
        );
      }

      const items: OverflowMenuItem[] = [];
      if (isDisagreement && !heardNothing) {
        items.push({
          key: 'swap',
          label: `Use “${(f.a ?? '').replace(/[.,!?;:]+$/, '')}”`,
          hint: `${secondOpinionLabel} ${Math.round((f.ap ?? 0) * 100)}%`,
          icon: <Replace size={15} />,
          onSelect: () => onResolveWord(lineIndex, wordIndex, f.a ?? ''),
        });
      }
      items.push(
        {
          key: 'custom',
          label: 'Replace with…',
          render: (close) => (
            <ReplaceWordField
              initial={(body.split(/\s+/).filter(Boolean)[wordIndex] ?? '').replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '')}
              onSubmit={(text) => {
                close();
                onResolveWord(lineIndex, wordIndex, text);
              }}
            />
          ),
        },
        {
          key: 'remove',
          label: heardNothing ? `Remove word (${secondOpinionLabel} heard nothing)` : 'Remove word',
          icon: <Trash2 size={15} />,
          onSelect: () => onResolveWord(lineIndex, wordIndex, ''),
        },
        {
          key: 'keep',
          label: 'Keep this word',
          hint: `${pct}%`,
          icon: <Check size={15} />,
          onSelect: () => onResolveWord(lineIndex, wordIndex, null),
        }
      );
      if (onInspectLine) {
        items.push({
          key: 'spectrogram',
          label: 'Listen & spectrogram',
          icon: <AudioLines size={15} />,
          dividerBefore: true,
          onSelect: () => onInspectLine(lineIndex),
        });
      }
      return (
        <OverflowMenu
          label={`${describe} Fix options`}
          trigger={node}
          triggerClassName={className}
          items={items}
        />
      );
    };
  };

  /**
   * In the speech-sounds view every word opens a menu: set the intended (target) word, which is
   * what phonological processes are measured against, or listen. Flagged words keep their menu.
   */
  const decorateForSounds = (lineIndex: number, body: string) => {
    const flaggedDecorate = showUncertain ? decorateFor(lineIndex, body) : undefined;
    const flagged = showUncertain ? flaggedWordsForLine(body, wordConfidence, thresholds) : new Map();
    if (!onResolveWord) return flaggedDecorate;
    const words = body.split(/\s+/).filter(Boolean);
    return (wordIndex: number, node: ReactNode) => {
      if (flaggedDecorate && flagged.has(wordIndex)) return flaggedDecorate(wordIndex, node);
      const current = (words[wordIndex] ?? '').replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
      const items: OverflowMenuItem[] = [
        {
          key: 'target',
          label: 'Intended word…',
          render: (close) => (
            <ReplaceWordField
              initial={current}
              label="Intended (target) word"
              placeholder={`What the child meant by “${current}”`}
              submitLabel="Set"
              onSubmit={(text) => {
                close();
                onResolveWord(lineIndex, wordIndex, text);
              }}
            />
          ),
        },
      ];
      if (onInspectLine) {
        items.push({
          key: 'spectrogram',
          label: 'Listen & spectrogram',
          icon: <AudioLines size={15} />,
          dividerBefore: true,
          onSelect: () => onInspectLine(lineIndex),
        });
      }
      return (
        <OverflowMenu
          label={`“${current}”: set the intended word or listen`}
          trigger={node}
          triggerClassName="ss-word-btn"
          items={items}
        />
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
              ...(onDetectSpeechSounds
                ? [
                    {
                      key: 'detect-sounds',
                      label: speechSounds ? 'Re-detect speech sounds' : 'Detect speech sounds',
                      hint: speechSounds ? `${speechSounds.phones.length}` : '~230 MB once',
                      icon: <Ear size={15} />,
                      dividerBefore: true,
                      disabled: !hasAudio || disabled,
                      onSelect: onDetectSpeechSounds,
                    },
                  ]
                : []),
              ...(speechSounds && onToggleShowSpeechSounds
                ? [
                    {
                      key: 'show-sounds',
                      label: 'Show heard sounds',
                      checked: showSpeechSounds,
                      onSelect: onToggleShowSpeechSounds,
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
              ...(onChangeFlagThresholds && wordConfidence
                ? [
                    {
                      key: 'sensitivity',
                      label: 'Review sensitivity',
                      render: () => (
                        <FlagSensitivityControls
                          value={thresholds}
                          flaggedCount={uncertainCount}
                          onChange={onChangeFlagThresholds}
                        />
                      ),
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
            {speechSoundsVisible && <SpeechSoundsLegend />}
            {speechSoundsVisible && processSummary && (
              <PhonologicalProcessSummary
                rows={processSummary.rows}
                scopeLabel={processSummary.scopeLabel}
                wordCount={processSummary.wordCount}
              />
            )}
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
                  {speechSoundsVisible && (soundsByLine.has(line.index) || !ipaReady) ? (
                    <SpeechSoundsLine
                      body={line.body}
                      comparison={soundsByLine.get(line.index) ?? null}
                      showProcesses={line.speakerSlot !== 'speaker2'}
                      decorateWord={decorateForSounds(line.index, line.body)}
                    />
                  ) : showIpaTranscription ? (
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
