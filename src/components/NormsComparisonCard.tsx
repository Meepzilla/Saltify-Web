import { Info, Scale, UserRound } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  formatZScore,
  MIN_RELIABLE_UTTERANCES,
  NORM_STATUS_LABELS,
  type NormMetricKey,
  type NormsReport,
} from '../engine/languageNorms';

interface NormsComparisonCardProps {
  report: NormsReport;
  speakerLabel: string;
  onOpenClientInfo?: () => void;
}

export function NormsComparisonCard({
  report,
  speakerLabel,
  onOpenClientInfo,
}: NormsComparisonCardProps) {
  const [expandedNoteKey, setExpandedNoteKey] = useState<NormMetricKey | null>(null);

  return (
    <div className="metrics-speaker-card norms-card" aria-label="Age and context norms comparison">
      <div className="metrics-speaker-title norms-header">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Scale size={14} />
          Age &amp; Context Norms ({speakerLabel})
        </span>
        <span className="norms-header-meta">
          <span className="pane-count-badge">
            {report.ageLabel ? `CA ${report.ageLabel}` : 'No age'} · {report.contextLabel}
            {report.contextAssumed ? ' (assumed)' : ''}
          </span>
          {onOpenClientInfo && report.ageMonths !== null && (
            <button
              type="button"
              className="btn btn-ghost btn-sm norms-edit-btn"
              onClick={onOpenClientInfo}
              title="Edit age or sampling context in Client Info"
            >
              <UserRound size={12} />
              <span>Edit</span>
            </button>
          )}
        </span>
      </div>

      {report.unavailableReason ? (
        <div className="norms-empty">
          <span>{report.unavailableReason}</span>
          {onOpenClientInfo && (
            <button type="button" className="btn btn-subtle btn-sm" onClick={onOpenClientInfo}>
              <UserRound size={13} />
              <span>Open Client Info</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {report.smallSample && (
            <div className="norms-warning" role="note">
              Only {report.sampleUtterances} C&amp;I utterances — norms assume ≥ {MIN_RELIABLE_UTTERANCES}.
              Interpret with caution.
            </div>
          )}
          {report.contextAssumed && (
            <div className="norms-warning" role="note">
              Sampling context not set — comparing against conversation/play norms. Set it in Client Info
              for genre-matched comparisons.
            </div>
          )}
          <div className="norms-table-wrap">
            <table className="norms-table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Child</th>
                  <th scope="col">Norm</th>
                  <th scope="col">z</th>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {report.comparisons.map((c) => {
                  const hasNote = Boolean(c.note);
                  const noteOpen = hasNote && expandedNoteKey === c.key;
                  return (
                    <Fragment key={c.key}>
                      <tr
                        className={hasNote ? 'norms-row-clickable' : undefined}
                        title={c.note}
                        onClick={() => {
                          if (!hasNote) return;
                          setExpandedNoteKey((prev) => (prev === c.key ? null : c.key));
                        }}
                      >
                        <th scope="row">
                          <span className="norms-measure-cell">
                            <span>
                              {c.label}
                              {!c.contextMatch && (
                                <span
                                  className="norms-mismatch"
                                  title="Norm collected in a different sampling context"
                                >
                                  {' '}†
                                </span>
                              )}
                            </span>
                            {hasNote && (
                              <button
                                type="button"
                                className={`norms-info-btn ${noteOpen ? 'active' : ''}`}
                                aria-expanded={noteOpen}
                                aria-label={`Show note for ${c.label}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedNoteKey((prev) => (prev === c.key ? null : c.key));
                                }}
                              >
                                <Info size={12} />
                              </button>
                            )}
                          </span>
                        </th>
                        <td className="mono">{c.valueLabel}</td>
                        <td className="mono">{c.rangeLabel}</td>
                        <td className="mono">{formatZScore(c.z)}</td>
                        <td>
                          <span className={`norm-badge norm-${c.status}`}>
                            {NORM_STATUS_LABELS[c.status]}
                          </span>
                        </td>
                        <td className="norms-source">{c.source}</td>
                      </tr>
                      {noteOpen && c.note && (
                        <tr className="norms-note-row">
                          <td colSpan={6}>{c.note}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="norms-footnote">
            WNL = within ±1 SD · Borderline = −1 to −1.5 SD · Significant = ≤ −1.5 SD (reversed for mazes).
            {report.comparisons.some((c) => !c.contextMatch) &&
              ' † Norm collected in conversation/play — narrative & expository samples usually score higher.'}{' '}
            Tap or hover a row for caveats. Norms support, but never replace, clinical judgment and standardized testing.
          </p>
        </>
      )}
    </div>
  );
}
