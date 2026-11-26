import { BarChart3, ChevronDown, ChevronUp, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  compareToNorms,
  formatZScore,
  NORM_STATUS_LABELS,
  type NormComparison,
  type NormStatus,
} from '../engine/languageNorms';
import {
  describeMetricCalculation,
  type MetricCalculationKey,
} from '../engine/saltMetrics';
import type { ClientInfo, SpeakerMetrics, TranscriptMetrics } from '../types/saltify';
import { MetricCalculationTooltip } from './MetricCalculationTooltip';
import { NormsComparisonCard } from './NormsComparisonCard';

interface MetricsPanelProps {
  metrics: TranscriptMetrics;
  clientInfo?: ClientInfo;
  alwaysExpanded?: boolean;
  canMarkClauses?: boolean;
  onOpenClauseCoder?: () => void;
  onOpenClientInfo?: () => void;
}

/** Status dot shown next to metrics that were compared against age norms. */
function NormDot({ status }: { status?: NormStatus }) {
  if (!status) return null;
  return (
    <span
      className={`norm-dot norm-${status}`}
      title={`Age norm: ${NORM_STATUS_LABELS[status]}`}
      aria-label={`Age norm: ${NORM_STATUS_LABELS[status]}`}
    />
  );
}

function buildNormTitle(label: string, norm?: NormComparison): string {
  if (!norm) return `Click to see how ${label} was calculated`;
  const zPart = norm.z !== null ? `, z = ${formatZScore(norm.z)}` : '';
  return `${label} — Age norm: ${norm.rangeLabel} (${NORM_STATUS_LABELS[norm.status]}${zPart}). Click for details`;
}

type MetricScope = 'primary' | 'speaker1' | 'speaker2' | 'overall';

interface SelectedMetric {
  scope: MetricScope;
  key: MetricCalculationKey;
}

function SpeakerMetricsCard({
  scope,
  stats,
  accentVar,
  normByKey,
  selectedMetric,
  onSelectMetric,
}: {
  scope: 'speaker1' | 'speaker2' | 'overall';
  stats: SpeakerMetrics;
  accentVar?: string;
  normByKey?: ReadonlyMap<string, NormComparison>;
  selectedMetric: SelectedMetric | null;
  onSelectMetric: (scope: MetricScope, key: MetricCalculationKey) => void;
}) {
  const hasClauseData =
    stats.clauseScoredUtterances > 0 || stats.clauseExcludedUtterances > 0;

  const isSelected = (key: MetricCalculationKey) =>
    selectedMetric?.scope === scope && selectedMetric.key === key;

  const cells: Array<{
    key: MetricCalculationKey;
    value: string | number;
    label: string;
    highlightClause?: boolean;
  }> = [
    { key: 'mluMorphemes', value: stats.mluMorphemes.toFixed(2), label: 'MLUm' },
    { key: 'mluWords', value: stats.mluWords.toFixed(2), label: 'MLUw' },
    { key: 'typeTokenRatio', value: stats.typeTokenRatio.toFixed(2), label: 'TTR' },
    { key: 'totalWords', value: stats.totalWords, label: 'TNW' },
    { key: 'uniqueWords', value: stats.uniqueWords, label: 'NDW' },
    { key: 'boundMorphemes', value: stats.boundMorphemes, label: 'Bound /m' },
    {
      key: 'mazeWordPercent',
      value: `${stats.mazeCount} (${stats.mazeWordPercent}%)`,
      label: 'Mazes',
    },
    {
      key: 'errorAndOmissionCount',
      value: stats.errorCount + stats.omissionCount,
      label: 'Errors/Omit',
    },
    {
      key: 'wordsPerMinute',
      value: stats.wordsPerMinute !== null ? stats.wordsPerMinute : '—',
      label: 'WPM',
    },
    {
      key: 'clausalDensity',
      value: stats.clausalDensity !== null ? stats.clausalDensity.toFixed(2) : '—',
      label: 'Clausal Density',
      highlightClause: stats.clausalDensity !== null,
    },
    {
      key: 'totalClauses',
      value: hasClauseData ? `${stats.totalClauses} (${stats.clauseScoredUtterances})` : '—',
      label: 'Clauses (Utt)',
    },
    {
      key: 'complexUtterancePercent',
      value: stats.clauseScoredUtterances > 0 ? `${stats.complexUtterancePercent}%` : '—',
      label: 'Complex (2+ Cl)',
    },
  ];

  return (
    <div className="metrics-speaker-card">
      <div className="metrics-speaker-title">
        <span style={{ color: accentVar ?? 'var(--text-primary)' }}>{stats.speaker}</span>
        <span className="pane-count-badge">
          {stats.totalUtterances} utt ({stats.completeIntelligibleUtterances} C&amp;I)
        </span>
      </div>
      <div className="metrics-grid">
        {cells.map((cell) => {
          const active = isSelected(cell.key);
          const norm = normByKey?.get(cell.key);
          return (
            <button
              key={cell.key}
              type="button"
              className={`metric-cell metric-selectable ${active ? 'selected' : ''}`}
              aria-pressed={active}
              title={buildNormTitle(cell.label, norm)}
              onClick={() => onSelectMetric(scope, cell.key)}
            >
              <span
                className="metric-cell-val"
                style={{ color: cell.highlightClause ? 'var(--salt-clause)' : undefined }}
              >
                {cell.value}
              </span>
              <span className="metric-cell-lbl">
                {cell.label}
                <NormDot status={norm?.status} />
              </span>
            </button>
          );
        })}
      </div>

      {hasClauseData && (
        <div className="metrics-si-strip">
          <span>SI-0: {stats.siDistribution.si0}</span>
          <span>SI-1: {stats.siDistribution.si1}</span>
          <span>SI-2: {stats.siDistribution.si2}</span>
          <span>SI-3+: {stats.siDistribution.si3Plus}</span>
          {stats.siDistribution.siX > 0 && <span>SI-X: {stats.siDistribution.siX}</span>}
        </div>
      )}
    </div>
  );
}

