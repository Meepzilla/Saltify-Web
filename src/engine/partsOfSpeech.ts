import posTagger from 'wink-pos-tagger';
import type { SpeakerAliases } from '../types/saltify';
import { reconstructSurfaceWordFromSalt } from './clauseAnalysis';
import { stripPosCodes } from './posCodes';
import { parseUtteranceLines } from './transcriptFormat';

const tagger = posTagger();

export type PosCategory =
  | 'noun'
  | 'verb'
  | 'aux'
  | 'pronoun'
  | 'adjective'
  | 'adverb'
  | 'determiner'
  | 'preposition'
  | 'conjunction'
  | 'number'
  | 'interjection'
  | 'other';

export interface PosMeta {
  category: PosCategory;
  label: string;
  /** SALT-style word code inserted after the word, e.g. dog[N]. */
  code: string;
  example: string;
}

/** Display order for the legend and settings. */
export const POS_META: readonly PosMeta[] = [
  { category: 'noun', label: 'Noun', code: 'N', example: 'dog, mom' },
  { category: 'verb', label: 'Verb', code: 'V', example: 'run, is (copula)' },
  { category: 'aux', label: 'Auxiliary / Modal', code: 'AUX', example: 'is (running), can' },
  { category: 'pronoun', label: 'Pronoun', code: 'PRO', example: 'he, my, who' },
  { category: 'adjective', label: 'Adjective', code: 'ADJ', example: 'big, red' },
  { category: 'adverb', label: 'Adverb', code: 'ADV', example: 'fast, not' },
  { category: 'determiner', label: 'Determiner', code: 'DET', example: 'the, a, that' },
  { category: 'preposition', label: 'Preposition', code: 'PREP', example: 'in, on, to' },
  { category: 'conjunction', label: 'Conjunction', code: 'CONJ', example: 'and, because' },
  { category: 'number', label: 'Number', code: 'NUM', example: 'two, 3' },
  { category: 'interjection', label: 'Interjection', code: 'INT', example: 'oh, wow' },
  { category: 'other', label: 'Other', code: 'OTH', example: '' },
] as const;

const META_BY_CATEGORY = new Map(POS_META.map((m) => [m.category, m]));

export function getPosMeta(category: PosCategory): PosMeta {
  return META_BY_CATEGORY.get(category) ?? POS_META[POS_META.length - 1];
}

export { POS_CODE_RE, stripPosCodes, hasPosCodes } from './posCodes';

const SUBORDINATING_CONJUNCTIONS = new Set([
  'because',
  'cuz',
  'cos',
  'if',
  'although',
  'though',
  'unless',
  'whether',
  'while',
  'whereas',
]);

const AUX_LEMMAS = new Set([
  'be',
  'am',
  'is',
  'are',
  'was',
  'were',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  "'m",
  "'re",
  "'s",
  "'ve",
  "'d",
  "'ll",
]);

/** Child-language words the general-purpose tagger gets wrong. */
const WORD_CATEGORY_OVERRIDES = new Map<string, PosCategory>([
  // SALT English concatenatives behave as verbs
  ...[
    'gonna',
    'wanna',
    'gotta',
    'hafta',
    'useta',
    'sposta',
    'trynta',
    'liketa',
    'oughta',
    'coulda',
    'shoulda',
    'woulda',
    'musta',
    'lookit',
    'betcha',
    'whatcha',
  ].map((w) => [w, 'verb'] as [string, PosCategory]),
  // Interjections / yes-no words / sounds with specific meanings
  ...[
    'oh',
    'ooh',
    'wow',
    'oops',
    'oopsy',
    'uhoh',
    'yay',
    'hey',
    'hi',
    'bye',
    'ok',
    'okay',
    'yeah',
    'yep',
    'yes',
    'nope',
    'nah',
    'mhm',
    'uhhuh',
    'uhuh',
    'aha',
    'huh',
    'shh',
    'psst',
  ].map((w) => [w, 'interjection'] as [string, PosCategory]),
]);

const NOMINATIVE_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);

