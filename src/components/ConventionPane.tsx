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
import { useMemo, useRef, useState } from 'react';
import { parseUtteranceClauseCoding } from '../engine/clauseAnalysis';
import { hasPosCodes } from '../engine/posCodes';
import { parseUtteranceLines } from '../engine/transcriptFormat';
import type { SpeakerAliases } from '../types/saltify';
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
          <h2 className="pane-title">SALT Convention Box</h2>
          <span className="pane-count-badge">{lines.length} lines</span>
        </div>

        <div className="pane-toolbar">
          <button
            id="convention-view-toggle-btn"
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={() =>
              setViewMode((m) => (m === 'highlighted' ? 'raw' : 'highlighted'))
            }
          >
            {viewMode === 'highlighted' ? <AlignLeft size={14} /> : <Eye size={14} />}
            <span>{viewMode === 'highlighted' ? 'Edit Text' : 'SALT View'}</span>
          </button>

          <button
            id="convention-lock-btn"
            type="button"
            className={`btn btn-icon ${locked ? 'btn-subtle' : 'btn-primary'}`}
            title={
              locked
                ? 'Unlock to manually edit SALT conventions'
                : 'Lock SALT conventions box'
            }
            aria-label={locked ? 'Unlock convention box' : 'Lock convention box'}
            onClick={() => {
              const nextLocked = !locked;
              setLocked(nextLocked);
              if (!nextLocked) setViewMode('raw');
            }}
          >
            {locked ? <Lock size={15} /> : <Unlock size={15} />}
          </button>

          <button
            id="convention-clear-btn"
            type="button"
            className="btn btn-ghost btn-icon"
            title="Clear SALT Convention Box"
            aria-label="Clear SALT Convention Box"
            disabled={!text.trim() || disabled}
            onClick={handleClear}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Primary SALT Workflow Bar: Grammar Check -> Add Morphemes -> Mark Clauses */}
      <div className="pane-subtoolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            id="grammar-check-btn"
            type="button"
            className={`btn btn-sm ${grammarActive ? 'btn-danger' : 'btn-primary'}`}
            disabled={(!hasTranscript && !grammarActive) || disabled}
            onClick={onStartOrCancelGrammarCheck}
          >
            {grammarActive ? (
              <>
                <XCircle size={14} />
                <span>Stop Review</span>
              </>
            ) : (
              <>
                <SpellCheck size={14} />
                <span>Grammar Check</span>
              </>
            )}
          </button>

          <button
            id="add-morphemes-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={
              grammarActive ||
              disabled ||
              (!text.trim() && !hasTranscript)
            }
            onClick={onAddMorphemes}
            title="Apply SALT bound inflectional morphemes (/s, /z, /ed, /3s, /ing, contractions)"
          >
            <SplitSquareHorizontal size={14} />
            <span>{morphemesApplied ? 'Re-Apply Morphemes' : 'Add Morphemes'}</span>
          </button>

          <button
            id="mark-clauses-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={
              grammarActive ||
              disabled ||
              (!text.trim() && !hasTranscript)
            }
            onClick={onOpenClauseCoder}
            title="Mark SALT clauses ([SI-0]..[SI-4+], [SI-X] & inline [MC]/[SC]/[RC]/[AC]/[NC]) and compute Clausal Density"
          >
            <GitBranch size={14} />
            <span>Mark Clauses</span>
          </button>

          <button
            id="pos-codes-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={
              grammarActive ||
              disabled ||
              (!text.trim() && !hasTranscript)
            }
            onClick={onTogglePosCodes}
            title={
              hasPosCodes(text)
                ? 'Remove part-of-speech codes ([N], [V], …) from every word'
                : 'Insert part-of-speech codes after every word, e.g. dog[N] run/3s[V]'
            }
          >
            <Palette size={14} />
            <span>{hasPosCodes(text) ? 'Remove POS Codes' : 'POS Codes'}</span>
          </button>

          {onToggleIpaTranscription && (
            <button
              id="convention-ipa-toggle-btn"
              type="button"
              role="switch"
              aria-checked={showIpaTranscription}
              className={`btn btn-sm ${showIpaTranscription ? 'btn-primary' : 'btn-secondary'}`}
              disabled={grammarActive || disabled}
              onClick={onToggleIpaTranscription}
              title={
                showIpaTranscription
                  ? 'Switch back to standard English spelling'
                  : 'Convert SALT utterances to International Phonetic Alphabet (IPA) broad transcription'
              }
            >
              <span className="ipa-badge-glyph" aria-hidden="true">
                /ə/
              </span>
              <span>{showIpaTranscription ? 'IPA: On' : 'IPA'}</span>
            </button>
          )}
        </div>

        <label
          className="checkbox-row"
          style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}
          title="Review every single utterance instead of only flagged utterances"
        >
          <input
            type="checkbox"
            checked={checkAllSentences}
            disabled={grammarActive}
            onChange={(e) => onToggleCheckAll(e.target.checked)}
          />
          <span>Review all lines</span>
        </label>
      </div>

      <div className="pane-body">
        {!text.trim() && !grammarActive && viewMode === 'highlighted' ? (
          <div className="pane-empty">
            <h3>Ready for SALT coding</h3>
            <p>
              Run <strong>Grammar Check</strong> to code child language errors, mazes,
              and omissions, click <strong>Add Morphemes</strong> for bound inflectional
              morphemes (<code>/s</code>, <code>/ed</code>, <code>/ing</code>), and use{' '}
              <strong>Mark Clauses</strong> to score SALT Subordination Index (
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
