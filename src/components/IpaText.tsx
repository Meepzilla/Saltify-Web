import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ensureIpaDictionary,
  isIpaDictionaryLoaded,
  tokenizeUtteranceBodyToIpa,
} from '../engine/ipaTranscription';
import { getPosMeta, tagUtteranceBody, type PosCategory } from '../engine/partsOfSpeech';

/**
 * Lazily loads the CMU Pronouncing Dictionary chunk when IPA mode is active
 * and returns true once the full 135k-word lexicon is ready in memory.
 */
function useIpaDictionary(enabled: boolean): boolean {
  const [ready, setReady] = useState<boolean>(() => isIpaDictionaryLoaded());

  useEffect(() => {
    if (!enabled || ready) return;
    let cancelled = false;
    void ensureIpaDictionary().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);

  return ready;
}

interface IpaUtteranceTextProps {
  body: string;
  preserveSaltCodes?: boolean;
  colorPartsOfSpeech?: boolean;
  renderSaltToken?: (text: string) => ReactNode;
}

/**
 * Renders an utterance body in General American English broad IPA (/…/) with
 * authentic IPA Unicode symbols. Hovering or tapping any IPA word shows the
 * original orthographic word, and POS color-coding remains compatible when enabled.
 */
export function IpaUtteranceText({
  body,
  preserveSaltCodes = false,
  colorPartsOfSpeech = false,
  renderSaltToken,
}: IpaUtteranceTextProps) {
  const dictReady = useIpaDictionary(true);

  const items = useMemo(() => {
    // Re-run once the lazy CMUdict lexicon finishes loading into memory
    void dictReady;
    const segments = tokenizeUtteranceBodyToIpa(body, { preserveSaltCodes });
    const posCategories: Array<PosCategory | null> = colorPartsOfSpeech
      ? tagUtteranceBody(body)
          .filter((seg) => seg.category !== null)
          .map((seg) => seg.category)
      : [];

    let wordIdx = 0;
    const paired: Array<{ seg: (typeof segments)[number]; posCat: PosCategory | null }> = [];
    for (const seg of segments) {
      const posCat =
        seg.kind === 'word' && colorPartsOfSpeech
          ? (posCategories[wordIdx++] ?? null)
          : null;
      paired.push({ seg, posCat });
    }
    return paired;
  }, [body, preserveSaltCodes, colorPartsOfSpeech, dictReady]);

  if (items.length === 0) {
    return null;
  }

  const isCommentOnly =
    items.length === 1 &&
    items[0].seg.kind === 'code' &&
    items[0].seg.text.startsWith('{') &&
    items[0].seg.text.endsWith('}');

  const rendered = items.map(({ seg, posCat }, idx) => {
    if (seg.kind === 'space') {
      return <span key={idx}>{seg.text}</span>;
    }

    if (seg.kind === 'maze') {
      return (
        <span
          key={idx}
          className="salt-tok-maze ipa-maze"
          title={seg.original ? `Original maze: ${seg.original}` : undefined}
        >
          {seg.text}
        </span>
      );
    }

    if (seg.kind === 'code') {
      return (
        <span key={idx} className="ipa-salt-code">
          {renderSaltToken ? renderSaltToken(seg.text) : seg.text}
        </span>
      );
    }

    if (posCat) {
      const meta = getPosMeta(posCat);
      return (
        <span
          key={idx}
          className={`ipa-word pos-word pos-${posCat}`}
          title={seg.original ? `${seg.original} · ${meta.label}` : meta.label}
        >
          {seg.text}
        </span>
      );
    }

    return (
      <span
        key={idx}
        className="ipa-word"
        title={seg.original ? `Word: ${seg.original}` : undefined}
      >
        {seg.text}
      </span>
    );
  });

  if (isCommentOnly) {
    return <span className="ipa-utterance">{rendered}</span>;
  }

  return (
    <span className="ipa-utterance" lang="en-fonipa">
      <span className="ipa-slash" aria-hidden="true">
        /
      </span>
      {rendered}
      <span className="ipa-slash" aria-hidden="true">
        /
      </span>
    </span>
  );
}