export function categoryFromPennTag(tag: string, word: string): PosCategory {
  const lower = word.toLowerCase();
  if (tag.startsWith('NN')) return 'noun';
  if (tag === 'MD') return 'aux';
  if (tag.startsWith('VB')) return 'verb';
  // WDT here is the relative pronoun "that/which" (the dog that barks)
  if (tag === 'PRP' || tag === 'PRP$' || tag === 'WP' || tag === 'WP$' || tag === 'EX' || tag === 'WDT') {
    return 'pronoun';
  }
  if (tag.startsWith('JJ')) return 'adjective';
  if (tag.startsWith('RB') || tag === 'WRB') return 'adverb';
  if (tag === 'DT' || tag === 'PDT') return 'determiner';
  if (tag === 'CC') return 'conjunction';
  if (tag === 'IN') return SUBORDINATING_CONJUNCTIONS.has(lower) ? 'conjunction' : 'preposition';
  if (tag === 'TO' || tag === 'RP') return 'preposition';
  if (tag === 'CD') return 'number';
  if (tag === 'UH') return 'interjection';
  return 'other';
}

export interface PosSegment {
  /** Exact text to display (a word token, maze, code, or whitespace). */
  text: string;
  /** Category for spoken words; null for whitespace, mazes, codes, comments, omissions. */
  category: PosCategory | null;
  /** Penn Treebank tag from the tagger, for tooltips. */
  tag: string | null;
}

/** SALT filled-pause words (plus common Whisper spellings). */
const FILLED_PAUSES = new Set(['um', 'uh', 'uhm', 'umm', 'uhh', 'er', 'erm', 'ah', 'eh', 'hm', 'hmm', 'mm']);

