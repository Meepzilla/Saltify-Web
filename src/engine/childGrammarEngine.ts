import posTagger from 'wink-pos-tagger';
import type { GrammarCheckOptions } from '../types/saltify';
import { stripPosCodes } from './posCodes';
import { extractLinePrefix } from './saltConventions';

const tagger = posTagger();

/**
 * Common child language irregular past-tense overregularizations (e.g., "telled" -> "told").
 * Maps the overregularized form to the target adult form.
 */
const OVERREGULARIZED_PAST_VERBS: Record<string, string> = {
  telled: 'told',
  goed: 'went',
  runned: 'ran',
  eated: 'ate',
  falled: 'fell',
  comed: 'came',
  maked: 'made',
  taked: 'took',
  seed: 'saw',
  sawed: 'saw',
  bringed: 'brought',
  buyed: 'bought',
  catched: 'caught',
  drawed: 'drew',
  drived: 'drove',
  drinked: 'drank',
  flyed: 'flew',
  flied: 'flew',
  gived: 'gave',
  growed: 'grew',
  holded: 'held',
  keeped: 'kept',
  knowed: 'knew',
  leaved: 'left',
  putted: 'put',
  rided: 'rode',
  sayed: 'said',
  sended: 'sent',
  singed: 'sang',
  sitted: 'sat',
  sleeped: 'slept',
  speaked: 'spoke',
  standed: 'stood',
  swimmed: 'swam',
  teached: 'taught',
  thinked: 'thought',
  throwed: 'threw',
  waked: 'woke',
  weared: 'wore',
  winned: 'won',
  writed: 'wrote',
  breaked: 'broke',
  bited: 'bit',
  blowed: 'blew',
  builded: 'built',
  choosed: 'chose',
  cutted: 'cut',
  digged: 'dug',
  doed: 'did',
  feeled: 'felt',
  fighted: 'fought',
  finded: 'found',
  forgetted: 'forgot',
  freezed: 'froze',
  getted: 'got',
  haved: 'had',
  heared: 'heard',
  hided: 'hid',
  hitted: 'hit',
  hurted: 'hurt',
  letted: 'let',
  losed: 'lost',
  meeted: 'met',
  payed: 'paid',
  readed: 'read',
  ringed: 'rang',
  selled: 'sold',
  shaked: 'shook',
  shooted: 'shot',
  shutted: 'shut',
  slided: 'slid',
  spended: 'spent',
  stealed: 'stole',
  sticked: 'stuck',
  swunged: 'swung',
  teared: 'tore',
  woked: 'woke',
  wented: 'went',
  camed: 'came',
  ated: 'ate',
  felled: 'fell',
  gotted: 'got',
  broked: 'broke',
  tookd: 'took',
  tooked: 'took',
  raned: 'ran',
};

/**
 * Common child language irregular plural overregularizations (e.g., "foots" -> "feet").
 */
const OVERREGULARIZED_PLURALS: Record<string, string> = {
  foots: 'feet',
  feets: 'feet',
  tooths: 'teeth',
  teeths: 'teeth',
  mouses: 'mice',
  mices: 'mice',
  childs: 'children',
  childrens: 'children',
  mans: 'men',
  mens: 'men',
  womans: 'women',
  womens: 'women',
  peoples: 'people',
  gooses: 'geese',
  sheeps: 'sheep',
  deers: 'deer',
  fishes: 'fish',
  knifes: 'knives',
  leafs: 'leaves',
  wolfs: 'wolves',
  oxes: 'oxen',
  persones: 'people',
};

const FILLER_WORDS = new Set(['um', 'uh', 'er', 'erm', 'hm', 'hmm']);

/** Forms of BE, by tense. Used for subject–verb agreement checks. */
const BE_PRESENT = new Set(['am', 'is', 'are']);
const BE_PAST = new Set(['was', 'were']);

