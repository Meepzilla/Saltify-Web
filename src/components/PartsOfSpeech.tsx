import { useMemo, type ReactNode } from 'react';
import { getPosMeta, POS_META, tagUtteranceBody } from '../engine/partsOfSpeech';

/**
 * Renders an utterance body with each spoken word colored by part of speech.
 * `renderToken` lets the caller keep its own styling for non-word segments
 * (mazes, SALT codes) and for the word text itself (e.g. bound morpheme highlighting).
 */
export function PosColoredText({
  body,
  renderToken,
  decorateWord,
}: {
  body: string;
  renderToken?: (text: string) => ReactNode;
  /** Wraps the word at whitespace-token index `wordIndex` (e.g. uncertain-word highlighting). */
  decorateWord?: (wordIndex: number, node: ReactNode) => ReactNode;
}) {
  const segments = useMemo(() => tagUtteranceBody(body), [body]);
  // Whitespace-token index of each segment (-1 for whitespace), matching body.split(/\s+/)
  const wordIndices = useMemo(
    () =>
      segments.reduce<number[]>((acc, seg) => {
        const prevMax = acc.reduce((m, v) => Math.max(m, v), -1);
        acc.push(/^\s+$/.test(seg.text) ? -1 : prevMax + 1);
        return acc;
      }, []),
    [segments]
  );
  return (
    <>
      {segments.map((seg, idx) => {
        const isWhitespace = wordIndices[idx] < 0;
        const wordIndex = wordIndices[idx];
        const content = renderToken ? renderToken(seg.text) : seg.text;
        let node: ReactNode;
        if (!seg.category) {
          node = <span key={idx}>{content}</span>;
        } else {
          const meta = getPosMeta(seg.category);
          node = (
            <span
              key={idx}
              className={`pos-word pos-${seg.category}`}
              title={`${meta.label}${seg.tag ? ` (${seg.tag})` : ''}`}
            >
              {content}
            </span>
          );
        }
        return !isWhitespace && decorateWord ? (
          <span key={idx}>{decorateWord(wordIndex, node)}</span>
        ) : (
          node
        );
      })}
    </>
  );
}

/** Compact color key for the part-of-speech categories. */
export function PosLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`pos-legend ${compact ? 'compact' : ''}`}
      role="list"
      aria-label="Part of speech color key"
    >
      {POS_META.filter((m) => m.category !== 'other').map((m) => (
        <span key={m.category} role="listitem" className={`pos-legend-item pos-${m.category}`}>
          <span className="pos-legend-swatch" aria-hidden="true" />
          <span className="pos-legend-label">{m.label}</span>
          {!compact && <code className="pos-legend-code">[{m.code}]</code>}
        </span>
      ))}
    </div>
  );
}