export function MetricsPanel({
  metrics,
  clientInfo,
  alwaysExpanded = false,
  canMarkClauses = false,
  onOpenClauseCoder,
  onOpenClientInfo,
}: MetricsPanelProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [selectedMetric, setSelectedMetric] = useState<SelectedMetric | null>(null);
  const isOpen = alwaysExpanded || expanded;

  useEffect(() => {
    if (!selectedMetric) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedMetric(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedMetric]);

  // Prefer Child (speaker1) metrics in compact ribbon when labeled, else Overall
  const primaryIsSpeaker1 = metrics.speaker1.totalUtterances > 0;
  const primary = primaryIsSpeaker1 ? metrics.speaker1 : metrics.overall;

  const normsReport = useMemo(
    () => (clientInfo ? compareToNorms(primary, clientInfo) : null),
    [primary, clientInfo]
  );
  const normByKey = useMemo(
    () => new Map<string, NormComparison>((normsReport?.comparisons ?? []).map((c) => [c.key, c])),
    [normsReport]
  );

  const toggleMetric = (scope: MetricScope, key: MetricCalculationKey) => {
    setSelectedMetric((prev) =>
      prev && prev.scope === scope && prev.key === key ? null : { scope, key }
    );
  };

  const activeTooltipStats =
    selectedMetric === null
      ? null
      : selectedMetric.scope === 'primary'
      ? primary
      : selectedMetric.scope === 'speaker1'
      ? metrics.speaker1
      : selectedMetric.scope === 'speaker2'
      ? metrics.speaker2
      : metrics.overall;

  const activeTooltipAccent =
    selectedMetric?.scope === 'speaker1'
      ? 'var(--speaker1)'
      : selectedMetric?.scope === 'speaker2'
      ? 'var(--speaker2)'
      : selectedMetric?.scope === 'primary' && primaryIsSpeaker1
      ? 'var(--speaker1)'
      : undefined;

  const activeTooltipIsPrimary =
    selectedMetric !== null &&
    (selectedMetric.scope === 'primary' ||
      (primaryIsSpeaker1 && selectedMetric.scope === 'speaker1') ||
      (!primaryIsSpeaker1 && selectedMetric.scope === 'overall'));

  const activeNormComparison =
    activeTooltipIsPrimary && selectedMetric
      ? normByKey.get(selectedMetric.key)
      : undefined;

  const activeBreakdown =
    selectedMetric && activeTooltipStats
      ? describeMetricCalculation(
          selectedMetric.key,
          activeTooltipStats,
          metrics.durationSeconds
        )
      : null;

  const ribbonPills: Array<{
    key: MetricCalculationKey;
    value: string | number;
    label: string;
    valueId?: string;
    highlightClause?: boolean;
  }> = [
    { key: 'mluMorphemes', value: primary.mluMorphemes.toFixed(2), label: 'MLUm' },
    { key: 'mluWords', value: primary.mluWords.toFixed(2), label: 'MLUw' },
    { key: 'totalWords', value: primary.totalWords, label: 'TNW' },
    { key: 'uniqueWords', value: primary.uniqueWords, label: 'NDW' },
    { key: 'typeTokenRatio', value: primary.typeTokenRatio.toFixed(2), label: 'TTR' },
    {
      key: 'clausalDensity',
      value: primary.clausalDensity !== null ? primary.clausalDensity.toFixed(2) : '—',
      label: 'CD (SI)',
      valueId: 'metrics-bar-clausal-density',
      highlightClause: primary.clausalDensity !== null,
    },
    ...(primary.clauseScoredUtterances > 0
      ? [
          {
            key: 'totalClauses' as const,
            value: primary.totalClauses,
            label: 'Clauses',
            valueId: 'metrics-bar-total-clauses',
          },
        ]
      : []),
    { key: 'mazeWordPercent', value: `${primary.mazeWordPercent}%`, label: 'Maze' },
    {
      key: 'errorAndOmissionCount',
      value: primary.errorCount + primary.omissionCount,
      label: 'Codes',
    },
  ];

  return (
    <section className="metrics-bar" aria-label="SALT language sample analysis metrics">
      <div
        className="metrics-bar-header"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => {
          if (!alwaysExpanded) setExpanded((v) => !v);
        }}
        onKeyDown={(e) => {
          if (!alwaysExpanded && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.82rem',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            <BarChart3 size={15} />
            <span>SALT Metrics ({primary.speaker})</span>
          </span>

          <div className="metrics-summary-pills">
            {ribbonPills.map((pill) => {
              const active =
                selectedMetric?.scope === 'primary' && selectedMetric.key === pill.key;
              const norm = normByKey.get(pill.key);
              return (
                <button
                  key={pill.key}
                  type="button"
                  className={`metric-inline metric-inline-btn ${active ? 'selected' : ''}`}
                  aria-pressed={active}
                  title={buildNormTitle(pill.label, norm)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMetric('primary', pill.key);
                  }}
                >
                  <strong
                    id={pill.valueId}
                    style={{
                      color: pill.highlightClause ? 'var(--salt-clause)' : undefined,
                    }}
                  >
                    {pill.value}
                  </strong>
                  <span>{pill.label}</span>
                  <NormDot status={norm?.status} />
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {canMarkClauses && onOpenClauseCoder && (
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenClauseCoder();
              }}
              title="Open SALT Clause & Clausal Density Coder"
            >
              <GitBranch size={13} />
              <span>{primary.clauseScoredUtterances > 0 ? 'Edit Clauses' : 'Mark Clauses'}</span>
            </button>
          )}
          {!alwaysExpanded && (
            <button
              id="metrics-toggle-expand-btn"
              type="button"
              className="btn btn-ghost btn-icon"
              style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
              aria-label={isOpen ? 'Collapse detailed speaker metrics' : 'Expand detailed speaker metrics'}
              aria-expanded={isOpen}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          )}
        </div>
      </div>

      {activeBreakdown && activeTooltipStats && (
        <div className="metrics-tooltip-slot">
          <MetricCalculationTooltip
            breakdown={activeBreakdown}
            speakerLabel={activeTooltipStats.speaker}
            accentVar={activeTooltipAccent}
            normComparison={activeNormComparison}
            ageLabel={normsReport?.ageLabel}
            onClose={() => setSelectedMetric(null)}
          />
        </div>
      )}

      {isOpen && (
        <div className="metrics-expanded">
          <SpeakerMetricsCard
            scope="speaker1"
            stats={metrics.speaker1}
            accentVar="var(--speaker1)"
            normByKey={primaryIsSpeaker1 ? normByKey : undefined}
            selectedMetric={selectedMetric}
            onSelectMetric={toggleMetric}
          />
          <SpeakerMetricsCard
            scope="speaker2"
            stats={metrics.speaker2}
            accentVar="var(--speaker2)"
            selectedMetric={selectedMetric}
            onSelectMetric={toggleMetric}
          />
          <SpeakerMetricsCard
            scope="overall"
            stats={metrics.overall}
            normByKey={!primaryIsSpeaker1 ? normByKey : undefined}
            selectedMetric={selectedMetric}
            onSelectMetric={toggleMetric}
          />
          {normsReport && (
            <NormsComparisonCard
              report={normsReport}
              speakerLabel={primary.speaker}
              onOpenClientInfo={onOpenClientInfo}
            />
          )}
        </div>
      )}
    </section>
  );
}
