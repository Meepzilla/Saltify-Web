import {
  AlignLeft,
  Check,
  CheckCheck,
  Eye,
  FastForward,
  GitBranch,
  Lock,
  SpellCheck,
  Palette,
  SplitSquareHorizontal,
  Trash2,
  Unlock,
  XCircle,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { parseUtteranceClauseCoding } from '../engine/clauseAnalysis';
import { hasPosCodes } from '../engine/posCodes';
import { parseUtteranceLines } from '../engine/transcriptFormat';
import type { SpeakerAliases } from '../types/saltify';
import { OverflowMenu } from './OverflowMenu';
import { IpaUtteranceText } from './IpaText';
import { PosColoredText, PosLegend } from './PartsOfSpeech';

interface ConventionPaneProps {
  text: string;
  hasTranscript: boolean;
  aliases: SpeakerAliases;
  grammarActive: boolean;
  grammarCheckPerformed: boolean;
  morphemesApplied: boolean;
  currentOriginalLine: string | null;
  correctionDraft: string;
  grammarRemaining: number;
  grammarTotal: number;
  checkAllSentences: boolean;
  disabled?: boolean;
  onChangeText: (nextText: string) => void;
  onToggleCheckAll: (next: boolean) => void;
  onStartOrCancelGrammarCheck: () => void;
  onChangeCorrectionDraft: (draft: string) => void;
  onSubmitCorrection: () => void;
  onSkipCorrection: () => void;
  onAutoApplyAllRemaining: () => void;
  onAddMorphemes: () => void;
  /** Inserts part-of-speech codes (dog[N]) on every word, or removes them if present. */
  onTogglePosCodes: () => void;
  /** Replaces the title area (e.g. with Transcript / SALT tabs). */
  headerLeft?: ReactNode;
  /** Color each word by part of speech (Settings → SALT & Export). */
  colorPartsOfSpeech?: boolean;
  /** Display utterances in International Phonetic Alphabet (IPA) broad transcription. */
  showIpaTranscription?: boolean;
  onToggleIpaTranscription?: () => void;
  onOpenClauseCoder: () => void;
  onQuickCycleLineSi: (lineIndex: number) => void;
  onSeekToTime?: (seconds: number) => void;
}

const SALT_TOUCH_CHIPS = [
  { label: '[EW]', insert: '[EW]', title: 'Extraneous / Extra Word' },
  { label: '[EW:]', insert: '[EW:]', title: 'Word-Level Error with target' },
  { label: '[EO:]', insert: '[EO:]', title: 'Overregularization error' },
  { label: '[EP:]', insert: '[EP:]', title: 'Pronoun error' },
  { label: '[EU]', insert: ' [EU]', title: 'Utterance-level error' },
  { label: '/*3s', insert: '/*3s', title: 'Omitted 3rd-person singular -s' },
  { label: '/*ed', insert: '/*ed', title: 'Omitted past tense -ed' },
  { label: '/*s', insert: '/*s', title: 'Omitted plural -s' },
  { label: '*', insert: '*', title: 'Omitted word marker (*word)' },
  { label: '( )', insert: '()', title: 'Maze / repetition parentheses' },
  { label: '>', insert: '>', title: 'Abandoned utterance' },
  { label: '[SI-1]', insert: ' [SI-1]', title: 'Subordination Index: 1 clause' },
  { label: '[SI-2]', insert: ' [SI-2]', title: 'Subordination Index: 2 clauses' },
  { label: '[SI-3]', insert: ' [SI-3]', title: 'Subordination Index: 3 clauses' },
  { label: '[SI-0]', insert: ' [SI-0]', title: 'Subordination Index: 0 clauses' },
  { label: '[SI-X]', insert: ' [SI-X]', title: 'Excluded from clausal density' },
  { label: '[MC]', insert: '[MC] ', title: 'Main / independent clause boundary' },
  { label: '[SC]', insert: '[SC] ', title: 'Subordinate / dependent clause boundary' },
] as const;

/**
 * Splits a SALT-coded utterance into highlighted inline spans:
 * - Mazes `( ... )`
 * - Clause & Subordination Index codes `[SI-0]..[SI-N]`, `[SI-X]`, `[MC]`, `[SC]`, `[RC]`, `[AC]`, `[NC]`, `[CL]`
 * - Error codes `[EW...]`, `[EO...]`, `[EP...]`, `[EU]`, `/*3s`, `*word`
 * - Bound morphemes `walk/ed`, `dog/s`, `I/'m`
 */
function renderSaltTokens(body: string) {
  const tokenRegex =
    /(\([^)]*\)|\[SI-(?:\d+|X)\]|\[(?:MC|SC|RC|AC|NC|CL)\]|\[(?:N|V|AUX|PRO|ADJ|ADV|DET|PREP|CONJ|NUM|INT|OTH)\]|[A-Za-z']*\[(?!(?:N|V|AUX|PRO|ADJ|ADV|DET|PREP|CONJ|NUM|INT|OTH)\])[^\]]+\][.,!?;:]*|\*[A-Za-z']+|[A-Za-z']+\/\*[A-Za-z0-9']+|[A-Za-z']+\/(?:s|z|ed|3s|ing|n't|'t|'s|'m|'re|'ll|'d|'ve)\b)/gi;

  const parts = body.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('(') && part.endsWith(')')) {
      return (
        <span key={idx} className="salt-tok-maze">
          {part}
        </span>
      );
    }
    if (/^\[SI-X\]$/i.test(part)) {
      return (
        <span key={idx} className="salt-tok-clause excluded">
          {part}
        </span>
      );
    }
    if (/^\[(?:N|V|AUX|PRO|ADJ|ADV|DET|PREP|CONJ|NUM|INT|OTH)\]$/.test(part)) {
      return (
        <span key={idx} className="salt-tok-pos">
          {part}
        </span>
      );
    }
    if (/^\[(?:SI-\d+|MC|SC|RC|AC|NC|CL)\]$/i.test(part)) {
      return (
        <span key={idx} className="salt-tok-clause">
          {part}
        </span>
      );
    }
    if (part.includes('[') || part.includes('*')) {
      return (
        <span key={idx} className="salt-tok-error">
          {part}
        </span>
      );
    }
    if (part.includes('/')) {
      const slashIdx = part.indexOf('/');
      return (
        <span key={idx} className="salt-word-with-morpheme">
          {part.slice(0, slashIdx)}
          <span className="salt-tok-morpheme">{part.slice(slashIdx)}</span>
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function ConventionPane({
  text,
  hasTranscript,
  aliases,
  grammarActive,
  grammarCheckPerformed,
  morphemesApplied,
  currentOriginalLine,
  correctionDraft,
  grammarRemaining,
  grammarTotal,
  checkAllSentences,
  disabled = false,
  onChangeText,
  onToggleCheckAll,
  onStartOrCancelGrammarCheck,
  onChangeCorrectionDraft,
  onSubmitCorrection,
  onSkipCorrection,
  onAutoApplyAllRemaining,
  onAddMorphemes,
  onTogglePosCodes,
  headerLeft,
  colorPartsOfSpeech = false,
  showIpaTranscription = false,
  onToggleIpaTranscription,
  onOpenClauseCoder,
  onQuickCycleLineSi,
  onSeekToTime,
}: ConventionPaneProps) {
  const [locked, setLocked] = useState(true);
  const [viewMode, setViewMode] = useState<'highlighted' | 'raw'>('highlighted');
  const correctionRef = useRef<HTMLTextAreaElement | null>(null);

  const lines = useMemo(
    () =>
      parseUtteranceLines(text, aliases).filter((l) => l.raw.trim().length > 0),
    [text, aliases]
  );

  const insertSaltChip = (snippet: string) => {
    const el = correctionRef.current;
    if (!el) {
      onChangeCorrectionDraft(correctionDraft + snippet);
      return;
    }
    const start = el.selectionStart ?? correctionDraft.length;
    const end = el.selectionEnd ?? correctionDraft.length;
    const next =
      correctionDraft.slice(0, start) + snippet + correctionDraft.slice(end);
    onChangeCorrectionDraft(next);

    // Place caret right inside `[EW:|]` or `(|)` for rapid clinical entry on iPad/Android
    const caretOffset = snippet.endsWith(':]')
      ? snippet.length - 1
      : snippet === '()'
      ? 1
      : snippet.length;

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + caretOffset, start + caretOffset);
    });
  };

  const handleClear = () => {
    if (!text.trim()) return;
    if (window.confirm('Clear all text in the SALT Convention Box?')) {
      onChangeText('');
    }
  };

  return (
    <section className="pane-card" aria-label="SALT Convention Box">
      <div className="pane-header">
        <div className="pane-title-group">
          {headerLeft ?? (
            <>
              <h2 className="pane-title">SALT Coding</h2>
              <span className="pane-count-badge">{lines.length}</span>
            </>
          )}
        </div>

        {/* SALT workflow: Grammar Check -> Morphemes -> Clauses -> POS codes */}
        <div className="pane-toolbar pane-toolbar-wide">
          <div className="workflow-steps" role="group" aria-label="SALT coding steps">
            <button
              id="grammar-check-btn"
              type="button"
              className={`btn btn-sm ${grammarActive ? 'btn-danger' : 'btn-primary'}`}
              disabled={(!hasTranscript && !grammarActive) || disabled}
              onClick={onStartOrCancelGrammarCheck}
              title={
                grammarActive
                  ? 'Stop the grammar review'
                  : `Review child grammar and code SALT errors, omissions and mazes${
                      checkAllSentences ? ' (all lines)' : ''
                    }`
              }
            >
              {grammarActive ? <XCircle size={14} /> : <SpellCheck size={14} />}
              <span>{grammarActive ? 'Stop Review' : 'Grammar'}</span>
            </button>

            <button
              id="add-morphemes-btn"
              type="button"
              className={`btn btn-sm ${morphemesApplied ? 'btn-subtle step-done' : 'btn-secondary'}`}
              disabled={grammarActive || disabled || (!text.trim() && !hasTranscript)}
              onClick={onAddMorphemes}
              title="Apply SALT bound morphemes (/s, /z, /ed, /3s, /ing, contractions)"
            >
              <SplitSquareHorizontal size={14} />
              <span>Morphemes</span>
            </button>

            <button
              id="mark-clauses-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={grammarActive || disabled || (!text.trim() && !hasTranscript)}
              onClick={onOpenClauseCoder}
              title="Mark SALT clauses ([SI-0]..[SI-4+], [SI-X], [MC]/[SC]…) and compute Clausal Density"
            >
              <GitBranch size={14} />
              <span>Clauses</span>
            </button>

            <button
              id="pos-codes-btn"
              type="button"
              className={`btn btn-sm ${hasPosCodes(text) ? 'btn-subtle step-done' : 'btn-secondary'}`}
              disabled={grammarActive || disabled || (!text.trim() && !hasTranscript)}
              onClick={onTogglePosCodes}
              title={
                hasPosCodes(text)
                  ? 'Remove part-of-speech codes ([N], [V], …) from every word'
                  : 'Insert part-of-speech codes after every word, e.g. dog[N] run/3s[V]'
              }
              aria-pressed={hasPosCodes(text)}
            >
              <Palette size={14} />
              <span>POS</span>
            </button>

          </div>

          <OverflowMenu
            id="convention-menu-btn"
            label="SALT coding options"
            items={[
              {
                key: 'view',
                label: viewMode === 'highlighted' ? 'Edit as plain text' : 'Show coded lines',
                icon: viewMode === 'highlighted' ? <AlignLeft size={15} /> : <Eye size={15} />,
                onSelect: () =>
                  setViewMode((m) => (m === 'highlighted' ? 'raw' : 'highlighted')),
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
              ...(onToggleIpaTranscription
                ? [
                    {
                      key: 'ipa',
                      label: 'Show in IPA (broad)',
                      checked: showIpaTranscription,
                      disabled: grammarActive || disabled,
                      onSelect: onToggleIpaTranscription,
                    },
                  ]
                : []),
              {
                key: 'review-all',
                label: 'Grammar: review all lines',
                checked: checkAllSentences,
                disabled: grammarActive,
                onSelect: () => onToggleCheckAll(!checkAllSentences),
              },
              {
                key: 'clear',
                label: 'Clear SALT coding',
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
        {!text.trim() && !grammarActive && viewMode === 'highlighted' ? (
          <div className="pane-empty">
            <h3>Ready for SALT coding</h3>
            <p>
              Run <strong>Grammar</strong> to code child language errors, mazes, and
              omissions, <strong>Morphemes</strong> for bound inflectional morphemes (
              <code>/s</code>, <code>/ed</code>, <code>/ing</code>), and{' '}
              <strong>Clauses</strong> to score SALT Subordination Index (
              <code>[SI-1]</code>, <code>[SI-2]</code>) and Clausal Density.
            </p>
          </div>
        ) : viewMode === 'raw' ? (
          <textarea
            id="convention-textarea"
            className="pane-textarea mono"
            value={text}
            readOnly={locked || disabled}
            placeholder="SALT-coded transcript will appear here..."
            aria-label="SALT conventions text editor"
            onChange={(e) => onChangeText(e.target.value)}
          />
        ) : (
          <div className="utterance-list">
            {colorPartsOfSpeech && <PosLegend compact />}
            {lines.map((line) => {
              const clauseCoding = parseUtteranceClauseCoding(line.body);
              const siLabel = clauseCoding.isExcluded
                ? 'SI-X'
                : clauseCoding.clauseCount !== null
                ? `SI-${clauseCoding.clauseCount}`
                : '+SI';

              return (
                <div key={line.index} className={`utterance-row ${line.speakerSlot ?? ''}`}>
                  {line.timestampStr && (
                    <button
                      type="button"
                      className="utterance-ts-btn"
                      onClick={() => {
                        if (line.timestampSec !== null) {
                          onSeekToTime?.(line.timestampSec);
                        }
                      }}
                    >
                      {line.timestampStr}
                    </button>
                  )}

                  {line.speaker && (
                    <span className={`speaker-pill-btn ${line.speakerSlot ?? ''}`}>
                      {line.speaker}
                    </span>
                  )}

                  <span className="utterance-text">
                    {showIpaTranscription ? (
                      <IpaUtteranceText
                        body={line.body}
                        preserveSaltCodes
                        colorPartsOfSpeech={colorPartsOfSpeech}
                        renderSaltToken={renderSaltTokens}
                      />
                    ) : colorPartsOfSpeech ? (
                      <PosColoredText body={line.body} renderToken={renderSaltTokens} />
                    ) : (
                      renderSaltTokens(line.body)
                    )}
                  </span>

                  <button
                    type="button"
                    className={`utterance-si-pill ${
                      clauseCoding.isExcluded
                        ? 'excluded'
                        : clauseCoding.clauseCount !== null
                        ? 'scored'
                        : 'unmarked'
                    }`}
                    disabled={disabled || grammarActive}
                    onClick={() => onQuickCycleLineSi(line.index)}
                    title={
                      clauseCoding.isExcluded
                        ? 'Excluded from clausal density ([SI-X]) — click to cycle'
                        : clauseCoding.clauseCount !== null
                        ? `${clauseCoding.clauseCount} ${
                            clauseCoding.clauseCount === 1 ? 'clause' : 'clauses'
                          } — click to cycle SI count`
                        : 'Click to mark clause count ([SI-1], [SI-2], ...)'
                    }
                  >
                    {siLabel}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step-by-Step Correction Workbench (replaces desktop Correction Entry Box + Submit) */}
      {grammarActive && (
        <div className="correction-workbench" aria-label="Grammar correction review">
          <div className="correction-header">
            <span>
              Reviewing SALT Suggestion ({Math.max(1, grammarTotal - grammarRemaining)} of{' '}
              {grammarTotal})
            </span>
            <button
              id="auto-apply-remaining-btn"
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={onAutoApplyAllRemaining}
              title="Accept suggested SALT codes for this line and all remaining utterances"
            >
              <CheckCheck size={14} />
              <span>Auto-Apply Remaining</span>
            </button>
          </div>

          {currentOriginalLine && (
            <div className="correction-original">
              <strong>Original:</strong> {currentOriginalLine}
            </div>
          )}

          {/* One-Tap SALT Code Chips for iPad / Android / Fast Keyboard Entry */}
          <div className="correction-chips" role="toolbar" aria-label="Quick SALT code buttons">
            {SALT_TOUCH_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="salt-chip-btn"
                title={chip.title}
                onClick={() => insertSaltChip(chip.insert)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="correction-input-row">
            <textarea
              ref={correctionRef}
              id="correction-entry-box"
              className="correction-textarea"
              value={correctionDraft}
              onChange={(e) => onChangeCorrectionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmitCorrection();
                }
              }}
              aria-label="Edit suggested SALT correction"
            />
          </div>

          <div className="correction-actions">
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
              Press <kbd>Enter</kbd> to submit &amp; continue
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                id="skip-correction-btn"
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onSkipCorrection}
              >
                <FastForward size={14} />
                <span>Keep Original</span>
              </button>
              <button
                id="submit-grammar-btn"
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onSubmitCorrection}
              >
                <Check size={14} />
                <span>Submit</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {!grammarActive && grammarCheckPerformed && !morphemesApplied && (
        <div
          className="correction-workbench"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success)' }}>
            Grammar review complete — ready to add bound inflectional morphemes.
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAddMorphemes}
          >
            <SplitSquareHorizontal size={14} />
            <span>Add Morphemes</span>
          </button>
        </div>
      )}
    </section>
  );
}