const WH_WORDS = new Set(['what', 'where', 'who', 'why', 'how', 'when', 'which', 'whose']);
const CLAUSE_LINKERS = new Set([
  'and', 'but', 'so', 'then', 'because', 'cuz', 'when', 'if', 'or', 'until', 'while', 'after', 'before',
]);
const RELATIVE_PRONOUNS = new Set(['that', 'who', 'which']);

/** Plural-only nouns ("My pants is wet" -> are) and irregular plurals the tagger may miss. */
const ALWAYS_PLURAL_NOUNS = new Set([
  'pants', 'jeans', 'shorts', 'scissors', 'glasses', 'clothes', 'pajamas', 'pyjamas', 'tights',
  'people', 'children', 'kids', 'men', 'women', 'feet', 'teeth', 'mice', 'geese', 'police',
]);
/** Nouns that end in -s but take singular verbs ("The news is on"). */
const SINGULAR_S_NOUNS = new Set(['news', 'bus', 'glass', 'class', 'dress', 'grass', 'boss', 'gas', 'math', 'physics', 'mess', 'kiss', 'princess', 'octopus', 'hippopotamus', 'walrus', 'cactus', 'circus']);

const NUMBER_WORDS_PLURAL = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'many', 'lots', 'several', 'both', 'few',
]);

type SubjectPerson = '1sg' | '2' | '3sg' | 'pl';

/** Expected BE form for a subject: present am/is/are, past was/were. */
function expectedBe(person: SubjectPerson, past: boolean): string {
  if (past) return person === '1sg' || person === '3sg' ? 'was' : 'were';
  if (person === '1sg') return 'am';
  if (person === '3sg') return 'is';
  return 'are';
}

const MODAL_OR_AUX = new Set([
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'did', 'does', 'do', 'was', 'were', 'is', 'are', 'am', 'has', 'have', 'had',
  "can't", "couldn't", "won't", "wouldn't", "shouldn't", "didn't", "doesn't", "don't",
  "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't",
]);

/** Common verbs that children frequently drop -s on in 3rd-person singular ("He walk to school.") */
const COMMON_BASE_VERBS = new Set([
  'walk', 'run', 'go', 'come', 'want', 'like', 'love', 'need', 'play', 'eat',
  'drink', 'sleep', 'jump', 'look', 'see', 'hear', 'feel', 'make', 'take', 'give',
  'get', 'put', 'sit', 'stand', 'live', 'work', 'help', 'talk', 'say', 'tell',
  'ask', 'know', 'think', 'try', 'cry', 'fly', 'swim', 'climb', 'ride', 'drive',
  'fall', 'break', 'open', 'close', 'push', 'pull', 'throw', 'catch', 'kick',
  'hit', 'bite', 'hold', 'carry', 'drop', 'pick', 'wash', 'brush', 'cook', 'bake',
  'draw', 'paint', 'read', 'write', 'sing', 'dance', 'laugh', 'smile', 'cry',
  'hide', 'find', 'lose', 'keep', 'bring', 'buy', 'sell', 'wear', 'grow', 'move',
  'stop', 'start', 'wait', 'stay', 'leave', 'watch', 'listen', 'build', 'fix',
  'clean', 'share', 'hurt', 'fit', 'bark', 'meow', 'bite', 'hop', 'skip', 'crawl',
  'roll', 'spin', 'slide', 'swing', 'float', 'sink', 'splash', 'pour', 'dump',
]);

const IRREGULAR_PAST_AFTER_DID = new Map<string, string>([
  ['went', 'go'],
  ['saw', 'see'],
  ['ate', 'eat'],
  ['came', 'come'],
  ['took', 'take'],
  ['made', 'make'],
  ['gave', 'give'],
  ['ran', 'run'],
  ['told', 'tell'],
  ['said', 'say'],
  ['fell', 'fall'],
  ['got', 'get'],
  ['broke', 'break'],
  ['bought', 'buy'],
  ['caught', 'catch'],
  ['found', 'find'],
  ['had', 'have'],
  ['did', 'do'],
  ['knew', 'know'],
  ['left', 'leave'],
  ['sat', 'sit'],
  ['slept', 'sleep'],
  ['spoke', 'speak'],
  ['stood', 'stand'],
  ['swam', 'swim'],
  ['threw', 'throw'],
  ['wrote', 'write'],
]);

