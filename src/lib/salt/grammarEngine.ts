import {
  A_EXCEPTIONS,
  AN_EXCEPTIONS,
  COMMON_COUNT_NOUNS,
  COMMON_VERBS,
  IRREGULAR_PAST_VERBS,
  NON_PARTICIPLE_ING_WORDS,
  OVERGENERALIZED_PAST_VERBS,
  OVERGENERALIZED_PLURALS,
  PLURAL_QUANTIFIERS,
} from './lexicon';
import { splitSentences } from './morphology';

export interface SentenceCorrectionResult {
  original: string;
  coded: string;
  changed: boolean;
  reasons: string[];
}

const SINGULAR_3P_PRONOUNS = new Set(['he', 'she', 'it']);
const PLURAL_SUBJECT_PRONOUNS = new Set(['we', 'they', 'you']);
const SUBJECT_CASE_ERRORS: Record<string, string> = {
  me: 'I',
  him: 'he',
  her: 'she',
  them: 'they',
  us: 'we',
};

const VOWEL_START = /^[aeiou]/i;

function matchCase(template: string, replacement: string): string {
  if (!template) return replacement;
  if (template === template.toUpperCase() && template.length > 1) {
    return replacement.toUpperCase();
  }
  if (template[0] !== template[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function splitWordAndPunct(token: string): { core: string; punct: string } {
  const match = token.match(/^([^.,?!;:"”’]+)([.,?!;:"”’]*)$/);
  if (!match) return { core: token, punct: '' };
  return { core: match[1], punct: match[2] };
}

function pluralizeRegular(singular: string): string {
  const lower = singular.toLowerCase();
  if (
    lower.endsWith('s') ||
    lower.endsWith('x') ||
    lower.endsWith('z') ||
    lower.endsWith('ch') ||
    lower.endsWith('sh')
  ) {
    return `${singular}es`;
  }
  if (lower.endsWith('y') && lower.length > 1 && !/[aeiou]/.test(lower[lower.length - 2])) {
    return `${singular.slice(0, -1)}ies`;
  }
  return `${singular}s`;
}

function needsAn(nextWord: string): boolean {
  const lower = nextWord.toLowerCase();
  if (!lower || !/^[a-z]/.test(lower)) return false;
  if (AN_EXCEPTIONS.has(lower)) return true;
  if (A_EXCEPTIONS.has(lower)) return false;
  return VOWEL_START.test(lower);
}

/**
 * Analyze a single sentence and generate SALT error coding suggestions:
 * - Mazes / word repetitions: `(I I) I`
 * - Omitted 3rd-person singular -s: `walk/*3s`
 * - Word-level errors: `telled[EW:told]`, `are[EW:is]`
 * - Pronoun case errors: `Me[EP:I]`
 * - Extra words: `more[EW]`
 * - Omitted auxiliary/copula: `is*`, `are*`, `am*`
 */
export function analyzeSentence(
  input: string,
  speakerAliases: string[] = ['C', 'E']
): SentenceCorrectionResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { original: input, coded: '', changed: false, reasons: [] };
  }

  // Preserve leading [m:ss] timestamp and speaker label cleanly
  let prefix = '';
  let body = trimmed;

  const tsMatch = body.match(/^(\[\d+:\d+\])\s*(.*)$/);
  if (tsMatch) {
    prefix += `${tsMatch[1]} `;
    body = tsMatch[2];
  }

  const speakerPattern = new RegExp(
    `^(${[...new Set(['C', 'E', ...speakerAliases])]
      .filter(Boolean)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})\\s+(.*)$`
  );
  const spMatch = body.match(speakerPattern);
  if (spMatch) {
    prefix += `${spMatch[1]} `;
    body = spMatch[2];
  }

  const rawWords = body.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const reasons: string[] = [];

  const addReason = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  let i = 0;
  while (i < rawWords.length) {
    const raw = rawWords[i];

    // Skip tokens that already contain SALT error codes or mazes
    if (raw.includes('[') || raw.includes('(') || raw.includes(')') || raw.includes('/*')) {
      out.push(raw);
      i += 1;
      continue;
    }

    const { core, punct } = splitWordAndPunct(raw);
    const lower = core.toLowerCase();

    // 1. Repeated word mazes: e.g., "I I I" -> "(I I) I", "the the" -> "(the) the"
    let repeatCount = 0;
    let finalPunct = punct;
    while (i + repeatCount + 1 < rawWords.length) {
      const nextSplit = splitWordAndPunct(rawWords[i + repeatCount + 1]);
      if (nextSplit.core.toLowerCase() === lower && !rawWords[i + repeatCount + 1].includes('[')) {
        repeatCount += 1;
        if (nextSplit.punct) {
          finalPunct = nextSplit.punct;
        }
      } else {
        break;
      }
    }

    if (repeatCount > 0) {
      const mazeCopies = Array.from({ length: repeatCount }, () => core).join(' ');
      out.push(`(${mazeCopies}) ${core}${finalPunct}`);
      addReason(`Repeated word maze: "${core}"`);
      i += repeatCount + 1;
      continue;
    }

    const prevToken = out.length > 0 ? splitWordAndPunct(out[out.length - 1]).core : '';
    const prevLower = prevToken.toLowerCase();
    const prevPrevLower =
      out.length > 1 ? splitWordAndPunct(out[out.length - 2]).core.toLowerCase() : '';
    const nextToken = i + 1 < rawWords.length ? splitWordAndPunct(rawWords[i + 1]).core : '';
    const nextLower = nextToken.toLowerCase();

    // 2. Overgeneralized irregular past tense verbs (e.g., telled -> telled[EW:told], goed -> goed[EW:went])
    if (OVERGENERALIZED_PAST_VERBS[lower]) {
      const target = matchCase(core, OVERGENERALIZED_PAST_VERBS[lower]);
      out.push(`${core}[EW:${target}]${punct}`);
      addReason(`Irregular past tense: "${core}" → "${target}"`);
      i += 1;
      continue;
    }

    // 3. Overgeneralized irregular plurals (e.g., foots -> foots[EW:feet], childs -> childs[EW:children])
    if (OVERGENERALIZED_PLURALS[lower]) {
      const target = matchCase(core, OVERGENERALIZED_PLURALS[lower]);
      out.push(`${core}[EW:${target}]${punct}`);
      addReason(`Irregular plural: "${core}" → "${target}"`);
      i += 1;
      continue;
    }

    // 4. Subject pronoun case errors at clause start (e.g., "Me want", "Him is", "Her went", "Them are")
    if (
      SUBJECT_CASE_ERRORS[lower] &&
      (i === 0 || ['and', 'but', 'then', 'so', 'because', 'when'].includes(prevLower)) &&
      nextLower &&
      (COMMON_VERBS.has(nextLower) ||
        IRREGULAR_PAST_VERBS.has(nextLower) ||
        ['is', 'are', 'am', 'was', 'were', 'has', 'have', 'had', 'can', 'will', "don't", "didn't", "can't", "won't"].includes(
          nextLower
        ) ||
        nextLower.endsWith('ed') ||
        nextLower.endsWith('ing'))
    ) {
      // Avoid flagging possessive "Her dog barked" — require next word to be clearly verbal (not a noun after "her")
      const isHerPossessive = lower === 'her' && COMMON_COUNT_NOUNS.has(nextLower) && !COMMON_VERBS.has(nextLower);
      if (!isHerPossessive) {
        const target = matchCase(core, SUBJECT_CASE_ERRORS[lower]);
        out.push(`${core}[EP:${target}]${punct}`);
        addReason(`Pronoun case error: "${core}" → "${target}"`);
        i += 1;
        continue;
      }
    }

    // 5. Redundant double comparative/superlative ("more better", "most biggest")
    if (
      (lower === 'more' && (nextLower === 'better' || nextLower === 'worse' || (nextLower.endsWith('er') && nextLower.length > 4))) ||
      (lower === 'most' && (nextLower === 'best' || nextLower === 'worst' || (nextLower.endsWith('est') && nextLower.length > 5)))
    ) {
      out.push(`${core}[EW]${punct}`);
      addReason(`Extra modifier before "${nextToken}"`);
      i += 1;
      continue;
    }

    // 6. Indefinite article a/an agreement ("a elephant" -> "a[EW:an] elephant")
    if (lower === 'a' && nextLower && needsAn(nextLower)) {
      const target = matchCase(core, 'an');
      out.push(`${core}[EW:${target}]${punct}`);
      addReason(`Article agreement: "${core} ${nextToken}" → "${target} ${nextToken}"`);
      i += 1;
      continue;
    }
    if (lower === 'an' && nextLower && /^[a-z]/.test(nextLower) && !needsAn(nextLower)) {
      const target = matchCase(core, 'a');
      out.push(`${core}[EW:${target}]${punct}`);
      addReason(`Article agreement: "${core} ${nextToken}" → "${target} ${nextToken}"`);
      i += 1;
      continue;
    }

    // 7. Subject-verb agreement after singular 3rd-person pronoun or singular noun phrase
    const isSingular3PSubject =
      SINGULAR_3P_PRONOUNS.has(prevLower) ||
      (['the', 'a', 'an', 'this', 'that', 'my', 'his', 'her'].includes(prevPrevLower) &&
        COMMON_COUNT_NOUNS.has(prevLower) &&
        !prevLower.endsWith('s'));

    if (isSingular3PSubject) {
      if (lower === 'are') {
        out.push(`${core}[EW:is]${punct}`);
        addReason('Subject-verb agreement: "are" → "is"');
        i += 1;
        continue;
      }
      if (lower === 'were') {
        out.push(`${core}[EW:was]${punct}`);
        addReason('Subject-verb agreement: "were" → "was"');
        i += 1;
        continue;
      }
      if (lower === 'have') {
        out.push(`${core}[EW:has]${punct}`);
        addReason('Subject-verb agreement: "have" → "has"');
        i += 1;
        continue;
      }
      if (lower === "don't") {
        out.push(`${core}[EW:doesn't]${punct}`);
        addReason('Subject-verb agreement: "don\'t" → "doesn\'t"');
        i += 1;
        continue;
      }
      // Omitted auxiliary "is" before progressive "-ing" (e.g., "He running fast." -> "He is* running fast.")
      if (
        SINGULAR_3P_PRONOUNS.has(prevLower) &&
        lower.endsWith('ing') &&
        lower.length > 4 &&
        !NON_PARTICIPLE_ING_WORDS.has(lower)
      ) {
        out.push('is*');
        out.push(raw);
        addReason(`Omitted auxiliary "is*" before "${core}"`);
        i += 1;
        continue;
      }
      // Omitted 3rd-person singular "-s" (e.g., "He walk to school." -> "He walk/*3s to school.")
      if (
        COMMON_VERBS.has(lower) &&
        !IRREGULAR_PAST_VERBS.has(lower) &&
        !['is', 'was', 'has', 'does', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'did', 'had', 'got', 'went', 'said', 'put', 'cut', 'hit', 'let', 'set', 'hurt', 'read', 'shut', 'cost', 'quit'].includes(
          lower
        ) &&
        !lower.endsWith('s') &&
        !lower.endsWith('ed') &&
        !lower.endsWith('ing')
      ) {
        out.push(`${core}/*3s${punct}`);
        addReason(`Omitted 3rd-person singular -s: "${core}/*3s"`);
        i += 1;
        continue;
      }
    }

    // 8. Subject-verb agreement after plural pronouns (we, they, you) or "I"
    if (PLURAL_SUBJECT_PRONOUNS.has(prevLower)) {
      if (lower === 'is') {
        out.push(`${core}[EW:are]${punct}`);
        addReason('Subject-verb agreement: "is" → "are"');
        i += 1;
        continue;
      }
      if (lower === 'was') {
        out.push(`${core}[EW:were]${punct}`);
        addReason('Subject-verb agreement: "was" → "were"');
        i += 1;
        continue;
      }
      if (lower === 'has') {
        out.push(`${core}[EW:have]${punct}`);
        addReason('Subject-verb agreement: "has" → "have"');
        i += 1;
        continue;
      }
      if (lower.endsWith('ing') && lower.length > 4 && !NON_PARTICIPLE_ING_WORDS.has(lower)) {
        out.push('are*');
        out.push(raw);
        addReason(`Omitted auxiliary "are*" before "${core}"`);
        i += 1;
        continue;
      }
    }

    if (prevLower === 'i') {
      if (lower === 'is' || lower === 'are') {
        out.push(`${core}[EW:am]${punct}`);
        addReason(`Subject-verb agreement: "${core}" → "am"`);
        i += 1;
        continue;
      }
      if (lower === 'has') {
        out.push(`${core}[EW:have]${punct}`);
        addReason('Subject-verb agreement: "has" → "have"');
        i += 1;
        continue;
      }
      if (lower.endsWith('ing') && lower.length > 4 && !NON_PARTICIPLE_ING_WORDS.has(lower)) {
        out.push('am*');
        out.push(raw);
        addReason(`Omitted auxiliary "am*" before "${core}"`);
        i += 1;
        continue;
      }
    }

    // 9. Omitted plural "-s" after plural quantifier (e.g., "two dog" -> "two dog[EW:dogs]")
    if (
      PLURAL_QUANTIFIERS.has(prevLower) &&
      COMMON_COUNT_NOUNS.has(lower) &&
      !lower.endsWith('s') &&
      !['sheep', 'fish', 'deer', 'moose'].includes(lower) &&
      (!nextLower || !COMMON_COUNT_NOUNS.has(nextLower)) // Avoid compound noun modifier like "two cookie boxes"
    ) {
      const target = matchCase(core, pluralizeRegular(core));
      out.push(`${core}[EW:${target}]${punct}`);
      addReason(`Missing plural after "${prevToken}": "${core}" → "${target}"`);
      i += 1;
      continue;
    }

    out.push(raw);
    i += 1;
  }

  const coded = `${prefix}${out.join(' ')}`.trim();
  return {
    original: trimmed,
    coded,
    changed: coded !== trimmed,
    reasons,
  };
}

/**
 * Port of upstream `addConventions.py: correctSentence`.
 */
export function correctSentence(sentence: string, speakerAliases: string[] = ['C', 'E']): string {
  return analyzeSentence(sentence, speakerAliases).coded;
}

export interface GrammarStepResult {
  passedThrough: string;
  nextSuggestion: string | null;
  nextOriginal: string | null;
  reasons: string[];
  progress: number;
  done: boolean;
}

/**
 * Step-by-step interactive SALT grammar checker matching upstream `grammar.py: GrammarChecker`.
 */
export class GrammarChecker {
  private queue: string[] = [];
  private totalSentences = 0;
  private checkAllSentences = false;
  private speakerAliases: string[] = ['C', 'E'];

  public start(
    transcriptionText: string,
    checkAllSentences = false,
    speakerAliases: string[] = ['C', 'E']
  ): void {
    this.checkAllSentences = checkAllSentences;
    this.speakerAliases = speakerAliases;
    this.queue = splitSentences(transcriptionText);
    this.totalSentences = this.queue.length;
  }

  public getProgress(): number {
    if (this.totalSentences === 0) return 1;
    return Math.min(1, (this.totalSentences - this.queue.length) / this.totalSentences);
  }

  public getRemainingCount(): number {
    return this.queue.length;
  }

  public getTotalCount(): number {
    return this.totalSentences;
  }

  public getNextCorrection(): GrammarStepResult {
    const passedLines: string[] = [];

    while (this.queue.length > 0) {
      const current = this.queue.shift()!;
      const analysis = analyzeSentence(current, this.speakerAliases);

      if (analysis.changed || this.checkAllSentences) {
        return {
          passedThrough: passedLines.length > 0 ? `${passedLines.join('\n')}\n` : '',
          nextSuggestion: analysis.coded,
          nextOriginal: analysis.original,
          reasons: analysis.reasons,
          progress: this.getProgress(),
          done: false,
        };
      }
      passedLines.push(current);
    }

    return {
      passedThrough: passedLines.length > 0 ? `${passedLines.join('\n')}\n` : '',
      nextSuggestion: null,
      nextOriginal: null,
      reasons: [],
      progress: 1,
      done: true,
    };
  }
}
