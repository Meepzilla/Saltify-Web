/**
 * "Heard" speech sounds vs "interpreted" words.
 *
 * A phoneme recognizer (wav2vec2 trained to output IPA) transcribes the sounds actually produced,
 * independent of Whisper's word choice. This module lines those sounds up with each transcript
 * line and with the expected (dictionary) pronunciation of each interpreted word, so the clinician
 * sees e.g. "rabbit — expected /ɹæbɪt/, heard /wæbɪt/".
 *
 * Dependency-free (except the shared edit-distance alignment) so it is unit-testable.
 */
import { alignWordSequences } from './modelFusion';

/** One recognized sound: IPA symbol, time (s) in the recording, and recognizer confidence. */
export type HeardPhone = [phone: string, timeSec: number, confidence: number];

export interface SpeechSoundsRecord {
  /** Recognizer model id, so results can be recomputed if the model changes. */
  model: string;
  phones: HeardPhone[];
}

/** Precise utterance timing from Whisper (sub-second), keyed like the confidence map. */
export interface UtteranceSpan {
  /** confidenceLineKey(text) of the utterance when it was transcribed. */
  k: string;
  s: number;
  e: number;
}

/** Length marks (ː ˑ) and combining syllabic (U+0329) / nasal (U+0303) diacritics. */
const LENGTH_OR_DIACRITIC = /^(?:\u02D0|\u02D1|\u0329|\u0303)$/u;
const LENGTH_OR_DIACRITIC_GLOBAL = /\u02D0|\u02D1|\u0329|\u0303/gu;

const MULTI_CHAR = ['aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ', 'tʃ', 'dʒ', 'əl', 'ɚ'];

/** Splits an IPA string into phones (diphthongs and affricates stay together). */
export function splitIpa(ipa: string): string[] {
  const s = ipa.replace(/[ˈˌ/\s.|]/g, '').replace(/͡/g, '');
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (MULTI_CHAR.includes(two)) {
      out.push(two);
      i += 2;
    } else if (LENGTH_OR_DIACRITIC.test(s[i]) && out.length > 0) {
      out[out.length - 1] += s[i]; // length / diacritics attach to the previous phone
      i += 1;
    } else {
      out.push(s[i]);
      i += 1;
    }
  }
  // Letter-to-sound guesses for unknown words can double consonants ("webbit" → wɛbbɪt);
  // spoken English does not geminate within a word, so collapse identical neighbours.
  return out.filter((p, k) => Boolean(p) && p !== out[k - 1]);
}

/**
 * Normalizes a phone for comparison only (display keeps the recognizer's symbols):
 * drops length/syllabic marks and maps eSpeak-style variants onto broad General American IPA.
 */
export function comparablePhone(p: string): string {
  const base = p.replace(LENGTH_OR_DIACRITIC_GLOBAL, '');
  const map: Record<string, string> = {
    ɐ: 'ə',
    ᵻ: 'ɪ',
    ɾ: 't',
    ɝ: 'ɚ',
    ɜ: 'ɚ',
    r: 'ɹ',
    ɡ: 'g',
    ʔ: 't',
    // cot–caught merger (most of the western US, Canada): treat /ɔ/ and /ɑ/ as the same vowel
    ɔ: 'ɑ',
    ɒ: 'ɑ',
  };
  return map[base] ?? base;
}

/**
 * Heard phones for a time window, with a small margin so sounds at utterance edges are kept.
 */
export function phonesInWindow(phones: HeardPhone[], start: number, end: number, margin = 0.08): HeardPhone[] {
  return phones.filter(([, t]) => t >= start - margin && t < end + margin);
}

/**
 * Time window for a transcript line: Whisper's precise span when the line still matches it,
 * otherwise from the line's [M:SS] timestamp to the next timestamped line.
 */