const TRAILING_PUNCT_RE = /[.,!?;:"'>^~]+$/;

/** Returns the word to send to the tagger for a SALT token, or null if it is not a spoken word. */
function taggableForm(token: string): string | null {
  let t = stripPosCodes(token);
  if (!t) return null;
  if (/^\[[^\]]*\][.,!?;:]*$/.test(t)) return null; // standalone code: [SI-1], [EU], [MC]
  if (t.startsWith('*')) return null; // omitted word: not spoken
  if (/^X{1,3}[.,!?>^]*$/.test(t)) return null; // unintelligible
  if (/^[.,!?;:>^~]+$/.test(t)) return null; // punctuation only

  // Error codes with a target: tag the intended word for a reliable category (goed[EO:went] -> went)
  const target = /\[E[A-Z]*:([^\]]+)\]/.exec(t)?.[1];
  t = t.replace(/\[[^\]]*\]/g, '').replace(TRAILING_PUNCT_RE, '');
  if (target) t = target;
  if (!t) return null;

  const bar = t.lastIndexOf('|');
  if (bar !== -1) t = t.slice(bar + 1);
  t = t.replace(/^%/, '').replace(/_/g, ' ').split(' ')[0];
  t = reconstructSurfaceWordFromSalt(t).replace(/\/\*[A-Za-z0-9']+$/, '');
  // Partial word "w*" is not a full spoken word
  if (/\*$/.test(t)) return null;
  // Filled pauses (um, uh…) are mazes in SALT, not parts of speech
  if (FILLED_PAUSES.has(t.toLowerCase())) return null;
  return t || null;
}

/** Splits a contraction into tagger tokens: "can't" -> ["can", "n't"], "I'm" -> ["I", "'m"]. */
function tokensForWord(word: string): string[] {
  const lower = word.toLowerCase();
  if (lower === "can't") return [word.slice(0, 3), "n't"];
  if (lower === "won't") return ['will', "n't"];
  if (lower === "don't") return [word.slice(0, 2), "n't"];
  const nt = /^(.+)(n't)$/i.exec(word);
  if (nt) return [nt[1], nt[2]];
  const clitic = /^(.+)('m|'re|'s|'ve|'d|'ll)$/i.exec(word);
  if (clitic) return [clitic[1], clitic[2]];
  return [word];
}

/**
 * Splits an utterance body into display segments and tags each spoken word with a part of speech.
 * Mazes, comments, SALT codes, omitted words and unintelligible markers are not tagged.
 */
export function tagUtteranceBody(body: string): PosSegment[] {
  const pieces = body.split(/(\s+)/).filter((p) => p.length > 0);
  const segments: PosSegment[] = [];
  const wordSlots: Array<{ segIdx: number; form: string }> = [];

  let mazeDepth = 0;
  let commentDepth = 0;
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) {
      segments.push({ text: piece, category: null, tag: null });
      continue;
    }
    const opensMaze = piece.includes('(');
    const opensComment = piece.includes('{');
    const inSkipped = mazeDepth > 0 || commentDepth > 0 || opensMaze || opensComment;
    if (opensMaze) mazeDepth += 1;
    if (opensComment) commentDepth += 1;
    if (piece.includes(')')) mazeDepth = Math.max(0, mazeDepth - 1);
    if (piece.includes('}')) commentDepth = Math.max(0, commentDepth - 1);

    const form = inSkipped ? null : taggableForm(piece);
    segments.push({ text: piece, category: null, tag: null });
    if (form) wordSlots.push({ segIdx: segments.length - 1, form });
  }

  if (wordSlots.length === 0) return segments;

  // Tag all words of the utterance together so the tagger can use context
  const rawTokens: string[] = [];
  const headIndex: number[] = [];
  for (const slot of wordSlots) {
    headIndex.push(rawTokens.length);
    rawTokens.push(...tokensForWord(slot.form));
  }
  const tagged = tagger.tagRawTokens(rawTokens) as Array<{ value: string; pos: string }>;

  for (let w = 0; w < wordSlots.length; w++) {
    const head = tagged[headIndex[w]];
    if (!head) continue;
    let tag = head.pos;
    const lower = head.value.toLowerCase();
    const prevLower = headIndex[w] > 0 ? tagged[headIndex[w] - 1].value.toLowerCase() : '';

    // Tagger fix-up: "we like it" (like/IN after a subject pronoun) is a verb
    if (lower === 'like' && tag === 'IN' && NOMINATIVE_PRONOUNS.has(prevLower)) tag = 'VBP';

    let category = WORD_CATEGORY_OVERRIDES.get(lower) ?? categoryFromPennTag(tag, head.value);

    // be/have/do followed by another verb is an auxiliary ("is running", "did go", "has eaten")
    if (category === 'verb' && AUX_LEMMAS.has(lower)) {
      for (let k = headIndex[w] + 1; k < tagged.length; k++) {
        const next = tagged[k];
        const nextLower = next.value.toLowerCase();
        if (next.pos.startsWith('RB') || nextLower === "n't" || nextLower === 'not') continue;
        if (next.pos === 'PRP' && k === headIndex[w] + 1) continue; // question inversion: "did you go"
        if (next.pos.startsWith('VB')) category = 'aux';
        break;
      }
    }

    const seg = segments[wordSlots[w].segIdx];
    seg.category = category;
    seg.tag = tag;
  }

  return segments;
}

/** Inserts a code after the word, before any trailing punctuation: "home." -> "home[N]." */
function appendCode(token: string, code: string): string {
  const punct = TRAILING_PUNCT_RE.exec(token)?.[0] ?? '';
  const core = punct ? token.slice(0, -punct.length) : token;
  return `${core}[${code}]${punct}`;
}

/**
 * Inserts part-of-speech word codes (dog[N], run/3s[V]) on every spoken word in the transcript,
 * replacing any previously inserted POS codes. Timestamps, speaker labels and SALT coding are kept.
 */
export function insertPosCodes(text: string, aliases: SpeakerAliases): string {
  const parsed = parseUtteranceLines(stripPosCodes(text), aliases);
  return parsed
    .map((line) => {
      if (!line.raw.trim()) return line.raw;
      const segments = tagUtteranceBody(line.body);
      const body = segments
        .map((s) => (s.category ? appendCode(s.text, getPosMeta(s.category).code) : s.text))
        .join('');
      const prefix = [line.timestampStr ? `[${line.timestampStr}]` : '', line.speaker ?? '']
        .filter(Boolean)
        .join(' ');
      return prefix ? `${prefix} ${body}` : body;
    })
    .join('\n');
}
