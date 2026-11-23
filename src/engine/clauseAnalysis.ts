import posTagger from 'wink-pos-tagger';
import type { InlineClauseTag, SpeakerAliases } from '../types/saltify';
import { conjugateThirdPersonSingular } from './saltConventions';
import { parseUtteranceLines } from './transcriptFormat';

const tagger = posTagger();

export const SI_CODE_REGEX = /\[SI-(\d+|X)\]/i;
export const SI_CODE_GLOBAL_REGEX = /\[SI-(\d+|X)\]/gi;
export const INLINE_CLAUSE_CODE_GLOBAL_REGEX = /\[(MC|SC|RC|AC|NC|CL)\]/gi;

export interface InlineClauseMeta {
  tag: InlineClauseTag;
  label: string;
  shortLabel: string;
  description: string;
  example: string;
}

export const INLINE_CLAUSE_META: readonly InlineClauseMeta[] = [
  {
    tag: 'MC',
    label: 'Main Clause',
    shortLabel: 'Main',
    description: 'Independent / matrix clause with subject + predicate',
    example: '[MC] The boy ran away',
  },
  {
    tag: 'SC',
    label: 'Subordinate Clause',
    shortLabel: 'Subord',
    description: 'General dependent / embedded clause',
    example: '[SC] that he saw',
  },
  {
    tag: 'RC',
    label: 'Relative Clause',
    shortLabel: 'Relative',
    description: 'Modifies a noun (who, that, which, whose)',
    example: '[RC] that was going to the store',
  },
  {
    tag: 'AC',
    label: 'Adverbial Clause',
    shortLabel: 'Adverb',
    description: 'Time, cause, or condition (because, when, if, while, after)',
    example: '[AC] because the dog barked',
  },
  {
    tag: 'NC',
    label: 'Nominal Clause',
    shortLabel: 'Nominal',
    description: 'Acts as subject or object (what happened, that he left)',
    example: '[NC] what happened in the story',
  },
  {
    tag: 'CL',
    label: 'Clause Marker',
    shortLabel: 'Clause',
    description: 'Generic clause boundary marker',
    example: '[CL] and the boxes fell',
  },
] as const;

export interface UtteranceClauseCoding {
  /** Explicit SALT Subordination Index code: 0..N or 'X' (excluded), or null if absent. */
  siCode: number | 'X' | null;
  /** Any inline clause boundary markers ([MC], [SC], [RC], [AC], [NC], [CL]) in order. */
  inlineClauseTags: InlineClauseTag[];
  /** Authoritative clause count for clausal density if scored, else null. */
  clauseCount: number | null;
  /** True when explicitly marked [SI-X] (excluded from clausal density). */
  isExcluded: boolean;
  /** True when the utterance contributes to clausal density numerator & denominator. */
  isScored: boolean;
  /** Where the clause score came from. */
  source: 'si' | 'inline' | 'none';
}

export interface ClauseEstimate {
  suggestedSi: number | 'X';
  reason: string;
}

/**
 * Extracts explicit SALT Subordination Index coding ([SI-0]..[SI-N], [SI-X]) and
 * optional inline clause markers ([MC], [SC], [RC], [AC], [NC], [CL]) from an utterance body.
 *
 * Non-double-counting rule:
 * - If an explicit [SI-N] or [SI-X] is present, it is authoritative for clause count / exclusion.
 * - Otherwise, if inline clause markers are present, their count supplies the utterance's clause count.
 */