function splitTrailingPunct(token: string): { core: string; punct: string } {
  const match = token.match(/^(.+?)([.,!?;:]*)$/);
  if (!match) return { core: token, punct: '' };
  return { core: match[1], punct: match[2] };
}

function matchCase(source: string, replacement: string): string {
  if (!source || !replacement) return replacement;
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function isVowelSound(word: string): boolean {
  const lower = word.toLowerCase();
  if (/^(?:uni|use|user|useful|usual|europe|one|once)/.test(lower)) return false;
  if (/^(?:hour|honest|honor|heir)/.test(lower)) return true;
  return /^[aeiou]/.test(lower);
}

/**
 * Step 1: Detects consecutive word and 2-word phrase repetitions (mazes)
 * and optional filler mazes (um, uh).
 * Example: "I I I telled a lie." -> "(I I) I telled a lie."
 * Example: "and a and a dog" -> "(and a) and a dog"
 */
function codeRepetitionsAndMazes(words: string[], codeFillers: boolean): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < words.length) {
    const token = words[i];
    // Skip tokens that are already inside SALT codes or mazes
    if (token.includes('(') || token.includes(')') || token.includes('[')) {
      result.push(token);
      i += 1;
      continue;
    }

    const { core, punct } = splitTrailingPunct(token);
    const lowerCore = core.toLowerCase();

    // Optional filler words -> "(um)" / "(uh)"
    if (codeFillers && FILLER_WORDS.has(lowerCore) && !punct.match(/[.!?]/)) {
      result.push(`(${core})`);
      i += 1;
      continue;
    }

    // Check single-word consecutive repetition: e.g. "I I I" -> "(I I) I"
    let repeatCount = 0;
    let trailingPunct = '';
    while (i + repeatCount + 1 < words.length) {
      const next = splitTrailingPunct(words[i + repeatCount + 1]);
      if (
        !words[i + repeatCount + 1].includes('(') &&
        !words[i + repeatCount + 1].includes('[') &&
        next.core.toLowerCase() === lowerCore
      ) {
        if (next.punct) trailingPunct = next.punct;
        repeatCount += 1;
      } else {
        break;
      }
    }

    if (repeatCount > 0) {
      const mazeWords: string[] = [];
      for (let r = 0; r < repeatCount; r++) {
        mazeWords.push(splitTrailingPunct(words[i + r]).core);
      }
      const finalWord = splitTrailingPunct(words[i + repeatCount]).core;
      result.push(`(${mazeWords.join(' ')})`);
      result.push(finalWord + trailingPunct);
      i += repeatCount + 1;
      continue;
    }

    // Check 2-word phrase repetition: e.g. "and a and a dog" -> "(and a) and a dog"
    if (i + 3 < words.length) {
      const w0 = splitTrailingPunct(words[i]);
      const w1 = splitTrailingPunct(words[i + 1]);
      const w2 = splitTrailingPunct(words[i + 2]);
      const w3 = splitTrailingPunct(words[i + 3]);
      if (
        !w0.punct &&
        !w1.punct &&
        w0.core.toLowerCase() === w2.core.toLowerCase() &&
        w1.core.toLowerCase() === w3.core.toLowerCase()
      ) {
        result.push(`(${w0.core} ${w1.core})`);
        result.push(words[i + 2]);
        result.push(words[i + 3]);
        i += 4;
        continue;
      }
    }

    result.push(token);
    i += 1;
  }

  return result;
}

/**
 * 100% on-device child-language grammar & SALT convention checker.
 * Replaces desktop Saltify's Java/LanguageTool dependency with deterministic,
 * pediatric-SLP-tuned rules producing SALT codes (`/*3s`, `[EW:...]`, `[EO:...]`,
 * `[EW]`, `*word`, `(maze)`).
 */
