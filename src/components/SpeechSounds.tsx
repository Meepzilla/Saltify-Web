import { useMemo, type ReactNode } from 'react';
import type { SoundStatus, WordSoundComparison } from '../engine/speechSounds';
import {
  PROCESSES,
  processesInWord,
  type ProcessSummaryRow,
} from '../engine/phonologicalProcesses';

const STATUS_TITLE: Record<SoundStatus, string | undefined> = {
  match: undefined,
  different: 'Different from the expected sound',
  extra: 'Extra sound (not expected here)',
  missing: 'Expected but not heard',
};

/**
 * Interlinear view of one utterance: interpreted word / expected pronunciation / heard sounds,
 * plus any phonological processes detected in that word.
 */
export function SpeechSoundsLine({
  body,
  comparison,
  showProcesses = true,
  decorateWord,
}: {
  body: string;
  /** Per token index; null while the pronunciation dictionary loads. */
  comparison: Map<number, WordSoundComparison> | null;
  showProcesses?: boolean;
  decorateWord?: (wordIndex: number, node: ReactNode) => ReactNode;
}) {
  const tokens = useMemo(() => body.split(/\s+/).filter(Boolean), [body]);

  return (
    <span className="speech-sounds-line">
      {tokens.map((token, i) => {
        const row = comparison?.get(i);
        const wordNode = <span className="ss-word">{token}</span>;
        const processes = row && showProcesses ? processesInWord(row) : [];
        return (
          <span key={i} className={`ss-col ${row ? '' : 'ss-col-plain'}`}>
            {decorateWord ? decorateWord(i, wordNode) : wordNode}
            {row && (
              <>
                <span className="ss-expected" title="Expected pronunciation (dictionary)">
                  {row.expected.join('') || '—'}
                </span>
                <span className="ss-heard" title="Sounds heard in the recording">
                  {row.sequence.length === 0 ? <span className="ss-none">—</span> : null}
                  {row.sequence.map((h, k) => (
                    <span key={k} className={`ss-phone ${h.status}`} title={STATUS_TITLE[h.status]}>
                      {h.p}
                    </span>
                  ))}
                </span>
                {processes.length > 0 && (
                  <span className="ss-processes">
                    {processes.map((p, k) => (
                      <span
                        key={k}
                        className="ss-process"
                        title={`${PROCESSES[p.process].label}: ${PROCESSES[p.process].description}`}
                      >
                        {PROCESSES[p.process].short}
                        {p.from || p.to ? (
                          <span className="ss-process-change">
                            {' '}
                            {!p.to ? `−${p.from}` : !p.from ? `+${p.to}` : `${p.from}→${p.to}`}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                )}
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function SpeechSoundsLegend() {
  return (
    <div className="pos-legend compact ss-legend" role="note">
      <span className="ss-legend-item">
        <span className="ss-word">word</span> interpreted by Whisper
      </span>
      <span className="ss-legend-item">
        <span className="ss-expected">ɹæbɪt</span> expected
      </span>
      <span className="ss-legend-item">
        <span className="ss-heard">
          <span className="ss-phone different">w</span>
          <span className="ss-phone match">æbɪt</span>
        </span>{' '}
        heard
      </span>
      <span className="ss-legend-item">
        <span className="ss-phone different">w</span> different
      </span>
      <span className="ss-legend-item">
        <span className="ss-phone missing">s</span> not heard
      </span>
      <span className="ss-legend-item">
        <span className="ss-process">Gliding</span> process
      </span>
    </div>
  );
}

/** Table of phonological processes with percentage of occurrence. */
export function PhonologicalProcessSummary({
  rows,
  scopeLabel,
  wordCount,
}: {
  rows: ProcessSummaryRow[];
  scopeLabel: string;
  wordCount: number;
}) {
  return (
    <details className="pp-summary" open>
      <summary>
        <strong>Phonological processes</strong>
        <span className="pp-summary-meta">
          {rows.length === 0 ? 'none detected' : `${rows.length} found`} · {scopeLabel} · {wordCount} words analysed
        </span>
      </summary>
      {rows.length === 0 ? (
        <p className="pp-empty">
          No processes detected in content words. Processes are measured against the word as written, so
          tap any word and choose “Intended word…” if the transcript shows what was said rather than what
          was meant.
        </p>
      ) : (
        <div className="pp-table-wrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col" className="num" title="Times the process occurred / chances for it to occur">
                  Times / chances
                </th>
                <th scope="col" className="num" title="Percentage of occurrence: times it happened ÷ chances">
                  %
                </th>
                <th scope="col">Examples</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.process}>
                  <th scope="row" title={PROCESSES[r.process].description}>
                    {PROCESSES[r.process].label}
                  </th>
                  <td className="num mono">
                    {r.occurrences}/{r.opportunities}
                  </td>
                  <td className={`num mono ${r.percent !== null && r.percent >= 40 ? 'pp-high' : ''}`}>
                    {r.percent !== null ? `${r.percent}%` : '—'}
                  </td>
                  <td className="pp-examples">
                    {r.examples.map((ex, k) => (
                      <span key={k} className="pp-example">
                        {ex.word} <span className="ss-expected">{ex.expected}</span> →{' '}
                        <span className="ss-heard">{ex.heard || '—'}</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pp-note">
            Automatic and approximate: “expected” is the dictionary pronunciation of the word as written, and
            the heard sounds come from a speech-sound recognizer. Function words (the, and, is…) are skipped.
            Processes at 40% or more are highlighted. Tap a word and choose “Intended word…” to set what
            the child meant; the analysis updates.
          </p>
        </div>
      )}
    </details>
  );
}