export function parseUtteranceClauseCoding(body: string): UtteranceClauseCoding {
  const withoutMazes = body.replace(/\([^)]*\)/g, ' ');

  const inlineClauseTags: InlineClauseTag[] = [];
  for (const match of withoutMazes.matchAll(INLINE_CLAUSE_CODE_GLOBAL_REGEX)) {
    inlineClauseTags.push(match[1].toUpperCase() as InlineClauseTag);
  }

  let lastSiRaw: string | null = null;
  for (const match of withoutMazes.matchAll(SI_CODE_GLOBAL_REGEX)) {
    lastSiRaw = match[1].toUpperCase();
  }

  if (lastSiRaw !== null) {
    if (lastSiRaw === 'X') {
      return {
        siCode: 'X',
        inlineClauseTags,
        clauseCount: null,
        isExcluded: true,
        isScored: false,
        source: 'si',
      };
    }
    const parsedCount = parseInt(lastSiRaw, 10);
    return {
      siCode: parsedCount,
      inlineClauseTags,
      clauseCount: parsedCount,
      isExcluded: false,
      isScored: true,
      source: 'si',
    };
  }

  if (inlineClauseTags.length > 0) {
    return {
      siCode: null,
      inlineClauseTags,
      clauseCount: inlineClauseTags.length,
      isExcluded: false,
      isScored: true,
      source: 'inline',
    };
  }

  return {
    siCode: null,
    inlineClauseTags: [],
    clauseCount: null,
    isExcluded: false,
    isScored: false,
    source: 'none',
  };
}

/**
 * Sets, replaces, or clears the SALT Subordination Index code ([SI-0..N] or [SI-X])
 * on a single utterance line while preserving timestamp, speaker label, SALT error codes,
 * bound morphemes, inline clause markers, and terminal punctuation.
 *
 * Follows official SALT Software placement: `[SI-N]` right before terminal punctuation
 * (`.`, `?`, `!`, `>`, `^`), e.g. `[0:04] C He walk/ed home [SI-1].`
 */
export function setUtteranceSiCode(rawLine: string, siValue: number | 'X' | null): string {
  const trimmed = rawLine.trim();
  if (!trimmed) return '';

  let cleaned = trimmed
    .replace(/\s*\[SI-(?:\d+|X)\]\s*/gi, ' ')
    .replace(/\s+([.!?<>^]+)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (siValue === null) {
    return cleaned;
  }

  const normalizedTag =
    siValue === 'X' ? '[SI-X]' : `[SI-${Math.max(0, Math.floor(siValue))}]`;

  const trailingPunctMatch = cleaned.match(/([.!?]+|[>^]+)$/);
  if (trailingPunctMatch) {
    const punct = trailingPunctMatch[1];
    const stem = cleaned.slice(0, cleaned.length - punct.length).trimEnd();
    cleaned = stem ? `${stem} ${normalizedTag}${punct}` : `${normalizedTag}${punct}`;
  } else {
    cleaned = `${cleaned} ${normalizedTag}`;
  }

  return cleaned;
}

/**
 * Strips all [SI-*] and inline clause codes from an entire transcript.
 */
export function stripAllClauseCodes(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return '';
      return line
        .replace(/\s*\[SI-(?:\d+|X)\]\s*/gi, ' ')
        .replace(/\s*\[(?:MC|SC|RC|AC|NC|CL)\]\s*/gi, ' ')
        .replace(/\s+([.!?<>^]+)/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
    })
    .join('\n');
}

export interface UtteranceWordSlot {
  wordIndex: number;
  word: string;
  clauseTagBefore: InlineClauseTag | null;
}

/**
 * Parses an utterance body (excluding [SI-*]) into display words and any inline
 * clause tag immediately preceding each word, enabling 1-tap boundary marking.
 */
export function parseBodyIntoClauseWordSlots(body: string): UtteranceWordSlot[] {
  const withoutSi = body
    .replace(/\s*\[SI-(?:\d+|X)\]\s*/gi, ' ')
    .replace(/\s+([.!?<>^]+)/g, '$1')
    .trim();
  if (!withoutSi) return [];

  const tokens = withoutSi.split(/\s+/).filter(Boolean);
  const slots: UtteranceWordSlot[] = [];
  let pendingTag: InlineClauseTag | null = null;

  for (const tok of tokens) {
    const tagMatch = tok.match(/^\[(MC|SC|RC|AC|NC|CL)\]$/i);
    if (tagMatch) {
      pendingTag = tagMatch[1].toUpperCase() as InlineClauseTag;
      continue;
    }
    slots.push({
      wordIndex: slots.length,
      word: tok,
      clauseTagBefore: pendingTag,
    });
    pendingTag = null;
  }

  return slots;
}

