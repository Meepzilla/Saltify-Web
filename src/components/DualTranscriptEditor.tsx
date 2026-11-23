import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eraser,
  FileText,
  Lock,
  Send,
  Sparkles,
  Unlock,
} from 'lucide-react';
import type { GrammarSessionState, SpeakerAliases } from '../types/session';
import { parseTranscriptLines } from '../lib/salt/speakers';

interface DualTranscriptEditorProps {
  transcriptionText: string;
  conventionText: string;
  transcriptionLocked: boolean;
  conventionLocked: boolean;
  hasAudio: boolean;
  aliases: SpeakerAliases;
  grammarState: GrammarSessionState;
  onChangeTranscription: (value: string) => void;
  onChangeConvention: (value: string) => void;
  onToggleTranscriptionLock: () => void;
  onToggleConventionLock: () => void;
  onClearTranscription: () => void;
  onClearConvention: () => void;
  onSeekToTimestamp: (seconds: number) => void;
  onLoadSample: () => void;
  onChangeGrammarDraft: (value: string) => void;
  onSubmitGrammarCorrection: () => void;
  onKeepOriginalSentence: () => void;
}

const SALT_QUICK_CODES = [
  { label: '[EW:]', insert: '[EW:]' },
  { label: '[EP:]', insert: '[EP:]' },
  { label: '[EO:]', insert: '[EO:]' },
  { label: '[EW]', insert: '[EW]' },
  { label: '/*3s', insert: '/*3s' },
  { label: '[EU]', insert: ' [EU]' },
  { label: 'XXX', insert: ' XXX' },
];

/**
 * Render inline SALT token highlighting (mazes, bracketed error codes, omitted markers, bound morphemes).
 */
