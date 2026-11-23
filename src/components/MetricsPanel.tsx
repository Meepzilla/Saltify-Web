import { BarChart3, ChevronDown, ChevronUp, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { SpeakerMetrics, TranscriptMetrics } from '../types/saltify';

interface MetricsPanelProps {
  metrics: TranscriptMetrics;
  alwaysExpanded?: boolean;
  canMarkClauses?: boolean;
  onOpenClauseCoder?: () => void;
}

function SpeakerMetricsCard({
  stats,
  accentVar,
}: {
  stats: SpeakerMetrics;
  accentVar?: string;
}) {
  const hasClauseData =
    stats.clauseScoredUtterances > 0 || stats.clauseExcludedUtterances > 0;

  return (
    <div className="metrics-speaker-card">
      <div className="metrics-speaker-title">
        <span style={{ color: accentVar ?? 'var(--text-primary)' }}>{stats.speaker}</span>
        <span className="pane-count-badge">
          {stats.totalUtterances} utt ({stats.completeIntelligibleUtterances} C&amp;I)
        </span>
      </div>
      <div className="metrics-grid">
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.mluMorphemes.toFixed(2)}</span>
          <span className="metric-cell-lbl">MLUm</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.mluWords.toFixed(2)}</span>
          <span className="metric-cell-lbl">MLUw</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.typeTokenRatio.toFixed(2)}</span>
          <span className="metric-cell-lbl">TTR</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.totalWords}</span>
          <span className="metric-cell-lbl">TNW</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.uniqueWords}</span>
          <span className="metric-cell-lbl">NDW</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">{stats.boundMorphemes}</span>
          <span className="metric-cell-lbl">Bound /m</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">
            {stats.mazeCount} ({stats.mazeWordPercent}%)
          </span>
          <span className="metric-cell-lbl">Mazes</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">
            {stats.errorCount + stats.omissionCount}
          </span>
          <span className="metric-cell-lbl">Errors/Omit</span>
        </div>
        <div className="metric-cell">
          <span className="metric-cell-val">
            {stats.wordsPerMinute !== null ? stats.wordsPerMinute : '—'}
          </span>
          <span className="metric-cell-lbl">WPM</span>
        </div>
        <div
          className="metric-cell"
          title="Clausal Density (SALT Subordination Index) = Total Clauses ÷ Scored Utterances"
        >
          <span
            className="metric-cell-val"
            style={{ color: stats.clausalDensity !== null ? 'var(--salt-clause)' : undefined }}
          >
            {stats.clausalDensity !== null ? stats.clausalDensity.toFixed(2) : '—'}
          </span>
          <span className="metric-cell-lbl">Clausal Density</span>
        </div>
        <div className="metric-cell" title="Total Clauses across Scored Utterances">
          <span className="metric-cell-val">
            {hasClauseData ? `${stats.totalClauses} (${stats.clauseScoredUtterances})` : '—'}
          </span>
          <span className="metric-cell-lbl">Clauses (Utt)</span>
        </div>
        <div className="metric-cell" title="Percent of scored utterances containing 2 or more clauses">
          <span className="metric-cell-val">
            {stats.clauseScoredUtterances > 0 ? `${stats.complexUtterancePercent}%` : '—'}
          </span>
          <span className="metric-cell-lbl">Complex (2+ Cl)</span>
        </div>
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
  alwaysExpanded = false,
  canMarkClauses = false,
  onOpenClauseCoder,
}: MetricsPanelProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const isOpen = alwaysExpanded || expanded;

  // Prefer Child (speaker1) metrics in compact ribbon when labeled, else Overall
  const primary =
    metrics.speaker1.totalUtterances > 0 ? metrics.speaker1 : metrics.overall;

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
            <span className="metric-inline">
              <strong>{primary.mluMorphemes.toFixed(2)}</strong>
              <span>MLUm</span>
            </span>
            <span className="metric-inline">
              <strong>{primary.mluWords.toFixed(2)}</strong>
              <span>MLUw</span>
            </span>
            <span className="metric-inline">
              <strong>{primary.totalWords}</strong>
              <span>TNW</span>
            </span>
            <span className="metric-inline">
              <strong>{primary.uniqueWords}</strong>
              <span>NDW</span>
            </span>
            <span className="metric-inline">
              <strong>{primary.typeTokenRatio.toFixed(2)}</strong>
              <span>TTR</span>
            </span>
            <span
              className="metric-inline"
              title="Clausal Density (SALT Subordination Index) = Total Clauses ÷ Scored Utterances"
            >
              <strong
                id="metrics-bar-clausal-density"
                style={{
                  color: primary.clausalDensity !== null ? 'var(--salt-clause)' : undefined,
                }}
              >
                {primary.clausalDensity !== null ? primary.clausalDensity.toFixed(2) : '—'}
              </strong>
              <span>CD (SI)</span>
            </span>
            {primary.clauseScoredUtterances > 0 && (
              <span className="metric-inline" title="Total scored clauses">
                <strong id="metrics-bar-total-clauses">{primary.totalClauses}</strong>
                <span>Clauses</span>
              </span>
            )}
            <span className="metric-inline">
              <strong>{primary.mazeWordPercent}%</strong>
              <span>Maze</span>
            </span>
            <span className="metric-inline">
              <strong>{primary.errorCount + primary.omissionCount}</strong>
              <span>Codes</span>
            </span>
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
            <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </span>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="metrics-expanded">
          <SpeakerMetricsCard stats={metrics.speaker1} accentVar="var(--speaker1)" />
          <SpeakerMetricsCard stats={metrics.speaker2} accentVar="var(--speaker2)" />
          <SpeakerMetricsCard stats={metrics.overall} />
        </div>
      )}
    </section>
  );
}
