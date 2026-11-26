import { wordToBroadIpa } from './ipaTranscription';
import { compareWordsToHeard, splitIpa, type HeardPhone, type WordSoundComparison } from './speechSounds';

/** Tokens that are not spoken words: mazes, SALT codes, comments, unintelligible markers. */
export function isSpokenToken(token: string): boolean {
  if (/^[([{]/.test(token) || /^\[.*\]$/.test(token)) return false;
  if (/^X{1,3}[.,!?]*$/.test(token)) return false;
  return /[A-Za-z]/.test(token);
}

/**
 * Compares one utterance's interpreted words (dictionary pronunciation) with the heard sounds.
 * Returns a map from token index (whitespace-split body) to that word's comparison.
 * Requires the IPA dictionary to be loaded (ensureIpaDictionary).
 */
export function compareUtterance(body: string, heard: HeardPhone[]): Map<number, WordSoundComparison> {
  const tokens = body.split(/\s+/).filter(Boolean);
  const spoken = tokens.map((t, i) => ({ t, i })).filter(({ t }) => isSpokenToken(t));
  const rows = compareWordsToHeard(
    spoken.map(({ t }) => t),
    spoken.map(({ t }) => splitIpa(wordToBroadIpa(t))),
    heard.map(([p]) => p)
  );
  return new Map(spoken.map(({ i }, k) => [i, rows[k]]));
}