function renderSaltHighlightedText(text: string): ReactNode[] {
  const regex = /(\([^)]+\)|\S*\[[^\]]+\]\S*|\S*\/\*[a-z0-9']+\S*|\S*\*[A-Za-z]+\S*|[A-Za-z]+\*|\S+\/(?:s|z|ed|3s|ing|'m|'s|'re|'ll|'ve|'d|'t|n't)\b)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    let cls = 'salt-token-morpheme';
    if (token.startsWith('(') && token.endsWith(')')) {
      cls = 'salt-token-maze';
    } else if (token.includes('[') || token.includes('*')) {
      cls = 'salt-token-error';
    }
    parts.push(
      <span key={`${match.index}-${token}`} className={cls}>
        {token}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function DualTranscriptEditor({
  transcriptionText,
  conventionText,
  transcriptionLocked,
  conventionLocked,
  hasAudio,
  aliases,
  grammarState,
  onChangeTranscription,
  onChangeConvention,
  onToggleTranscriptionLock,
  onToggleConventionLock,
  onClearTranscription,
  onClearConvention,
  onSeekToTimestamp,
  onLoadSample,
  onChangeGrammarDraft,
  onSubmitGrammarCorrection,
  onKeepOriginalSentence,
}: DualTranscriptEditorProps) {
  const [mobilePane, setMobilePane] = useState<'transcription' | 'convention'>('transcription');
  const [copiedPane, setCopiedPane] = useState<'transcription' | 'convention' | null>(null);
  const grammarInputRef = useRef<HTMLTextAreaElement | null>(null);

  const parsedTranscription = useMemo(
    () => parseTranscriptLines(transcriptionText, aliases),
    [transcriptionText, aliases]
  );

  const parsedConvention = useMemo(
    () => parseTranscriptLines(conventionText, aliases),
    [conventionText, aliases]
  );

  const transcriptLineCount = parsedTranscription.filter((l) => l.raw.trim()).length;
  const conventionLineCount = parsedConvention.filter((l) => l.raw.trim()).length;

  const handleCopy = async (pane: 'transcription' | 'convention', text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPane(pane);
      setTimeout(() => setCopiedPane((curr) => (curr === pane ? null : curr)), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const insertSaltCode = (snippet: string) => {
    const el = grammarInputRef.current;
    if (!el) {
      onChangeGrammarDraft(`${grammarState.currentSuggestion}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? grammarState.currentSuggestion.length;
    const end = el.selectionEnd ?? grammarState.currentSuggestion.length;
    const next =
      grammarState.currentSuggestion.slice(0, start) +
      snippet +
      grammarState.currentSuggestion.slice(end);
    onChangeGrammarDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = snippet.endsWith(':]') ? start + snippet.length - 1 : start + snippet.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <>
      {/* Segmented switcher shown on phones and portrait tablets */}
      <div className="mobile-pane-tabs" role="tablist" aria-label="Transcript panes">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'transcription'}
          className={`mobile-tab-btn ${mobilePane === 'transcription' ? 'is-active' : ''}`}
          onClick={() => setMobilePane('transcription')}
        >
          Transcription ({transcriptLineCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'convention'}
          className={`mobile-tab-btn ${mobilePane === 'convention' ? 'is-active' : ''}`}
          onClick={() => setMobilePane('convention')}
        >
          SALT Conventions ({conventionLineCount})
        </button>
      </div>

      <div className="dual-editor-grid">
        {/* LEFT PANE: TRANSCRIPTION BOX */}
        <section
          className={`card transcript-pane ${mobilePane === 'convention' ? 'is-hidden-mobile' : ''}`}
          aria-label="Transcription Box"
        >
          <div className="pane-header">
            <div className="pane-title-wrap">
              <h2 className="pane-title">Transcription Box</h2>
              <span className="pane-badge">{transcriptLineCount} lines</span>
            </div>
            <div className="pane-actions">
              <button
                id="btn-lock-transcription"
                type="button"
                className={`lock-pill-btn ${transcriptionLocked ? '' : 'is-unlocked'}`}
                onClick={onToggleTranscriptionLock}
                title={
                  transcriptionLocked
                    ? 'Unlock to manually edit transcription text'
                    : 'Lock for click-to-seek timestamp navigation and speaker color view'
                }
              >
                {transcriptionLocked ? <Lock size={12} /> : <Unlock size={12} />}
                {transcriptionLocked ? 'Locked' : 'Editing'}
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={!transcriptionText.trim()}
                onClick={() => handleCopy('transcription', transcriptionText)}
                title="Copy transcription text"
                aria-label="Copy transcription text"
              >
                {copiedPane === 'transcription' ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                id="btn-clear-transcription"
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={!transcriptionText.trim()}
                onClick={onClearTranscription}
                title="Clear transcription box"
                aria-label="Clear transcription box"
              >
                <Eraser size={14} />
              </button>
            </div>
          </div>

          <div className="pane-body">
            {!transcriptionLocked ? (
              <textarea
                id="textarea-transcription"
                className="transcript-textarea"
                value={transcriptionText}
                onChange={(e) => onChangeTranscription(e.target.value)}
                placeholder="Type or paste a transcript here (e.g. [0:00] C He walk to school.), or record/upload audio and click Transcribe."
                spellCheck={false}
              />
            ) : transcriptLineCount === 0 ? (
              <div className="transcript-empty">
                <FileText size={28} strokeWidth={1.6} aria-hidden="true" />
                <p>
                  Record or upload audio and press <strong>Transcribe Audio</strong>, unlock this box to type manually, or load a sample child transcript.
                </p>
                <button
                  id="btn-load-sample-empty"
                  type="button"
                  className="btn btn-sm"
                  onClick={onLoadSample}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  Load Sample Child Transcript
                </button>
              </div>
            ) : (
              <div className="transcript-reader" role="region" aria-label="Timestamped transcript">
                {parsedTranscription.map((line) => {
                  if (!line.raw.trim()) return null;
                  const roleClass =
                    line.speakerRole === 'speaker1'
                      ? 'is-speaker1'
                      : line.speakerRole === 'speaker2'
                        ? 'is-speaker2'
                        : '';
                  return (
                    <div key={line.index} className={`transcript-line ${roleClass}`}>
                      {line.timestampLabel && (
                        <button
                          type="button"
                          className="ts-chip"
                          disabled={!hasAudio || line.timestampSeconds === null}
                          onClick={() => {
                            if (line.timestampSeconds !== null) {
                              onSeekToTimestamp(line.timestampSeconds);
                            }
                          }}
                          title={
                            hasAudio
                              ? `Jump audio to ${line.timestampLabel}`
                              : 'Load audio to seek to timestamps'
                          }
                        >
                          {line.timestampLabel}
                        </button>
                      )}
                      {line.speakerLabel && (
                        <span className={`speaker-tag ${roleClass}`}>{line.speakerLabel}</span>
                      )}
                      <span className="line-text">{line.content}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE: CONVENTION BOX */}
        <section
          className={`card transcript-pane ${mobilePane === 'transcription' ? 'is-hidden-mobile' : ''}`}
          aria-label="SALT Convention Box"
        >
          <div className="pane-header">
            <div className="pane-title-wrap">
              <h2 className="pane-title">SALT Convention Box</h2>
              <span className="pane-badge">{conventionLineCount} lines</span>
            </div>
            <div className="pane-actions">
              <button
                id="btn-lock-convention"
                type="button"
                className={`lock-pill-btn ${conventionLocked ? '' : 'is-unlocked'}`}
                onClick={onToggleConventionLock}
                title={
                  conventionLocked
                    ? 'Unlock to manually edit SALT coded output'
                    : 'Lock to view color-coded SALT morphemes & error tags'
                }
              >
                {conventionLocked ? <Lock size={12} /> : <Unlock size={12} />}
                {conventionLocked ? 'Locked' : 'Editing'}
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={!conventionText.trim()}
                onClick={() => handleCopy('convention', conventionText)}
                title="Copy SALT conventions"
                aria-label="Copy SALT conventions"
              >
                {copiedPane === 'convention' ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                id="btn-clear-convention"
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={!conventionText.trim()}
                onClick={onClearConvention}
                title="Clear convention box"
                aria-label="Clear convention box"
              >
                <Eraser size={14} />
              </button>
            </div>
          </div>

          <div className="pane-body">
            {!conventionLocked ? (
              <textarea
                id="textarea-convention"
                className="transcript-textarea"
                value={conventionText}
                onChange={(e) => onChangeConvention(e.target.value)}
                placeholder="SALT error codes and bound inflectional morphemes (/s, /z, /ed, /3s, /ing) will appear here after running Grammar Check or Add Morphemes."
                spellCheck={false}
              />
            ) : conventionLineCount === 0 ? (
              <div className="transcript-empty">
                <Sparkles size={28} strokeWidth={1.6} aria-hidden="true" />
                <p>
                  Run <strong>Grammar Check</strong> to review child language errors step-by-step, or click <strong>Add Morphemes</strong> to apply SALT bound morpheme slashes.
                </p>
              </div>
            ) : (
              <div className="transcript-reader" role="region" aria-label="SALT coded output">
                {parsedConvention.map((line) => {
                  if (!line.raw.trim()) return null;
                  const roleClass =
                    line.speakerRole === 'speaker1'
                      ? 'is-speaker1'
                      : line.speakerRole === 'speaker2'
                        ? 'is-speaker2'
                        : '';
                  return (
                    <div key={line.index} className={`transcript-line ${roleClass}`}>
                      {line.timestampLabel && (
                        <button
                          type="button"
                          className="ts-chip"
                          disabled={!hasAudio || line.timestampSeconds === null}
                          onClick={() => {
                            if (line.timestampSeconds !== null) {
                              onSeekToTimestamp(line.timestampSeconds);
                            }
                          }}
                        >
                          {line.timestampLabel}
                        </button>
                      )}
                      {line.speakerLabel && (
                        <span className={`speaker-tag ${roleClass}`}>{line.speakerLabel}</span>
                      )}
                      <span className="line-text">{renderSaltHighlightedText(line.content)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* INTERACTIVE STEP-BY-STEP GRAMMAR REVIEW BAR */}
      {grammarState.active && (
        <section className="card grammar-review-card" aria-label="SALT grammar correction review">
          <div className="grammar-review-header">
            <div className="grammar-review-title">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                Review Suggested SALT Coding ({grammarState.currentIndex} of {grammarState.totalSentences})
              </span>
            </div>
            <div className="grammar-reasons">
              {grammarState.currentReasons.map((reason) => (
                <span key={reason} className="reason-chip">
                  {reason}
                </span>
              ))}
            </div>
          </div>

          <div className="salt-quick-chips">
            <span className="salt-quick-label">Insert SALT code:</span>
            {SALT_QUICK_CODES.map((item) => (
              <button
                key={item.label}
                type="button"
                className="salt-insert-chip"
                onClick={() => insertSaltCode(item.insert)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grammar-edit-row">
            <textarea
              ref={grammarInputRef}
              id="textarea-grammar-correction"
              className="grammar-edit-textarea"
              value={grammarState.currentSuggestion}
              onChange={(e) => onChangeGrammarDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  onSubmitGrammarCorrection();
                }
              }}
              aria-label="Edit SALT coded sentence before submitting"
              spellCheck={false}
            />
            <div className="grammar-edit-actions">
              <button
                id="btn-submit-correction"
                type="button"
                className="btn btn-primary"
                onClick={onSubmitGrammarCorrection}
                title="Accept this coded line and move to the next flagged sentence (Ctrl+Enter)"
              >
                <Send size={14} aria-hidden="true" />
                Submit
              </button>
              <button
                id="btn-keep-original"
                type="button"
                className="btn"
                onClick={onKeepOriginalSentence}
                title="Keep the original uncoded sentence as spoken"
              >
                Keep Original
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
