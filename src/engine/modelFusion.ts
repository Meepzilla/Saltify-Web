/**
 * Second-opinion comparison between two Whisper models.
 *
 * The same audio is transcribed by a primary and a secondary model. Their words are aligned
 * (edit-distance alignment on normalized words) and each primary word that the secondary heard
 * differently, or not at all, is annotated with the secondary's version.
 *
 * The transcript text itself stays the primary model's. On 90 LibriSpeech clips (clean, noisy,
 * and pitch-shifted "child-like" + noise), automatically merging the two models by confidence did
 * not beat Whisper Small alone (±0.4 WER points), while flagging disagreements raised the share of
 * Small's errors that get flagged for review from 57% to 69% at a similar flag precision.
 * So disagreements are surfaced for the clinician to decide, not applied automatically.
 *
 * Dependency-free so it runs in the Whisper Web Worker and in unit tests.
 */
import { normalizeWord, type WordProbability } from './wordConfidence';

type Op = { a: number | null; b: number | null };

/** Word-level edit-distance alignment (match 0, substitute 1, insert/delete 1). */
export function alignWordSequences(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const cost = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) cost[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) cost[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cost[at(i, j)] = Math.min(sub, cost[at(i - 1, j)] + 1, cost[at(i, j - 1)] + 1);
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[at(i, j)] === cost[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ a: i - 1, b: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && cost[at(i, j)] === cost[at(i - 1, j)] + 1) {
      ops.push({ a: i - 1, b: null });
      i -= 1;
    } else {
      ops.push({ a: null, b: j - 1 });
      j -= 1;
    }
  }
  return ops.reverse();
}

/**
 * Annotates primary words with the secondary model's version wherever they disagree:
 * `alt` is the secondary's word ('' when it heard no word there) and `altP` its confidence.
 * Agreeing words keep the higher of the two confidences.
 */
export function annotateDisagreements(
  primary: WordProbability[],
  secondary: WordProbability[]
): WordProbability[] {
  const out = primary.map((w) => ({ ...w }));
  const ops = alignWordSequences(
    primary.map((w) => normalizeWord(w.word)),
    secondary.map((w) => normalizeWord(w.word))
  );
  for (const op of ops) {
    if (op.a === null) continue;
    const pw = out[op.a];
    if (!normalizeWord(pw.word)) continue;
    if (op.b === null) {
      pw.alt = '';
      pw.altP = 0;
      continue;
    }
    const sw = secondary[op.b];
    if (normalizeWord(sw.word) === normalizeWord(pw.word)) {
      pw.p = Math.max(pw.p, sw.p);
    } else {
      pw.alt = sw.word;
      pw.altP = sw.p;
    }
  }
  return out;
}

/**
 * Puts `core` in the shape of `template`: same leading/trailing punctuation and initial
 * capitalization, so a swapped-in word fits the sentence ("rabbit." <- "wabbit.").
 */
export function shapeLike(template: string, core: string): string {
  const lead = /^[^A-Za-z0-9']*/.exec(template)?.[0] ?? '';
  const trail = /[^A-Za-z0-9']*$/.exec(template)?.[0] ?? '';
  const bare = core.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
  if (/^I('|$)/.test(bare)) return `${lead}${bare}${trail}`; // pronoun "I" is always capital
  const first = template.replace(/^[^A-Za-z]*/, '').charAt(0);
  const capitalized = first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
  const head = capitalized ? bare.charAt(0).toUpperCase() : bare.charAt(0).toLowerCase();
  return `${lead}${head}${bare.slice(1)}${trail}`;
}

/**
 * Replaces (or removes, when `replacement` is '') the word at whitespace-token `wordIndex` in an
 * utterance body, keeping its punctuation and capitalization. When the last word of a sentence is
 * removed, its sentence-final punctuation moves to the previous word.
 */
export function replaceWordInBody(body: string, wordIndex: number, replacement: string): string {
  const tokens = body.split(/\s+/).filter(Boolean);
  if (wordIndex < 0 || wordIndex >= tokens.length) return body;
  if (replacement.trim()) {
    tokens[wordIndex] = shapeLike(tokens[wordIndex], replacement.trim());
    return tokens.join(' ');
  }
  const removed = tokens[wordIndex];
  const terminal = /[.!?]+$/.exec(removed)?.[0] ?? '';
  tokens.splice(wordIndex, 1);
  if (terminal && wordIndex === tokens.length && tokens.length > 0) {
    const last = tokens.length - 1;
    tokens[last] = tokens[last].replace(/[,;:]+$/, '') + (/[.!?]$/.test(tokens[last]) ? '' : terminal);
  }
  // Keep the sentence capitalized when its first word was removed
  if (wordIndex === 0 && tokens.length > 0 && /^[A-Z]/.test(removed)) {
    tokens[0] = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1);
  }
  return tokens.join(' ');
}