export function lineWindow(
  lineKey: string,
  timestampSec: number | null,
  nextTimestampSec: number | null,
  spans: UtteranceSpan[] | undefined,
  usedSpans: Set<number>,
  durationSec: number
): { start: number; end: number } | null {
  if (spans) {
    const idx = spans.findIndex((sp, i) => !usedSpans.has(i) && sp.k === lineKey);
    if (idx >= 0) {
      usedSpans.add(idx);
      return { start: spans[idx].s, end: spans[idx].e };
    }
    // Edited line: lines and spans are both in time order, so take the next span after the
    // last one used (as long as it does not start before this line's [M:SS] timestamp).
    const lastUsed = usedSpans.size > 0 ? Math.max(...usedSpans) : -1;
    const next = lastUsed + 1;
    if (next < spans.length && (timestampSec === null || spans[next].s >= timestampSec - 0.05)) {
      const keyMatchesLater = spans.some((sp, i) => i > next && !usedSpans.has(i) && sp.k === lineKey);
      if (!keyMatchesLater) {
        usedSpans.add(next);
        return { start: spans[next].s, end: spans[next].e };
      }
    }
  }
  if (timestampSec === null) return null;
  const end = nextTimestampSec !== null && nextTimestampSec > timestampSec ? nextTimestampSec + 1 : durationSec;
  return { start: timestampSec, end: Math.min(end, timestampSec + 15) };
}

export type HeardStatus = 'match' | 'different' | 'extra';
export type SoundStatus = HeardStatus | 'missing';

export interface SoundItem {
  p: string;
  status: SoundStatus;
  /** Index into the word's expected phones (absent for extra sounds). */
  ei?: number;
  /** The expected phone this item stands for (absent for extra sounds). */
  expected?: string;
}

/** Same sound for comparison purposes (a flap [ɾ] counts as /t/ or /d/). */
export function samePhone(expected: string, heard: string): boolean {
  if (comparablePhone(expected) === comparablePhone(heard)) return true;
  return heard === 'ɾ' && comparablePhone(expected) === 'd';
}

export interface WordSoundComparison {
  /** The interpreted word as written in the transcript. */
  word: string;
  /** Expected phones from the dictionary pronunciation of the interpreted word. */
  expected: string[];
  /** Heard phones assigned to this word, with how each compares to the expected sounds. */
  heard: Array<{ p: string; status: HeardStatus }>;
  /** Expected phones that were not heard (possible omissions). */
  missing: string[];
  /** Heard and missing phones together, in spoken order (for display). */
  sequence: SoundItem[];
}

/**
 * Aligns the heard phones of a line to the expected phones of its interpreted words
 * (edit-distance alignment on comparable phones) and groups the result per word.
 * Heard phones that fall between words attach to the preceding word.
 */
export function compareWordsToHeard(
  words: string[],
  expectedPerWord: string[][],
  heard: string[]
): WordSoundComparison[] {
  const flatExpected: Array<{ p: string; w: number; i: number }> = [];
  expectedPerWord.forEach((phones, w) => phones.forEach((p, i) => flatExpected.push({ p, w, i })));
  const result: WordSoundComparison[] = words.map((word, w) => ({
    word,
    expected: expectedPerWord[w] ?? [],
    heard: [],
    missing: [],
    sequence: [],
  }));
  if (words.length === 0) return result;

  const ops = alignWordSequences(
    flatExpected.map((e) => comparablePhone(e.p)),
    heard.map(comparablePhone)
  );
  let currentWord = flatExpected.length > 0 ? flatExpected[0].w : 0;
  for (const op of ops) {
    if (op.a !== null) currentWord = flatExpected[op.a].w;
    const target = result[Math.min(currentWord, result.length - 1)];
    if (op.a !== null && op.b !== null) {
      const e = flatExpected[op.a];
      const same = samePhone(e.p, heard[op.b]);
      target.heard.push({ p: heard[op.b], status: same ? 'match' : 'different' });
      target.sequence.push({ p: heard[op.b], status: same ? 'match' : 'different', ei: e.i, expected: e.p });
    } else if (op.a !== null) {
      const e = flatExpected[op.a];
      target.missing.push(e.p);
      target.sequence.push({ p: e.p, status: 'missing', ei: e.i, expected: e.p });
    } else if (op.b !== null) {
      const item = { p: heard[op.b], status: 'extra' as const };
      target.heard.push(item);
      target.sequence.push(item);
    }
  }
  return result;
}