/**
 * Inserts, changes, or removes an inline clause marker ([MC], [SC], [RC], [AC], [NC], [CL])
 * right before `wordIndex` in an utterance line, keeping the [SI-N] tag synchronized
 * whenever the line had no explicit [SI-*] or matched the previous inline clause count.
 */
export function setInlineClauseTagAtWord(
  rawLine: string,
  wordIndex: number,
  nextTag: InlineClauseTag | null,
  aliases: SpeakerAliases
): string {
  const parsed = parseUtteranceLines(rawLine, aliases)[0];
  if (!parsed) return rawLine;

  const prevCoding = parseUtteranceClauseCoding(parsed.body);
  const prevInlineCount = prevCoding.inlineClauseTags.length;

  const slots = parseBodyIntoClauseWordSlots(parsed.body);
  if (wordIndex < 0 || wordIndex >= slots.length) {
    return rawLine;
  }

  const updatedSlots = slots.map((slot) =>
    slot.wordIndex === wordIndex ? { ...slot, clauseTagBefore: nextTag } : slot
  );

  const nextInlineCount = updatedSlots.filter((s) => s.clauseTagBefore !== null).length;

  const rebuiltBody = updatedSlots
    .map((s) => (s.clauseTagBefore ? `[${s.clauseTagBefore}] ${s.word}` : s.word))
    .join(' ');

  const prefixParts: string[] = [];
  if (parsed.timestampStr) {
    prefixParts.push(
      parsed.timestampStr.startsWith('[') ? parsed.timestampStr : `[${parsed.timestampStr}]`
    );
  }
  if (parsed.speaker) prefixParts.push(parsed.speaker);
  const rebuiltLine =
    prefixParts.length > 0 ? `${prefixParts.join(' ')} ${rebuiltBody}` : rebuiltBody;

  const shouldSyncSi =
    prevCoding.siCode === null ||
    (typeof prevCoding.siCode === 'number' && prevCoding.siCode === prevInlineCount);

  if (shouldSyncSi) {
    return setUtteranceSiCode(rebuiltLine, nextInlineCount > 0 ? nextInlineCount : null);
  }
  return setUtteranceSiCode(rebuiltLine, prevCoding.siCode);
}

/**
 * Reconstructs an approximate plain English surface word from a SALT morpheme-coded
 * token (e.g. `walk/ed` -> `walked`, `go/3s` -> `goes`, `run/ing` -> `running`, `I/'m` -> `I'm`)
 * so `wink-pos-tagger` can accurately identify finite verbs even after "Add Morphemes" ran.
 */
