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
}: {
  body: string;
  renderToken?: (text: string) => ReactNode;
}) {
  const segments = useMemo(() => tagUtteranceBody(body), [body]);
  return (
    <>
      {segments.map((seg, idx) => {
        const content = renderToken ? renderToken(seg.text) : seg.text;
        if (!seg.category) return <span key={idx}>{content}</span>;
        const meta = getPosMeta(seg.category);
        return (
          <span
            key={idx}
            className={`pos-word pos-${seg.category}`}
            title={`${meta.label}${seg.tag ? ` (${seg.tag})` : ''}`}
          >
            {content}
          </span>
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
