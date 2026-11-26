/**
 * Word-level confidence for Whisper transcripts.
 *
 * The Whisper worker records the probability of every token it generates. Those token
 * probabilities are grouped into words (a word's confidence is its least-confident token),
 * aligned to the final `[M:SS] utterance` lines, and only uncertain words are kept so the
 * Transcript box can highlight where a clinician should listen again.
 *
 * Kept dependency-free so it can run in the Whisper Web Worker and in unit tests.
 */

/** Words below this probability are flagged as uncertain. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
/** Words below this probability are flagged as very uncertain. */
export const VERY_LOW_CONFIDENCE_THRESHOLD = 0.35;

export interface TokenProbability {
  /** Decoded token text, including its leading space when it starts a word (" dog"). */
  text: string;
  /** Probability (0–1) of the token Whisper chose at that step. */
  p: number;
}

export interface WordProbability {
  word: string;
  p: number;
  /** Second-opinion model's word at this position ('' = it heard no word here). */
  alt?: string;
  /** Second-opinion model's confidence for `alt`. */
  altP?: number;
}

/** When the second-opinion model disagrees, flag the word unless the primary was at least this sure. */
export const DISAGREEMENT_FLAG_BELOW = 0.9;

/** An uncertain word in a transcript line: whitespace-token index, the word, and its probability. */
export interface FlaggedWord {
  i: number;
  w: string;
  p: number;
  /** Second-opinion model's version ('' = it heard nothing), when the models disagreed. */
  a?: string;
  /** Second-opinion model's confidence. */
  ap?: number;
}

/** Uncertain words per transcript line, keyed by `confidenceLineKey(line body)`. */
export type WordConfidenceMap = Record<string, FlaggedWord[]>;

/** Letters/digits/apostrophes only, lowercase: used to compare words across formatting changes. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/**
 * Stable key for a transcript line's spoken text, ignoring timestamp/speaker prefixes,
 * maze parentheses, punctuation, case and spacing. Edited lines get a new key, so their
 * (now reviewed) highlights disappear.
 */
export function confidenceLineKey(body: string): string {
  return body
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)
    .join(' ');
}

/**
 * Groups Whisper token probabilities into words. Whisper's BPE marks a new word with a
 * leading space; punctuation-only pieces attach to the previous word. A word's confidence
 * is the minimum of its tokens' probabilities.
 */
export function groupTokensIntoWords(tokens: TokenProbability[]): WordProbability[] {
  const words: WordProbability[] = [];
  for (const tok of tokens) {
    if (!tok.text) continue;
    const startsWord = /^\s/.test(tok.text) || words.length === 0;
    const piece = tok.text.trim();
    if (!piece) continue;
    const isPunctOnly = !/[A-Za-z0-9]/.test(piece);
    if (startsWord && !(isPunctOnly && words.length > 0)) {
      words.push({ word: piece, p: tok.p });
    } else {
      const last = words[words.length - 1];
      last.word += piece;
      // Punctuation choice shouldn't make a word look uncertain
      if (!isPunctOnly) last.p = Math.min(last.p, tok.p);
    }
  }
  return words;
}

/**
 * Aligns recognized words (in order) to the whitespace tokens of each formatted transcript
 * line and returns the uncertain words per line. Tolerant of small formatting differences
 * (maze parentheses, dropped "..." or filler-only lines) by matching normalized words with
 * a short look-ahead.
 */
export function buildWordConfidenceMap(
  formattedTranscript: string,
  words: WordProbability[],
  threshold = LOW_CONFIDENCE_THRESHOLD
): WordConfidenceMap {
  const map: WordConfidenceMap = {};
  const stream = words
    .map((w) => ({ n: normalizeWord(w.word), p: w.p, w: w.word, alt: w.alt, altP: w.altP }))
    .filter((w) => w.n);
  let cursor = 0;

  for (const rawLine of formattedTranscript.split(/\r?\n/)) {
    const body = rawLine.replace(/^\[\d+:\d{2}\]\s*/, '').trim();
    if (!body) continue;
    const tokens = body.split(/\s+/);
    const flagged: FlaggedWord[] = [];

    tokens.forEach((tok, i) => {
      const n = normalizeWord(tok);
      if (!n) return;
      // Find this word within a short look-ahead window of the recognized stream
      for (let look = 0; look < 4 && cursor + look < stream.length; look++) {
        if (stream[cursor + look].n === n) {
          const match = stream[cursor + look];
          cursor += look + 1;
          const disagree = match.alt !== undefined && match.p < DISAGREEMENT_FLAG_BELOW;
          if (match.p < threshold || disagree) {
            const entry: FlaggedWord = { i, w: n, p: Math.round(match.p * 1000) / 1000 };
            if (disagree) {
              entry.a = match.alt;
              entry.ap = Math.round((match.altP ?? 0) * 1000) / 1000;
            }
            flagged.push(entry);
          }
          return;
        }
      }
    });

    if (flagged.length > 0) {
      const key = confidenceLineKey(body);
      map[key] = [...(map[key] ?? []), ...flagged];
    }
  }
  return map;
}

/** Uncertain words for one displayed line, verified against the current text of each token. */
export function flaggedWordsForLine(
  body: string,
  map: WordConfidenceMap | undefined | null
): Map<number, FlaggedWord> {
  const result = new Map<number, FlaggedWord>();
  if (!map) return result;
  const entries = map[confidenceLineKey(body)];
  if (!entries) return result;
  const tokens = body.split(/\s+/).filter(Boolean);
  for (const e of entries) {
    if (normalizeWord(tokens[e.i] ?? '') === e.w) result.set(e.i, e);
  }
  return result;
}

/** Total number of uncertain words still present in a transcript. */
export function countFlaggedWords(
  bodies: string[],
  map: WordConfidenceMap | undefined | null
): number {
  if (!map) return 0;
  return bodies.reduce((sum, b) => sum + flaggedWordsForLine(b, map).size, 0);
}

/**
 * Updates the confidence map after the clinician resolves one flagged word in a line:
 * re-keys the line to its edited text, removes the resolved flag, and shifts later word
 * indices when a word was removed.
 */
export function resolveFlagInMap(
  map: WordConfidenceMap | undefined | null,
  oldBody: string,
  newBody: string,
  wordIndex: number,
  removedWord: boolean
): WordConfidenceMap | undefined {
  if (!map) return undefined;
  const oldKey = confidenceLineKey(oldBody);
  const entries = map[oldKey];
  if (!entries) return map;
  const next: WordConfidenceMap = { ...map };
  delete next[oldKey];
  const remaining = entries
    .filter((e) => e.i !== wordIndex)
    .map((e) => (removedWord && e.i > wordIndex ? { ...e, i: e.i - 1 } : e));
  if (remaining.length > 0) {
    const newKey = confidenceLineKey(newBody);
    next[newKey] = [...(next[newKey] ?? []), ...remaining];
  }
  return next;
}
