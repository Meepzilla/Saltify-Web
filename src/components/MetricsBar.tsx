import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { SpeakerAliases } from '../types/session';
import { computeSaltMetrics, type MetricsSpeakerFilter } from '../lib/salt/metrics';

interface MetricsBarProps {
  sourceText: string;
  sourceLabel: 'Conventions' | 'Transcript';
  aliases: SpeakerAliases;
}

export function MetricsBar({ sourceText, sourceLabel, aliases }: MetricsBarProps) {
  const [filter, setFilter] = useState<MetricsSpeakerFilter>('all');

  const metrics = useMemo(
    () => computeSaltMetrics(sourceText, aliases, filter),
    [sourceText, aliases, filter]
  );

  return (
    <section className="card metrics-card" aria-label="SALT language sample metrics">
      <div className="metrics-header">
        <div className="metrics-title">
          <BarChart3 size={14} aria-hidden="true" />
          <span>SALT Sample Metrics · {sourceLabel}</span>
        </div>

        <div className="metrics-filter-group" role="tablist" aria-label="Filter metrics by speaker">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`metrics-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Speakers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'speaker1'}
            className={`metrics-filter-btn ${filter === 'speaker1' ? 'is-active' : ''}`}
            onClick={() => setFilter('speaker1')}
          >
            {aliases.speaker1 || 'C'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'speaker2'}
            className={`metrics-filter-btn ${filter === 'speaker2' ? 'is-active' : ''}`}
            onClick={() => setFilter('speaker2')}
          >
            {aliases.speaker2 || 'E'}
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-cell" title="Complete utterances analyzed">
          <span className="metric-label">Utterances</span>
          <span className="metric-value">{metrics.totalUtterances}</span>
        </div>
        <div className="metric-cell" title="Total Number of Words (main body, excluding mazes)">
          <span className="metric-label">TNW</span>
          <span className="metric-value">{metrics.totalWords}</span>
        </div>
        <div className="metric-cell" title="Number of Different Root Words">
          <span className="metric-label">NDW</span>
          <span className="metric-value">{metrics.uniqueWords}</span>
        </div>
        <div className="metric-cell" title="Type-Token Ratio (NDW / TNW)">
          <span className="metric-label">TTR</span>
          <span className="metric-value">{metrics.typeTokenRatio.toFixed(2)}</span>
        </div>
        <div className="metric-cell" title="Mean Length of Utterance in Words">
          <span className="metric-label">MLU-w</span>
          <span className="metric-value">{metrics.mluWords.toFixed(2)}</span>
        </div>
        <div className="metric-cell" title="Mean Length of Utterance in Morphemes">
          <span className="metric-label">MLU-m</span>
          <span className="metric-value">{metrics.mluMorphemes.toFixed(2)}</span>
        </div>
        <div className="metric-cell" title="Parenthesized mazes / repetitions">
          <span className="metric-label">Mazes</span>
          <span className="metric-value">{metrics.mazeCount}</span>
        </div>
        <div className="metric-cell" title="SALT error codes ([EW], [EP], [EO], /*3s, *)">
          <span className="metric-label">Error Codes</span>
          <span className="metric-value">{metrics.errorCodeCount}</span>
        </div>
      </div>
    </section>
  );
}