export function reconstructSurfaceWordFromSalt(token: string): string {
  const slashIdx = token.indexOf('/');
  if (slashIdx === -1) return token;

  const root = token.slice(0, slashIdx);
  const suffixRaw = token.slice(slashIdx + 1);
  const punctMatch = suffixRaw.match(/([.,!?;:"'<>^]+)$/);
  const punct = punctMatch ? punctMatch[1] : '';
  const suffix = punct ? suffixRaw.slice(0, -punct.length) : suffixRaw;
  const lowerSuffix = suffix.toLowerCase();

  if (!root) return token;

  if (lowerSuffix === '*3s' || lowerSuffix === '3s') {
    return conjugateThirdPersonSingular(root) + punct;
  }
  if (lowerSuffix === '*ed' || lowerSuffix === 'ed') {
    const lowerRoot = root.toLowerCase();
    if (lowerRoot.endsWith('e')) return `${root}d${punct}`;
    if (/[^aeiou]y$/.test(lowerRoot)) return `${root.slice(0, -1)}ied${punct}`;
    return `${root}ed${punct}`;
  }
  if (lowerSuffix === '*ing' || lowerSuffix === 'ing') {
    const lowerRoot = root.toLowerCase();
    if (lowerRoot.endsWith('e') && !lowerRoot.endsWith('ee') && lowerRoot.length > 2) {
      return `${root.slice(0, -1)}ing${punct}`;
    }
    return `${root}ing${punct}`;
  }
  if (lowerSuffix === '*s' || lowerSuffix === 's') {
    const lowerRoot = root.toLowerCase();
    if (/(?:s|sh|ch|x|z)$/.test(lowerRoot)) return `${root}es${punct}`;
    if (/[^aeiou]y$/.test(lowerRoot)) return `${root.slice(0, -1)}ies${punct}`;
    return `${root}s${punct}`;
  }
  if (lowerSuffix === 'z' || lowerSuffix === '*z') {
    return `${root}'s${punct}`;
  }
  if (lowerSuffix === "n't") {
    return `${root}n't${punct}`;
  }
  if (lowerSuffix === "'t") {
    return `${root}'t${punct}`;
  }
  if (
    lowerSuffix === "'m" ||
    lowerSuffix === "'s" ||
    lowerSuffix === "'re" ||
    lowerSuffix === "'ll" ||
    lowerSuffix === "'d" ||
    lowerSuffix === "'ve"
  ) {
    return `${root}${suffix}${punct}`;
  }

  return root + punct;
}

const AUXILIARY_VERBS = new Set([
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  "'m",
  "'s",
  "'re",
  "'ve",
  "'ll",
  "'d",
]);

const CONTRACTED_VERB_HOSTS = new Set([
  'it',
  'that',
  'there',
  'here',
  'he',
  'she',
  'who',
  'what',
  'where',
  'when',
  'how',
  'why',
  'everything',
  'everyone',
  'everybody',
  'someone',
  'somebody',
  'something',
  'anyone',
  'anybody',
  'anything',
  'noone',
  'nobody',
  'nothing',
  'one',
]);

const NOMINATIVE_SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);

const COORDINATING_CONJUNCTIONS = new Set(['and', 'or', 'but', 'nor']);

const SUBORDINATING_MARKERS = new Set([
  'because',
  'cuz',
  'cos',
  'when',
  'while',
  'if',
  'after',
  'before',
  'until',
  'till',
  'unless',
  'although',
  'though',
  'since',
  'whereas',
  'whenever',
  'wherever',
  'whether',
  'that',
  'who',
  'whom',
  'whose',
  'which',
  'what',
  'where',
  'why',
  'how',
  'so',
]);

const DISCOURSE_OPENERS = new Set([
  'okay',
  'ok',
  'well',
  'hey',
  'oh',
  'uh',
  'um',
  'please',
  'now',
  'then',
  'so',
  'and',
  'but',
  'wait',
]);

const OMITTED_COPULA_OR_SUBJECT_RE =
  /(?:^|\s)\*(?:am|is|are|was|were|be|been|have|has|had|do|does|did|i|he|she|it|we|they|you)\b/i;

const CHILD_OVERREGULARIZED_VERBS = new Set([
  'telled',
  'goed',
  'runned',
  'eated',
  'falled',
  'comed',
  'maked',
  'taked',
  'seed',
  'sawed',
  'bringed',
  'buyed',
  'catched',
  'drawed',
  'drived',
  'drinked',
  'flyed',
  'flied',
  'gived',
  'growed',
  'holded',
  'keeped',
  'knowed',
  'leaved',
  'putted',
  'rided',
  'sayed',
  'sended',
  'singed',
  'sitted',
  'sleeped',
  'speaked',
  'standed',
  'swimmed',
  'teached',
  'thinked',
  'throwed',
  'waked',
  'weared',
  'winned',
  'writed',
  'breaked',
  'bited',
  'blowed',
  'builded',
  'choosed',
  'cutted',
  'digged',
  'doed',
  'feeled',
  'fighted',
  'finded',
  'forgetted',
  'freezed',
  'getted',
  'haved',
  'heared',
  'hided',
  'hitted',
  'hurted',
  'letted',
  'losed',
  'meeted',
  'payed',
  'readed',
  'ringed',
  'selled',
  'shaked',
  'shooted',
  'shutted',
  'slided',
  'spended',
  'stealed',
  'sticked',
  'swunged',
  'teared',
  'woked',
  'wented',
  'camed',
  'ated',
  'felled',
  'gotted',
  'broked',
  'tookd',
  'tooked',
  'raned',
]);

function prepareSpokenTextForClauseAnalysis(body: string): string {
  const withoutClauseAndMazes = body
    .replace(SI_CODE_GLOBAL_REGEX, ' ')
    .replace(INLINE_CLAUSE_CODE_GLOBAL_REGEX, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();

  if (!withoutClauseAndMazes) return '';

  const rawWords = withoutClauseAndMazes.split(/\s+/).filter(Boolean);
  const cleanWords: string[] = [];

  for (const word of rawWords) {
    if (/^\*[A-Za-z']+/.test(word) || /[A-Za-z']+\*$/.test(word)) {
      continue;
    }

    if (word.includes('[')) {
      const start = word.indexOf('[');
      const end = word.indexOf(']', start);
      if (end !== -1) {
        const inside = word.slice(start + 1, end);
        const trailingPunct = word.slice(end + 1);
        const colonIdx = inside.indexOf(':');
        if (colonIdx !== -1) {
          const replacement = inside.slice(colonIdx + 1).trim();
          if (replacement) {
            cleanWords.push(reconstructSurfaceWordFromSalt(replacement) + trailingPunct);
          }
        } else if (trailingPunct && cleanWords.length > 0) {
          cleanWords[cleanWords.length - 1] += trailingPunct;
        }
        continue;
      }
    }

    cleanWords.push(reconstructSurfaceWordFromSalt(word));
  }

  return cleanWords.join(' ').trim();
}

function isSentenceStartOrClauseOpener(
  tokens: Array<{ value: string; pos: string }>,
  idx: number
): boolean {
  if (idx === 0) return true;
  let j = idx - 1;
  while (j >= 0) {
    const val = tokens[j].value.toLowerCase();
    if (val === ',' || val === ':' || val === '"' || val === '“' || val === "'") {
      j -= 1;
      continue;
    }
    if (DISCOURSE_OPENERS.has(val)) {
      j -= 1;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Estimates a SALT Subordination Index (SI) clause count for a single utterance body,
 * following official SALT SI conventions:
 * - Incomplete (`>`), interrupted (`^`), or unintelligible (`XXX`/`XX`) -> `[SI-X]`
 * - Brief elliptical non-clausal responses ("Yes.", "Okay.") -> `[SI-X]`
 * - Verbless clauses or omitted obligatory copula/subject ("He *is happy.") -> `[SI-0]`
 * - Infinitives ("wanted to buy") and compound predicates ("jumped and laughed") -> same clause
 * - Subordinate clauses (relative, adverbial, nominal) & conjoined clauses with new subjects -> +1 clause each
 */
export function estimateUtteranceClauses(body: string): ClauseEstimate {
  const trimmed = body
    .replace(SI_CODE_GLOBAL_REGEX, ' ')
    .replace(INLINE_CLAUSE_CODE_GLOBAL_REGEX, ' ')
    .trim();

  if (!trimmed) {
    return { suggestedSi: 'X', reason: 'Empty utterance' };
  }

  if (/[>^]\s*$/.test(trimmed) || /\bX{2,}\b/i.test(trimmed)) {
    return { suggestedSi: 'X', reason: 'Incomplete, interrupted, or unintelligible' };
  }

  const hasOmittedObligatory = OMITTED_COPULA_OR_SUBJECT_RE.test(
    trimmed.replace(/\([^)]*\)/g, ' ')
  );

  const spoken = prepareSpokenTextForClauseAnalysis(trimmed);
  if (!spoken) {
    return { suggestedSi: 'X', reason: 'Non-verbal or maze-only utterance' };
  }

  const tokens = tagger.tagSentence(spoken);
  const wordTokens = tokens.filter((t) => /[A-Za-z0-9]/.test(t.value));
  if (wordTokens.length === 0) {
    return { suggestedSi: 'X', reason: 'No spoken words' };
  }

  interface PredicateSpan {
    startIdx: number;
    endIdx: number;
    isAuxOnly: boolean;
  }

  const predicates: PredicateSpan[] = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    const val = tok.value;
    const lower = val.toLowerCase();
    const pos = tok.pos;

    const prevTok = i > 0 ? tokens[i - 1] : null;
    const prevLower = prevTok ? prevTok.value.toLowerCase() : '';
    const prevPrevTok = i > 1 ? tokens[i - 2] : null;
    const prevPrevLower = prevPrevTok ? prevPrevTok.value.toLowerCase() : '';

    // Infinitive guard: `to` + `VB` (or `to` + adverb + `VB`) does NOT start a finite clause in SALT SI
    const isInfinitive =
      pos === 'VB' &&
      (prevLower === 'to' || (prevTok?.pos === 'RB' && prevPrevLower === 'to'));

    if (isInfinitive) {
      i += 1;
      continue;
    }

    const isContractedVerb =
      lower === "'m" ||
      lower === "'re" ||
      lower === "'ve" ||
      lower === "'ll" ||
      lower === "'d" ||
      (lower === "'s" && (pos !== 'POS' || CONTRACTED_VERB_HOSTS.has(prevLower)));

    const isStandardFiniteVerb =
      pos === 'VBD' || pos === 'VBP' || pos === 'VBZ' || pos === 'MD' || isContractedVerb;

    const isChildOverregularizedVerb =
      CHILD_OVERREGULARIZED_VERBS.has(lower) &&
      prevTok !== null &&
      (NOMINATIVE_SUBJECT_PRONOUNS.has(prevLower) ||
        prevTok.pos === 'NN' ||
        prevTok.pos === 'NNS' ||
        prevTok.pos === 'NNP' ||
        prevTok.pos === 'RB');

    const isImperative =
      pos === 'VB' &&
      !AUXILIARY_VERBS.has(lower) &&
      (isSentenceStartOrClauseOpener(tokens, i) || prevLower === '"' || prevLower === '“');

    const isInvertedQuestionMainVerb =
      pos === 'VB' &&
      prevTok !== null &&
      NOMINATIVE_SUBJECT_PRONOUNS.has(prevLower) &&
      prevPrevTok !== null &&
      AUXILIARY_VERBS.has(prevPrevLower);

    const isBarePresentAfterSubject =
      pos === 'VB' &&
      !isInvertedQuestionMainVerb &&
      prevTok !== null &&
      NOMINATIVE_SUBJECT_PRONOUNS.has(prevLower);

    if (
      !isStandardFiniteVerb &&
      !isChildOverregularizedVerb &&
      !isImperative &&
      !isBarePresentAfterSubject
    ) {
      i += 1;
      continue;
    }

    let endIdx = i;
    let isAuxOnly = AUXILIARY_VERBS.has(lower) || pos === 'MD';

    if (isAuxOnly) {
      let j = i + 1;
      while (j < tokens.length) {
        const nextVal = tokens[j].value.toLowerCase();
        const nextPos = tokens[j].pos;

        if (nextPos === 'RB' || nextVal === "n't" || nextVal === 'not' || nextVal === "'t") {
          j += 1;
          continue;
        }
        if (
          nextPos === 'VB' ||
          nextPos === 'VBG' ||
          nextPos === 'VBN' ||
          AUXILIARY_VERBS.has(nextVal)
        ) {
          endIdx = j;
          if (!AUXILIARY_VERBS.has(nextVal)) {
            isAuxOnly = false;
            j += 1;
            break;
          }
          j += 1;
          continue;
        }
        break;
      }
    }

    predicates.push({ startIdx: i, endIdx, isAuxOnly });
    i = endIdx + 1;
  }

  if (predicates.length === 0) {
    if (hasOmittedObligatory || wordTokens.length >= 4) {
      return {
        suggestedSi: 0,
        reason: hasOmittedObligatory
          ? '0 clauses (omitted obligatory verb/subject)'
          : '0 clauses (no finite verb)',
      };
    }
    return {
      suggestedSi: 'X',
      reason: 'Short non-clausal / elliptical response',
    };
  }

  // Count distinct clauses across predicate spans, filtering out:
  // 1) Inverted questions where a bare auxiliary precedes the subject and main verb ("Did you see?", "Can the boy go?")
  // 2) Compound predicates sharing a single subject ("He jumped and laughed")
  let clauseCount = 1;
  let lastClausePred = predicates[0];

  for (let p = 1; p < predicates.length; p++) {
    const curr = predicates[p];
    const between = tokens.slice(lastClausePred.endIdx + 1, curr.startIdx);

    const currStartTok = tokens[curr.startIdx];
    const prevStartLower = tokens[lastClausePred.startIdx]?.value.toLowerCase() ?? '';
    const isDoOrModalAux =
      lastClausePred.isAuxOnly &&
      (prevStartLower === 'do' ||
        prevStartLower === 'does' ||
        prevStartLower === 'did' ||
        tokens[lastClausePred.startIdx]?.pos === 'MD');

    if (
      isDoOrModalAux &&
      (currStartTok.pos === 'VB' || currStartTok.pos === 'VBP') &&
      between.length > 0 &&
      between.length <= 5
    ) {
      const hasClauseBreaker = between.some((t) => {
        const l = t.value.toLowerCase();
        return (
          COORDINATING_CONJUNCTIONS.has(l) ||
          SUBORDINATING_MARKERS.has(l) ||
          t.pos === 'WDT' ||
          t.pos === 'WP' ||
          t.pos === 'WRB' ||
          l === ',' ||
          l === ';'
        );
      });
      if (!hasClauseBreaker) {
        lastClausePred = {
          startIdx: lastClausePred.startIdx,
          endIdx: curr.endIdx,
          isAuxOnly: false,
        };
        continue;
      }
    }

    let coordIdx = -1;
    let hasSubordinator = false;
    for (let k = 0; k < between.length; k++) {
      const bLower = between[k].value.toLowerCase();
      const bPos = between[k].pos;
      if (COORDINATING_CONJUNCTIONS.has(bLower)) {
        coordIdx = k;
      }
      if (
        SUBORDINATING_MARKERS.has(bLower) ||
        bPos === 'WDT' ||
        bPos === 'WP' ||
        bPos === 'WP$' ||
        bPos === 'WRB'
      ) {
        hasSubordinator = true;
      }
    }

    if (coordIdx !== -1 && !hasSubordinator) {
      const afterCoord = between.slice(coordIdx + 1);
      const hasNewSubjectAfterCoord = afterCoord.some((t) => {
        const l = t.value.toLowerCase();
        return (
          t.pos === 'PRP' ||
          t.pos === 'NN' ||
          t.pos === 'NNS' ||
          t.pos === 'NNP' ||
          t.pos === 'NNPS' ||
          t.pos === 'DT' ||
          t.pos === 'EX' ||
          t.pos === 'WDT' ||
          t.pos === 'WP' ||
          CONTRACTED_VERB_HOSTS.has(l)
        );
      });

      if (!hasNewSubjectAfterCoord) {
        lastClausePred = curr;
        continue;
      }
    }

    clauseCount += 1;
    lastClausePred = curr;
  }

  const reason =
    clauseCount === 1
      ? '1 clause (simple)'
      : `${clauseCount} clauses (complex / multi-clause)`;

  return { suggestedSi: clauseCount, reason };
}

/**
 * Automatically applies suggested SALT [SI-*] codes across a transcript.
 * When `onlyUnmarked` is true, existing [SI-*] codes are preserved untouched.
 */
export function autoMarkClausesInTranscript(
  text: string,
  aliases: SpeakerAliases,
  options: {
    speakerFilter?: 'all' | 'speaker1' | 'speaker2';
    onlyUnmarked?: boolean;
  } = {}
): { text: string; updatedCount: number } {
  const { speakerFilter = 'all', onlyUnmarked = false } = options;
  const parsed = parseUtteranceLines(text, aliases);
  let updatedCount = 0;

  const lines = parsed.map((line) => {
    if (!line.raw.trim()) return '';
    if (speakerFilter !== 'all' && line.speakerSlot !== speakerFilter) {
      return line.raw;
    }

    const existing = parseUtteranceClauseCoding(line.body);
    if (onlyUnmarked && (existing.siCode !== null || existing.inlineClauseTags.length > 0)) {
      return line.raw;
    }

    const estimate = estimateUtteranceClauses(line.body);
    const updated = setUtteranceSiCode(line.raw, estimate.suggestedSi);
    if (updated !== line.raw) {
      updatedCount += 1;
    }
    return updated;
  });

  return { text: lines.join('\n'), updatedCount };
}