export function correctSentence(
  input: string,
  options: Partial<GrammarCheckOptions> = {},
  speakerAliases: readonly string[] = ['C', 'E']
): string {
  const { prefix, body: codedBody } = extractLinePrefix(input, speakerAliases);
  // Ignore inserted part-of-speech codes (dog[N]) so they aren't read as SALT error codes
  const body = stripPosCodes(codedBody).replace(/\s{2,}/g, ' ').trim();
  if (!body) return input.trim();

  const codeFillers = options.codeFillerMazes ?? false;
  const overregTag = options.useOverregularizationTag ? 'EO' : 'EW';

  // Step 1: Maze / repetition coding
  const rawWords = body.split(/\s+/).filter(Boolean);
  const afterMazes = codeRepetitionsAndMazes(rawWords, codeFillers);

  // Build clean array of non-maze indices for grammatical inspection
  const nonMazeTokens: Array<{ outIndex: number; raw: string; core: string; lower: string; punct: string }> = [];
  const out = [...afterMazes];

  let insideMaze = false;
  for (let idx = 0; idx < out.length; idx++) {
    const tok = out[idx];
    if (tok.startsWith('(') && tok.endsWith(')')) continue;
    if (tok.startsWith('(')) {
      insideMaze = true;
      continue;
    }
    if (insideMaze) {
      if (tok.endsWith(')')) insideMaze = false;
      continue;
    }
    const { core, punct } = splitTrailingPunct(tok);
    nonMazeTokens.push({ outIndex: idx, raw: tok, core, lower: core.toLowerCase(), punct });
  }

  // POS tag the clean (non-maze) sentence to help disambiguate nouns vs verbs
  const cleanText = nonMazeTokens.map((t) => t.core).join(' ');
  const tagged = cleanText ? tagger.tagSentence(cleanText) : [];
  const posByLower = new Map<string, string>();
  for (const t of tagged) {
    if (!posByLower.has(t.value.toLowerCase())) {
      posByLower.set(t.value.toLowerCase(), t.pos);
    }
  }

  // Per-token POS (one tag per non-maze token, aligned by index) for subject analysis
  const posAt: string[] = nonMazeTokens.length
    ? (tagger.tagRawTokens(nonMazeTokens.map((t) => t.core)) as Array<{ pos: string }>).map(
        (t) => t.pos
      )
    : [];

  const isNounPos = (pos: string) => pos.startsWith('NN');
  const npModifier = (i: number) => {
    const t = nonMazeTokens[i];
    const pos = posAt[i] ?? '';
    return (
      pos === 'DT' || pos === 'PDT' || pos === 'PRP$' || pos.startsWith('JJ') || pos === 'CD' ||
      pos === 'POS' || ['my', 'your', 'his', 'her', 'our', 'their', 'its', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'all'].includes(t.lower)
    );
  };

  /** Grammatical number of a noun token, or null if it is not a noun. */
  const nounNumber = (i: number): 'sg' | 'pl' | null => {
    const t = nonMazeTokens[i];
    if (!t) return null;
    if (ALWAYS_PLURAL_NOUNS.has(t.lower) || OVERREGULARIZED_PLURALS[t.lower]) return 'pl';
    const pos = posAt[i] ?? '';
    if (!isNounPos(pos)) return null;
    if (SINGULAR_S_NOUNS.has(t.lower)) return 'sg';
    return pos === 'NNS' || pos === 'NNPS' ? 'pl' : 'sg';
  };

  /** True when token i starts a clause: sentence start, after a linker, or after clause punctuation. */
  const isClauseStart = (i: number) => {
    if (i <= 0) return true;
    const before = nonMazeTokens[i - 1];
    return Boolean(before.punct) || CLAUSE_LINKERS.has(before.lower) || WH_WORDS.has(before.lower);
  };

  /**
   * True when token k begins a question or clause in inverted order ("Are he…", "Where is they?").
   * A wh-word only counts when it starts its own clause, so relative "the man who are" is not a question.
   */
  const startsInvertedClause = (k: number) => {
    if (k <= 0) return true;
    const before = nonMazeTokens[k - 1];
    if (before.punct || CLAUSE_LINKERS.has(before.lower)) return true;
    return WH_WORDS.has(before.lower) && isClauseStart(k - 1);
  };

  const pronounPerson = (lower: string): SubjectPerson | null => {
    if (lower === 'i') return '1sg';
    if (lower === 'you') return '2';
    if (['he', 'she', 'it', 'everyone', 'everybody', 'somebody', 'someone', 'nobody', 'anybody', 'anyone', 'something', 'nothing', 'everything'].includes(lower)) return '3sg';
    if (['they', 'we', 'these', 'those'].includes(lower)) return 'pl';
    return null;
  };

  /**
   * Finds the start index of the noun phrase ending at `end` (walking back over determiners,
   * possessives and adjectives). Returns -1 if the phrase is the object of a preposition
   * ("the boy with the dogs"), since that noun is not the subject.
   */
  const nounPhraseStart = (end: number): number => {
    let i = end;
    while (i - 1 >= 0 && !nonMazeTokens[i - 1].punct && npModifier(i - 1) && end - (i - 1) <= 4) i -= 1;
    const before = i > 0 ? posAt[i - 1] ?? '' : '';
    if (i > 0 && (before === 'IN' || before === 'TO') && !CLAUSE_LINKERS.has(nonMazeTokens[i - 1].lower)) return -1;
    return i;
  };

  /**
   * Person/number of the subject that ends right before token k (declarative order).
   * Handles pronouns, noun phrases, compound subjects ("Mom and he"), and relative
   * clauses ("the toys that are"). Returns null when the subject can't be identified.
   */
  const subjectBefore = (k: number): SubjectPerson | null => {
    const p = k - 1;
    if (p < 0 || nonMazeTokens[p].punct) return null;
    const prevTok = nonMazeTokens[p];

    // Relative clause: agreement follows the antecedent ("the toys that are", "the dog that barks")
    if (RELATIVE_PRONOUNS.has(prevTok.lower) && p >= 1 && !nonMazeTokens[p - 1].punct) {
      const ante = nounNumber(p - 1);
      if (ante) return ante === 'pl' ? 'pl' : '3sg';
      const antePronoun = pronounPerson(nonMazeTokens[p - 1].lower);
      if (antePronoun && prevTok.lower !== 'that') return antePronoun;
      if (prevTok.lower !== 'that') return null;
    }

    // Head of the subject: pronoun or noun phrase
    let head: SubjectPerson | null = null;
    let start = p;
    const pron = pronounPerson(prevTok.lower);
    if (pron) {
      head = pron;
    } else if (['this', 'that'].includes(prevTok.lower) && isClauseStart(p)) {
      head = '3sg'; // demonstrative subject: "That are mine"
    } else {
      const num = nounNumber(p);
      if (!num) return null;
      start = nounPhraseStart(p);
      if (start < 0) return null;
      head = num === 'pl' ? 'pl' : '3sg';
    }

    // Compound subject: "Mom and he are", "The boy and the girl is" -> plural
    const andIdx = start - 1;
    if (andIdx >= 1 && nonMazeTokens[andIdx].lower === 'and' && !nonMazeTokens[andIdx - 1].punct) {
      const leftEnd = andIdx - 1;
      const leftIsNominal =
        pronounPerson(nonMazeTokens[leftEnd].lower) !== null ||
        ['me', 'him', 'her', 'them', 'us'].includes(nonMazeTokens[leftEnd].lower) ||
        nounNumber(leftEnd) !== null;
      if (leftIsNominal) {
        const leftStart = pronounPerson(nonMazeTokens[leftEnd].lower) ? leftEnd : nounPhraseStart(leftEnd);
        if (leftStart >= 0 && isClauseStart(leftStart)) return 'pl';
      }
      // "I went home and he are sad": 'and' joins clauses, keep the head's own number
    }

    // Noun subjects must start a clause (avoids objects like "I like dogs is…")
    if (!pron && !isClauseStart(start) && !RELATIVE_PRONOUNS.has(nonMazeTokens[start - 1]?.lower ?? '')) {
      const beforePos = posAt[start - 1] ?? '';
      if (!beforePos.startsWith('VB')) return null;
    }
    return head;
  };

  /** Person/number of a subject that follows token k (questions: "Are he…", "Where is they"). */
  const subjectAfter = (k: number): SubjectPerson | null => {
    let i = k + 1;
    const t = nonMazeTokens[i];
    if (!t) return null;
    const pron = pronounPerson(t.lower);
    if (pron) return pron;
    // Walk over determiners/adjectives to the head noun
    while (i < nonMazeTokens.length && npModifier(i) && !nonMazeTokens[i].punct && i - k <= 4) i += 1;
    const num = nounNumber(i);
    return num ? (num === 'pl' ? 'pl' : '3sg') : null;
  };

  /** Number of the noun phrase after existential "there is/are" ("There is two dogs"). */
  const existentialNumber = (k: number): SubjectPerson | null => {
    const first = nonMazeTokens[k + 1];
    if (!first) return null;
    if (['a', 'an', 'one', 'another', 'this', 'that'].includes(first.lower)) return '3sg';
    if (NUMBER_WORDS_PLURAL.has(first.lower) || ['these', 'those'].includes(first.lower)) return 'pl';
    if (/^\d+$/.test(first.core)) return first.core === '1' ? '3sg' : 'pl';
    for (let i = k + 1; i < Math.min(nonMazeTokens.length, k + 5); i++) {
      const num = nounNumber(i);
      if (num) return num === 'pl' ? 'pl' : '3sg';
      if (!npModifier(i)) break;
    }
    return null;
  };

  // Track inserted omitted words as prefix strings on out[outIndex]
  const insertionsBefore = new Map<number, string>();

  for (let k = 0; k < nonMazeTokens.length; k++) {
    const curr = nonMazeTokens[k];
    const prev = k > 0 ? nonMazeTokens[k - 1] : null;
    const prev2 = k > 1 ? nonMazeTokens[k - 2] : null;
    const next = k + 1 < nonMazeTokens.length ? nonMazeTokens[k + 1] : null;

    // Skip already SALT-coded tokens
    if (curr.core.includes('[') || curr.core.includes('*') || curr.core.includes('/')) {
      continue;
    }

    // Rule A: Irregular past tense overregularization ("telled" -> "telled[EW:told]" or [EO:told])
    if (OVERREGULARIZED_PAST_VERBS[curr.lower]) {
      const target = matchCase(curr.core, OVERREGULARIZED_PAST_VERBS[curr.lower]);
      out[curr.outIndex] = `${curr.core}[${overregTag}:${target}]${curr.punct}`;
      continue;
    }

    // Rule B: Irregular plural overregularization ("foots" -> "foots[EW:feet]")
    if (OVERREGULARIZED_PLURALS[curr.lower]) {
      const target = matchCase(curr.core, OVERREGULARIZED_PLURALS[curr.lower]);
      out[curr.outIndex] = `${curr.core}[${overregTag}:${target}]${curr.punct}`;
      continue;
    }

    // Rule C: Pronoun case errors at clause start ("Me want cookie" -> "Me[EW:I] want cookie")
    if (
      (k === 0 || (prev && ['and', 'but', 'so', 'then', 'because'].includes(prev.lower))) &&
      next &&
      ['me', 'him', 'her', 'them'].includes(curr.lower)
    ) {
      const nextPos = posByLower.get(next.lower) ?? '';
      const nextLooksLikeVerb =
        COMMON_BASE_VERBS.has(next.lower) ||
        MODAL_OR_AUX.has(next.lower) ||
        next.lower.endsWith('ed') ||
        next.lower.endsWith('ing') ||
        nextPos.startsWith('VB') ||
        OVERREGULARIZED_PAST_VERBS[next.lower] !== undefined;

      // Avoid rewriting possessive "Her dog barked" — only rewrite "Her went / Her is / Her want"
      const isHerBeforeNoun = curr.lower === 'her' && !nextLooksLikeVerb;
      if (nextLooksLikeVerb && !isHerBeforeNoun) {
        const subjectMap: Record<string, string> = {
          me: 'I',
          him: 'he',
          her: 'she',
          them: 'they',
        };
        const target = matchCase(curr.core, subjectMap[curr.lower]);
        out[curr.outIndex] = `${curr.core}[EW:${target}]${curr.punct}`;
        continue;
      }
    }

    // Rule D: Subject–verb agreement with BE (am/is/are/was/were), using the real subject:
    // pronouns, noun phrases, compounds ("Mom and he are"), relative clauses ("toys that are"),
    // questions ("Are he coming?" / "Where is they?") and existential "there is/are".
    if (BE_PRESENT.has(curr.lower) || BE_PAST.has(curr.lower)) {
      const past = BE_PAST.has(curr.lower);
      let person: SubjectPerson | null = null;
      if (prev && !prev.punct && prev.lower === 'there') {
        person = existentialNumber(k);
      } else if (startsInvertedClause(k)) {
        // Inverted order: "Are he coming?", "Where is they?", "Is there two dogs?"
        person = next?.lower === 'there' ? existentialNumber(k + 1) : subjectAfter(k);
      } else {
        person = subjectBefore(k);
      }
      // Subjunctive "if I were", "I wish he were" is correct
      const subjunctive =
        curr.lower === 'were' &&
        nonMazeTokens.slice(Math.max(0, k - 4), k).some((t) => t.lower === 'if' || t.lower === 'wish');
      if (person && !subjunctive) {
        const target = expectedBe(person, past);
        if (target !== curr.lower) {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, target)}]${curr.punct}`;
        }
      }
      continue;
    }

    // Rule D1: Inverted DO/HAVE questions ("Does they like it?" -> do, "Do he want it?" -> does)
    if (['do', 'does', 'have', 'has'].includes(curr.lower) && next && startsInvertedClause(k)) {
      // Only real questions: pronoun subject followed by a verb ("Does they like…", "Have he eaten…").
      // Imperatives like "Do it!" or "Have a cookie" are left alone.
      const afterSubject = nonMazeTokens[k + 2];
      const afterPos = posAt[k + 2] ?? '';
      const verbFollows =
        afterSubject !== undefined &&
        (afterPos.startsWith('VB') || COMMON_BASE_VERBS.has(afterSubject.lower));
      const person = pronounPerson(next.lower) && verbFollows ? subjectAfter(k) : null;
      if (person) {
        const isDo = curr.lower === 'do' || curr.lower === 'does';
        const target =
          person === '3sg' ? (isDo ? 'does' : 'has') : isDo ? 'do' : 'have';
        if (target !== curr.lower) {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, target)}]${curr.punct}`;
        }
        continue;
      }
    }

    // Rule D2: Agreement with HAVE / DO, omitted auxiliaries and omitted 3rd-person -s
    if (prev && !prev.punct) {
      const subject = subjectBefore(k);
      const prevIsSubjectPronoun = pronounPerson(prev.lower) !== null;
      // "He running" -> "He *is running" only for a pronoun that starts its clause and isn't
      // already preceded by an auxiliary ("What are you doing?" is fine)
      const canInsertAux =
        prevIsSubjectPronoun &&
        isClauseStart(k - 1) &&
        !(prev2 && MODAL_OR_AUX.has(prev2.lower)) &&
        curr.lower.endsWith('ing') &&
        curr.lower.length > 4 &&
        !['thing', 'something', 'nothing', 'everything', 'morning', 'evening', 'king', 'ring', 'wing', 'string', 'spring', 'during'].includes(curr.lower);

      if (subject === '3sg') {
        if (curr.lower === 'have') {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'has')}]${curr.punct}`;
          continue;
        }
        if (curr.lower === "don't") {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, "doesn't")}]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'do' && next && !['not'].includes(next.lower)) {
          // "He do it" -> "He do[EW:does] it"
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'does')}]${curr.punct}`;
          continue;
        }
        if (canInsertAux) {
          insertionsBefore.set(curr.outIndex, '*is');
          continue;
        }
        // Omitted 3rd-person singular bound morpheme: "He walk to school." -> "He walk/*3s to school."
        if (
          COMMON_BASE_VERBS.has(curr.lower) &&
          !MODAL_OR_AUX.has(curr.lower) &&
          (!prev2 || !MODAL_OR_AUX.has(prev2.lower))
        ) {
          out[curr.outIndex] = `${curr.core}/*3s${curr.punct}`;
          continue;
        }
      }

      if (subject === '1sg') {
        if (curr.lower === 'has') {
          out[curr.outIndex] = `${curr.core}[EW:have]${curr.punct}`;
          continue;
        }
        if (canInsertAux) {
          insertionsBefore.set(curr.outIndex, '*am');
          continue;
        }
      }

      if (subject === 'pl' || subject === '2') {
        if (curr.lower === 'has') {
          out[curr.outIndex] = `${curr.core}[EW:have]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'does') {
          out[curr.outIndex] = `${curr.core}[EW:do]${curr.punct}`;
          continue;
        }
        if (curr.lower === "doesn't") {
          out[curr.outIndex] = `${curr.core}[EW:don't]${curr.punct}`;
          continue;
        }
        if (canInsertAux) {
          insertionsBefore.set(curr.outIndex, '*are');
          continue;
        }
      }

      // Past tense after did/didn't ("He didn't went" -> "He didn't went[EW:go]")
      if ((prev.lower === 'did' || prev.lower === "didn't") && IRREGULAR_PAST_AFTER_DID.has(curr.lower)) {
        const base = IRREGULAR_PAST_AFTER_DID.get(curr.lower)!;
        out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, base)}]${curr.punct}`;
        continue;
      }

      // Double comparative ("more bigger" -> "more[EW] bigger")
      if (
        prev.lower === 'more' &&
        curr.lower.endsWith('er') &&
        curr.lower.length > 4 &&
        !['water', 'paper', 'butter', 'mother', 'father', 'sister', 'brother', 'teacher', 'hammer', 'ladder', 'dinner', 'summer', 'winter', 'river', 'flower', 'tiger', 'spider', 'monster'].includes(curr.lower) &&
        (posByLower.get(curr.lower) === 'JJR' || ['bigger', 'smaller', 'faster', 'slower', 'taller', 'shorter', 'louder', 'better', 'worse', 'nicer', 'older', 'younger', 'happier'].includes(curr.lower))
      ) {
        out[prev.outIndex] = `${prev.core}[EW]${prev.punct}`;
        continue;
      }
    }

    // Rule E: Indefinite article agreement ("a elephant" -> "a[EW:an] elephant", "an dog" -> "an[EW:a] dog")
    if ((curr.lower === 'a' || curr.lower === 'an') && next && !curr.punct && /^[a-zA-Z]/.test(next.core)) {
      const wantsAn = isVowelSound(next.core);
      if (curr.lower === 'a' && wantsAn) {
        out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'an')}]`;
        continue;
      }
      if (curr.lower === 'an' && !wantsAn) {
        out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'a')}]`;
        continue;
      }
    }
  }

  // Apply any inserted omitted words (e.g., *is, *are, *am)
  const assembled: string[] = [];
  for (let idx = 0; idx < out.length; idx++) {
    const ins = insertionsBefore.get(idx);
    if (ins) assembled.push(ins);
    assembled.push(out[idx]);
  }

  return `${prefix}${assembled.join(' ')}`.trim();
}
