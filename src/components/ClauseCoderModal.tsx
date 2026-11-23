import {
  Check,
  Eraser,
  GitBranch,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  autoMarkClausesInTranscript,
  estimateUtteranceClauses,
  INLINE_CLAUSE_META,
  parseBodyIntoClauseWordSlots,
  parseUtteranceClauseCoding,
  setInlineClauseTagAtWord,
  setUtteranceSiCode,
  stripAllClauseCodes,
} from '../engine/clauseAnalysis';
import {
  computeSaltMetrics,
  describeMetricCalculation,
  type MetricCalculationKey,
} from '../engine/saltMetrics';
import { parseUtteranceLines } from '../engine/transcriptFormat';
import type { InlineClauseTag, SpeakerAliases } from '../types/saltify';
import { MetricCalculationTooltip } from './MetricCalculationTooltip';

interface ClauseCoderModalProps {
  open: boolean;
  text: string;
  aliases: SpeakerAliases;
  hasAudio?: boolean;
  onApplyText: (nextText: string) => void;
  onSeekToTime?: (seconds: number) => void;
  onClose: () => void;
}

type SpeakerFilter = 'all' | 'speaker1' | 'speaker2';

const QUICK_SI_VALUES: readonly number[] = [0, 1, 2, 3, 4];

export function ClauseCoderModal({
  open,
  text,
  aliases,
  hasAudio = false,
  onApplyText,
  onSeekToTime,
  onClose,
}: ClauseCoderModalProps) {
  const [draftText, setDraftText] = useState(text);
  const [speakerFilter, setSpeakerFilter] = useState<SpeakerFilter>('all');
  const [boundaryMode, setBoundaryMode] = useState(false);
  const [activeInlineTag, setActiveInlineTag] = useState<InlineClauseTag>('MC');
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const [selectedKpi, setSelectedKpi] = useState<MetricCalculationKey | null>(null);

  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const parsedLines = useMemo(
    () => parseUtteranceLines(draftText, aliases).filter((l) => l.raw.trim().length > 0),
    [draftText, aliases]
  );

  const visibleLines = useMemo(() => {
    if (speakerFilter === 'all') return parsedLines;
    return parsedLines.filter((l) => l.speakerSlot === speakerFilter);
  }, [parsedLines, speakerFilter]);

  const speaker1Count = useMemo(
    () => parsedLines.filter((l) => l.speakerSlot === 'speaker1').length,
    [parsedLines]
  );
  const speaker2Count = useMemo(
    () => parsedLines.filter((l) => l.speakerSlot === 'speaker2').length,
    [parsedLines]
  );

  const liveMetrics = useMemo(
    () => computeSaltMetrics(draftText, aliases),
    [draftText, aliases]
  );

  const summaryStats = useMemo(() => {
    if (speakerFilter === 'speaker1') return liveMetrics.speaker1;
    if (speakerFilter === 'speaker2') return liveMetrics.speaker2;
    return liveMetrics.speaker1.totalUtterances > 0
      ? liveMetrics.speaker1
      : liveMetrics.overall;
  }, [liveMetrics, speakerFilter]);

  const unmarkedVisibleCount = useMemo(() => {
    let count = 0;
    for (const line of visibleLines) {
      const coding = parseUtteranceClauseCoding(line.body);
      if (coding.siCode === null && coding.inlineClauseTags.length === 0) {
        count += 1;
      }
    }
    return count;
  }, [visibleLines]);

  const estimatesByIndex = useMemo(() => {
    const map = new Map<number, ReturnType<typeof estimateUtteranceClauses>>();
    for (const line of visibleLines) {
      map.set(line.index, estimateUtteranceClauses(line.body));
    }
    return map;
  }, [visibleLines]);

  const updateLineAtIndex = useCallback((lineIndex: number, updater: (raw: string) => string) => {
    setDraftText((prev) => {
      const rawLines = prev.split(/\r?\n/);
      if (lineIndex < 0 || lineIndex >= rawLines.length) return prev;
      rawLines[lineIndex] = updater(rawLines[lineIndex]);
      return rawLines.join('\n');
    });
  }, []);

  const handleSetLineSi = useCallback(
    (lineIndex: number, siValue: number | 'X' | null, advanceAfter = false) => {
      updateLineAtIndex(lineIndex, (raw) => setUtteranceSiCode(raw, siValue));
      setActiveLineIndex(lineIndex);
      if (advanceAfter) {
        const currentPos = visibleLines.findIndex((l) => l.index === lineIndex);
        if (currentPos !== -1 && currentPos + 1 < visibleLines.length) {
          const nextIdx = visibleLines[currentPos + 1].index;
          setActiveLineIndex(nextIdx);
          requestAnimationFrame(() => {
            rowRefs.current.get(nextIdx)?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            });
          });
        }
      }
    },
    [updateLineAtIndex, visibleLines]
  );

  const handleToggleWordClauseTag = useCallback(
    (lineIndex: number, wordIndex: number, currentTag: InlineClauseTag | null) => {
      const nextTag = currentTag === activeInlineTag ? null : activeInlineTag;
      updateLineAtIndex(lineIndex, (raw) =>
        setInlineClauseTagAtWord(raw, wordIndex, nextTag, aliases)
      );
      setActiveLineIndex(lineIndex);
    },
    [activeInlineTag, aliases, updateLineAtIndex]
  );

  const handleAutoMark = useCallback(() => {
    const onlyUnmarked = unmarkedVisibleCount > 0 && unmarkedVisibleCount < visibleLines.length;
    const { text: nextText } = autoMarkClausesInTranscript(draftText, aliases, {
      speakerFilter,
      onlyUnmarked,
    });
    setDraftText(nextText);
  }, [draftText, aliases, speakerFilter, unmarkedVisibleCount, visibleLines.length]);

  const handleClearMarks = useCallback(() => {
    if (speakerFilter === 'all') {
      setDraftText((prev) => stripAllClauseCodes(prev));
      return;
    }
    setDraftText((prev) => {
      const parsed = parseUtteranceLines(prev, aliases);
      return parsed
        .map((line) => {
          if (line.speakerSlot !== speakerFilter) return line.raw;
          return stripAllClauseCodes(line.raw);
        })
        .join('\n');
    });
  }, [speakerFilter, aliases]);

  // Fast keyboard shortcuts (0-5, X, Backspace, Up/Down) for desktop & iPad hardware keyboards
  useEffect(() => {
    if (!open || visibleLines.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (selectedKpi) {
          setSelectedKpi(null);
        } else {
          onClose();
        }
        return;
      }

      const currentPos = visibleLines.findIndex((l) => l.index === activeLineIndex);
      const effectivePos = currentPos === -1 ? 0 : currentPos;
      const effectiveLine = visibleLines[effectivePos];
      if (!effectiveLine) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const nextPos = Math.min(visibleLines.length - 1, effectivePos + 1);
        const nextIdx = visibleLines[nextPos].index;
        setActiveLineIndex(nextIdx);
        rowRefs.current.get(nextIdx)?.scrollIntoView({ block: 'nearest' });
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prevPos = Math.max(0, effectivePos - 1);
        const prevIdx = visibleLines[prevPos].index;
        setActiveLineIndex(prevIdx);
        rowRefs.current.get(prevIdx)?.scrollIntoView({ block: 'nearest' });
        return;
      }

      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleSetLineSi(effectiveLine.index, parseInt(e.key, 10), true);
        return;
      }

      if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleSetLineSi(effectiveLine.index, 'X', true);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleSetLineSi(effectiveLine.index, null, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, visibleLines, activeLineIndex, selectedKpi, handleSetLineSi, onClose]);

  if (!open) return null;

  const s1Label = aliases.speaker1.trim() || 'C';
  const s2Label = aliases.speaker2.trim() || 'E';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card clause-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clause-coder-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="clause-coder-title" className="modal-title">
              Mark Clauses &amp; Clausal Density (SALT SI)
            </h2>
            <p className="clause-modal-subtitle">
              Score clauses per utterance using SALT Subordination Index (<code>[SI-0]</code>–
              <code>[SI-4+]</code>, <code>[SI-X]</code> excluded) or mark inline clause boundaries.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close clause coder"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Clausal Density Dashboard */}
        <div className="clause-summary-bar" aria-live="polite">
          <div className="clause-summary-kpis">
            <button
              type="button"
              className={`clause-kpi primary clause-kpi-btn ${
                selectedKpi === 'clausalDensity' ? 'selected' : ''
              }`}
              aria-pressed={selectedKpi === 'clausalDensity'}
              title="Select to see how Clausal Density was calculated"
              onClick={() =>
                setSelectedKpi((prev) =>
                  prev === 'clausalDensity' ? null : 'clausalDensity'
                )
              }
            >
              <span className="clause-kpi-val" id="clause-modal-cd-value">
                {summaryStats.clausalDensity !== null
                  ? summaryStats.clausalDensity.toFixed(2)
                  : '—'}
              </span>
              <span className="clause-kpi-lbl">
                Clausal Density ({summaryStats.speaker})
              </span>
            </button>
            <button
              type="button"
              className={`clause-kpi clause-kpi-btn ${
                selectedKpi === 'totalClauses' ? 'selected' : ''
              }`}
              aria-pressed={selectedKpi === 'totalClauses'}
              title="Select to see how Total Clauses was calculated"
              onClick={() =>
                setSelectedKpi((prev) =>
                  prev === 'totalClauses' ? null : 'totalClauses'
                )
              }
            >
              <span className="clause-kpi-val" id="clause-modal-total-clauses">
                {summaryStats.totalClauses}
              </span>
              <span className="clause-kpi-lbl">Total Clauses</span>
            </button>
            <button
              type="button"
              className={`clause-kpi clause-kpi-btn ${
                selectedKpi === 'clauseScoredUtterances' ? 'selected' : ''
              }`}
              aria-pressed={selectedKpi === 'clauseScoredUtterances'}
              title="Select to see how Scored Utterances was calculated"
              onClick={() =>
                setSelectedKpi((prev) =>
                  prev === 'clauseScoredUtterances' ? null : 'clauseScoredUtterances'
                )
              }
            >
              <span className="clause-kpi-val">
                {summaryStats.clauseScoredUtterances} / {summaryStats.totalUtterances}
              </span>
              <span className="clause-kpi-lbl">Scored Utt</span>
            </button>
            <button
              type="button"
              className={`clause-kpi clause-kpi-btn ${
                selectedKpi === 'complexUtterancePercent' ? 'selected' : ''
              }`}
              aria-pressed={selectedKpi === 'complexUtterancePercent'}
              title="Select to see how Complex Utterance % was calculated"
              onClick={() =>
                setSelectedKpi((prev) =>
                  prev === 'complexUtterancePercent' ? null : 'complexUtterancePercent'
                )
              }
            >
              <span className="clause-kpi-val">
                {summaryStats.clauseScoredUtterances > 0
                  ? `${summaryStats.complexUtterancePercent}%`
                  : '—'}
              </span>
              <span className="clause-kpi-lbl">Complex (2+ Cl)</span>
            </button>
          </div>

          {selectedKpi && (
            <MetricCalculationTooltip
              breakdown={describeMetricCalculation(selectedKpi, summaryStats)}
              speakerLabel={summaryStats.speaker}
              accentVar={
                speakerFilter === 'speaker2'
                  ? 'var(--speaker2)'
                  : speakerFilter === 'speaker1' || liveMetrics.speaker1.totalUtterances > 0
                  ? 'var(--speaker1)'
                  : undefined
              }
              onClose={() => setSelectedKpi(null)}
            />
          )}

          <div className="clause-si-dist-row">
            <span className="clause-dist-pill">SI-0: {summaryStats.siDistribution.si0}</span>
            <span className="clause-dist-pill">SI-1: {summaryStats.siDistribution.si1}</span>
            <span className="clause-dist-pill accent">SI-2: {summaryStats.siDistribution.si2}</span>
            <span className="clause-dist-pill accent">
              SI-3+: {summaryStats.siDistribution.si3Plus}
            </span>
            <span className="clause-dist-pill muted">SI-X: {summaryStats.siDistribution.siX}</span>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="clause-toolbar">
          <div className="clause-filter-group" role="tablist" aria-label="Filter by speaker">
            <button
              type="button"
              role="tab"
              aria-selected={speakerFilter === 'all'}
              className={`btn btn-sm ${speakerFilter === 'all' ? 'btn-primary' : 'btn-subtle'}`}
              onClick={() => setSpeakerFilter('all')}
            >
              All ({parsedLines.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={speakerFilter === 'speaker1'}
              className={`btn btn-sm ${speakerFilter === 'speaker1' ? 'btn-primary' : 'btn-subtle'}`}
              onClick={() => setSpeakerFilter('speaker1')}
            >
              {s1Label} ({speaker1Count})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={speakerFilter === 'speaker2'}
              className={`btn btn-sm ${speakerFilter === 'speaker2' ? 'btn-primary' : 'btn-subtle'}`}
              onClick={() => setSpeakerFilter('speaker2')}
            >
              {s2Label} ({speaker2Count})
            </button>
          </div>

          <div className="clause-action-group">
            <button
              id="auto-mark-clauses-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={visibleLines.length === 0}
              onClick={handleAutoMark}
              title="Estimate SALT Subordination Index clause counts automatically on-device"
            >
              <Sparkles size={14} />
              <span>
                {unmarkedVisibleCount > 0 && unmarkedVisibleCount < visibleLines.length
                  ? `Auto-Fill (${unmarkedVisibleCount})`
                  : 'Auto-Mark Clauses'}
              </span>
            </button>

            <button
              id="toggle-boundary-mode-btn"
              type="button"
              className={`btn btn-sm ${boundaryMode ? 'btn-primary' : 'btn-subtle'}`}
              onClick={() => setBoundaryMode((v) => !v)}
              title="Tap individual words to insert [MC], [SC], [RC], [AC], or [NC] clause boundary markers"
            >
              <GitBranch size={14} />
              <span>{boundaryMode ? 'Boundaries On' : 'Mark Boundaries'}</span>
            </button>

            <button
              id="clear-clauses-btn"
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={visibleLines.length === 0}
              onClick={handleClearMarks}
              title="Clear all clause markers in the current view"
            >
              <Eraser size={14} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Inline Clause Boundary Tag Selector */}
        {boundaryMode && (
          <div className="clause-boundary-palette" role="toolbar" aria-label="Inline clause tag selector">
            <span className="clause-palette-label">Tap any word below to insert:</span>
            <div className="clause-palette-chips">
              {INLINE_CLAUSE_META.map((meta) => (
                <button
                  key={meta.tag}
                  type="button"
                  className={`clause-palette-chip ${activeInlineTag === meta.tag ? 'active' : ''}`}
                  title={`${meta.label}: ${meta.description} (e.g. ${meta.example})`}
                  onClick={() => setActiveInlineTag(meta.tag)}
                >
                  <code>[{meta.tag}]</code>
                  <span>{meta.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Utterance List */}
        <div className="modal-body clause-list-body">
          {visibleLines.length === 0 ? (
            <div className="pane-empty" style={{ padding: 24 }}>
              <h3>No utterances in this view</h3>
              <p>Switch speaker filter or transcribe/enter utterances first.</p>
            </div>
          ) : (
            visibleLines.map((line) => {
              const coding = parseUtteranceClauseCoding(line.body);
              const estimate = estimatesByIndex.get(line.index);
              const isFocused = activeLineIndex === line.index;
              const wordSlots = parseBodyIntoClauseWordSlots(line.body);
              const currentNumeric =
                typeof coding.siCode === 'number'
                  ? coding.siCode
                  : coding.source === 'inline'
                  ? coding.clauseCount
                  : null;

              return (
                <div
                  key={line.index}
                  ref={(el) => {
                    if (el) rowRefs.current.set(line.index, el);
                    else rowRefs.current.delete(line.index);
                  }}
                  className={`clause-utterance-card ${line.speakerSlot ?? ''} ${
                    isFocused ? 'focused' : ''
                  }`}
                  onClick={() => setActiveLineIndex(line.index)}
                >
                  <div className="clause-card-left">
                    <div className="clause-card-meta">
                      {line.timestampStr && (
                        <button
                          type="button"
                          className="utterance-ts-btn"
                          disabled={!hasAudio}
                          title={hasAudio ? 'Jump audio to utterance' : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasAudio && line.timestampSec !== null) {
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
                      {coding.inlineClauseTags.length > 0 && (
                        <span className="clause-inline-summary">
                          {coding.inlineClauseTags.map((t) => `[${t}]`).join(' ')}
                        </span>
                      )}
                    </div>

                    {boundaryMode ? (
                      <div className="clause-word-strip">
                        {wordSlots.map((slot) => (
                          <button
                            key={slot.wordIndex}
                            type="button"
                            className={`clause-word-btn ${
                              slot.clauseTagBefore ? 'has-tag' : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleWordClauseTag(
                                line.index,
                                slot.wordIndex,
                                slot.clauseTagBefore
                              );
                            }}
                            title={
                              slot.clauseTagBefore
                                ? `Click to replace or remove [${slot.clauseTagBefore}]`
                                : `Click to insert [${activeInlineTag}] before "${slot.word}"`
                            }
                          >
                            {slot.clauseTagBefore && (
                              <span className="salt-tok-clause">[{slot.clauseTagBefore}]</span>
                            )}
                            <span>{slot.word}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="clause-card-text">
                        {wordSlots.map((slot) => (
                          <span key={slot.wordIndex}>
                            {slot.clauseTagBefore && (
                              <span className="salt-tok-clause">[{slot.clauseTagBefore}]</span>
                            )}{' '}
                            {slot.word}
                          </span>
                        ))}
                      </div>
                    )}

                    {estimate && coding.siCode === null && coding.inlineClauseTags.length === 0 && (
                      <button
                        type="button"
                        className="clause-suggest-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetLineSi(line.index, estimate.suggestedSi, true);
                        }}
                        title={`Accept suggested ${
                          estimate.suggestedSi === 'X'
                            ? '[SI-X]'
                            : `[SI-${estimate.suggestedSi}]`
                        }`}
                      >
                        <Sparkles size={11} />
                        <span>
                          Suggest{' '}
                          <strong>
                            {estimate.suggestedSi === 'X'
                              ? '[SI-X]'
                              : `[SI-${estimate.suggestedSi}]`}
                          </strong>{' '}
                          · {estimate.reason}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* 1-Tap SI Score Segmented Control */}
                  <div
                    className="si-segmented-group"
                    role="group"
                    aria-label={`Clause count for line ${line.index + 1}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {QUICK_SI_VALUES.map((val) => {
                      const isActive = currentNumeric === val && !coding.isExcluded;
                      return (
                        <button
                          key={val}
                          type="button"
                          className={`si-seg-btn ${isActive ? 'active' : ''}`}
                          aria-pressed={isActive}
                          title={`${val} ${val === 1 ? 'clause' : 'clauses'} ([SI-${val}])`}
                          onClick={() =>
                            handleSetLineSi(line.index, isActive ? null : val, false)
                          }
                        >
                          {val}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      className={`si-seg-btn ${
                        currentNumeric !== null && currentNumeric >= 5 && !coding.isExcluded
                          ? 'active'
                          : ''
                      }`}
                      title="5+ clauses (tap to increment)"
                      onClick={() => {
                        const nextVal =
                          currentNumeric !== null && currentNumeric >= 5
                            ? currentNumeric + 1
                            : 5;
                        handleSetLineSi(line.index, nextVal, false);
                      }}
                    >
                      {currentNumeric !== null && currentNumeric >= 5 ? (
                        currentNumeric
                      ) : (
                        <Plus size={12} />
                      )}
                    </button>

                    <button
                      type="button"
                      className={`si-seg-btn excluded ${coding.isExcluded ? 'active' : ''}`}
                      aria-pressed={coding.isExcluded}
                      title="Exclude from clausal density ([SI-X]: abandoned, unintelligible, or elliptical)"
                      onClick={() =>
                        handleSetLineSi(line.index, coding.isExcluded ? null : 'X', false)
                      }
                    >
                      X
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer clause-modal-footer">
          <span className="clause-kbd-hint">
            Shortcuts: <kbd>0</kbd>–<kbd>5</kbd> or <kbd>X</kbd> to score &amp; advance ·{' '}
            <kbd>↑</kbd>/<kbd>↓</kbd> to step
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              id="apply-clauses-btn"
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onApplyText(draftText);
                onClose();
              }}
            >
              <Check size={14} />
              <span>Apply Clause Marks</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
