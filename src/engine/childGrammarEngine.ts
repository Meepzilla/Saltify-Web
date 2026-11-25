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

const SINGULAR_3RD_SUBJECTS = new Set(['he', 'she', 'it', 'that', 'this', 'everyone', 'somebody', 'nobody']);
const PLURAL_SUBJECTS = new Set(['they', 'we', 'you', 'these', 'those']);
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

    // Rule D: Subject-verb agreement with "to be" / "have" / "do"
    if (prev && !prev.punct) {
      // Singular 3rd-person subject: He/She/It
      if (SINGULAR_3RD_SUBJECTS.has(prev.lower)) {
        if (curr.lower === 'are') {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'is')}]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'were') {
          out[curr.outIndex] = `${curr.core}[EW:${matchCase(curr.core, 'was')}]${curr.punct}`;
          continue;
        }
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
        // Omitted auxiliary before progressive participle: "He running" -> "He *is running"
        if (
          curr.lower.endsWith('ing') &&
          curr.lower.length > 4 &&
          !['thing', 'something', 'nothing', 'everything', 'morning', 'evening', 'king', 'ring', 'wing', 'string', 'spring'].includes(curr.lower)
        ) {
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

      // First-person singular subject: I
      if (prev.lower === 'i') {
        if (curr.lower === 'is' || curr.lower === 'are') {
          out[curr.outIndex] = `${curr.core}[EW:am]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'were') {
          out[curr.outIndex] = `${curr.core}[EW:was]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'has') {
          out[curr.outIndex] = `${curr.core}[EW:have]${curr.punct}`;
          continue;
        }
        if (
          curr.lower.endsWith('ing') &&
          curr.lower.length > 4 &&
          !['thing', 'something', 'nothing', 'everything', 'morning', 'evening'].includes(curr.lower)
        ) {
          insertionsBefore.set(curr.outIndex, '*am');
          continue;
        }
      }

      // Plural subjects: They/We/You
      if (PLURAL_SUBJECTS.has(prev.lower)) {
        if (curr.lower === 'is') {
          out[curr.outIndex] = `${curr.core}[EW:are]${curr.punct}`;
          continue;
        }
        if (curr.lower === 'was') {
          out[curr.outIndex] = `${curr.core}[EW:were]${curr.punct}`;
          continue;
        }
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
        if (
          curr.lower.endsWith('ing') &&
          curr.lower.length > 4 &&
          !['thing', 'something', 'nothing', 'everything', 'morning', 'evening'].includes(curr.lower)
        ) {
          insertionsBefore.set(curr.outIndex, '*are');
          continue;
        }
      }

      // Singular noun subject + base verb: "The dog walk fast." -> "The dog walk/*3s fast."
      if (
        prev2 &&
        ['the', 'a', 'an', 'my', 'his', 'her', 'this', 'that'].includes(prev2.lower) &&
        !prev.lower.endsWith('s') &&
        COMMON_BASE_VERBS.has(curr.lower) &&
        !MODAL_OR_AUX.has(curr.lower) &&
        posByLower.get(prev.lower) === 'NN'
      ) {
        out[curr.outIndex] = `${curr.core}/*3s${curr.punct}`;
        continue;
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
