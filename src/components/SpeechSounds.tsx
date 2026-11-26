import { useMemo, type ReactNode } from 'react';
import { wordToBroadIpa } from '../engine/ipaTranscription';
import { compareWordsToHeard, splitIpa, type HeardPhone, type SoundStatus } from '../engine/speechSounds';

const STATUS_TITLE: Record<SoundStatus, string | undefined> = {
  match: undefined,
  different: 'Different from the expected sound',
  extra: 'Extra sound (not expected here)',
  missing: 'Expected but not heard',
};

/** Tokens that are not spoken words: mazes, SALT codes, comments, unintelligible markers. */
function isSpokenToken(token: string): boolean {
  if (/^[([{]/.test(token) || /^\[.*\]$/.test(token)) return false;
  if (/^X{1,3}[.,!?]*$/.test(token)) return false;
  return /[A-Za-z]/.test(token);
}

/**
 * Interlinear view of one utterance: interpreted word / expected pronunciation / heard sounds.
 * Heard sounds that differ from the expected ones are highlighted; expected sounds that were not
 * heard are shown struck through.
 */
export function SpeechSoundsLine({
  body,
  heard,
  dictionaryReady,
  decorateWord,
}: {
  body: string;
  heard: HeardPhone[];
  dictionaryReady: boolean;
  decorateWord?: (wordIndex: number, node: ReactNode) => ReactNode;
}) {
  const tokens = useMemo(() => body.split(/\s+/).filter(Boolean), [body]);
  const comparison = useMemo(() => {
    if (!dictionaryReady) return null;
    const spoken = tokens.map((t, i) => ({ t, i })).filter(({ t }) => isSpokenToken(t));
    const expected = spoken.map(({ t }) => splitIpa(wordToBroadIpa(t)));
    const rows = compareWordsToHeard(
      spoken.map(({ t }) => t),
      expected,
      heard.map(([p]) => p)
    );
    return new Map(spoken.map(({ i }, k) => [i, rows[k]]));
  }, [tokens, heard, dictionaryReady]);

  return (
    <span className="speech-sounds-line">
      {tokens.map((token, i) => {
        const row = comparison?.get(i);
        const wordNode = <span className="ss-word">{token}</span>;
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
    </div>
  );
}
