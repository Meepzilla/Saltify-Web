import {
  ADVERBS,
  COMMON_COUNT_NOUNS,
  COMMON_VERBS,
  CONTRACTION_S_HOSTS,
  DETERMINERS,
  IRREGULAR_3S,
  IRREGULAR_PAST_VERBS,
  MODAL_AND_AUX_VERBS,
  NON_PARTICIPLE_ING_WORDS,
  NON_PAST_ED_WORDS,
  NON_PLURAL_S_WORDS,
  PREDICATE_ADJECTIVE_ED,
  PREPOSITIONS_AND_CONJUNCTIONS,
  SILENT_E_VERBS,
  TO_BE_VERBS,
} from './lexicon';

export type PosTag =
  | 'NN'
  | 'NNS'
  | 'NNP'
  | 'POS'
  | 'PRP'
  | 'VB'
  | 'VBD'
  | 'VBG'
  | 'VBP'
  | 'VBZ'
  | 'JJ'
  | 'RB'
  | 'DT'
  | 'IN'
  | 'MD'
  | 'PUNCT'
  | 'OTHER';

export interface TaggedToken {
  word: string;
  tag: PosTag;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const SINGULAR_SUBJECT_PRONOUNS = new Set(['he', 'she', 'it']);
const PLURAL_OR_NON3S_PRONOUNS = new Set(['i', 'you', 'we', 'they']);

export function isToBeVerb(verb: string): boolean {
  return TO_BE_VERBS.has(verb.toLowerCase());
}

/**
 * Conjugate a base English verb into 3rd-person singular present tense (e.g., go -> goes, try -> tries, walk -> walks).
 */
export function conjugateThirdPersonSingular(baseVerb: string): string {
  const lower = baseVerb.toLowerCase();
  if (!lower) return baseVerb;

  const isCapitalized = baseVerb[0] !== baseVerb[0].toLowerCase();
  const applyCase = (result: string) =>
    isCapitalized ? result[0].toUpperCase() + result.slice(1) : result;

  if (IRREGULAR_3S[lower]) {
    return applyCase(IRREGULAR_3S[lower]);
  }

  if (
    lower.endsWith('s') ||
    lower.endsWith('x') ||
    lower.endsWith('z') ||
    lower.endsWith('ch') ||
    lower.endsWith('sh') ||
    lower.endsWith('o')
  ) {
    return applyCase(`${lower}es`);
  }

  if (lower.endsWith('y') && lower.length > 1 && !VOWELS.has(lower[lower.length - 2])) {
    return applyCase(`${lower.slice(0, -1)}ies`);
  }

  return applyCase(`${lower}s`);
}

/**
 * Lemmatize an English plural noun to its singular base (matching NLTK WordNetLemmatizer('n') for SALT /s coding).
 */
export function lemmatizeNoun(word: string): string {
  const lower = word.toLowerCase();
  if (!lower.endsWith('s') || NON_PLURAL_S_WORDS.has(lower) || lower.length <= 2) {
    return word;
  }

  const preserveCase = (stem: string) =>
    word[0] !== word[0].toLowerCase() ? stem[0].toUpperCase() + stem.slice(1) : stem;

  // Special common plural forms ending in -ies (cookies -> cookie, babies -> baby, puppies -> puppy)
  if (lower.endsWith('ies') && lower.length > 4) {
    const ieCandidate = lower.slice(0, -1); // cookies -> cookie, movies -> movie
    if (COMMON_COUNT_NOUNS.has(ieCandidate) || ['cookie', 'movie', 'pie', 'tie', 'brownie', 'zombie', 'birdie'].includes(ieCandidate)) {
      return preserveCase(ieCandidate);
    }
    return preserveCase(`${lower.slice(0, -3)}y`);
  }

  // -ves (knives, leaves, wolves handled as irregular usually, fallback to -f/-fe)
  if (lower.endsWith('es') && lower.length > 3) {
    const withoutEs = lower.slice(0, -2);
    const withoutS = lower.slice(0, -1);
    if (
      withoutEs.endsWith('ch') ||
      withoutEs.endsWith('sh') ||
      withoutEs.endsWith('x') ||
      withoutEs.endsWith('z') ||
      withoutEs.endsWith('s') ||
      withoutEs.endsWith('o')
    ) {
      if (COMMON_COUNT_NOUNS.has(withoutS) && !COMMON_COUNT_NOUNS.has(withoutEs)) {
        return preserveCase(withoutS);
      }
      return preserveCase(withoutEs);
    }
    // e.g. shoes -> shoe, apples -> apple, castles -> castle
    return preserveCase(withoutS);
  }

  return preserveCase(lower.slice(0, -1));
}

/**
 * Lemmatize an English inflected verb (-ed, -ing, -s/-es) to its base form for SALT /ed, /ing, /3s coding.
 */
export function lemmatizeVerb(word: string): string {
  const lower = word.toLowerCase();
  const preserveCase = (stem: string) =>
    word[0] !== word[0].toLowerCase() ? stem[0].toUpperCase() + stem.slice(1) : stem;

  if (lower === 'does') return preserveCase('do');
  if (lower === 'goes') return preserveCase('go');
  if (lower === 'has') return preserveCase('have');
  if (lower === 'is' || lower === 'are' || lower === 'am' || lower === 'was' || lower === 'were') {
    return preserveCase('be');
  }

  // Regular -ed past tense
  if (lower.endsWith('ed') && lower.length > 3 && !NON_PAST_ED_WORDS.has(lower)) {
    if (lower.endsWith('ied') && lower.length > 4) {
      const ieBase = lower.slice(0, -1); // untied -> untie, tied -> tie, died -> die
      if (SILENT_E_VERBS.has(ieBase) || COMMON_VERBS.has(ieBase)) {
        return preserveCase(ieBase);
      }
      return preserveCase(`${lower.slice(0, -3)}y`); // tried -> try, cried -> cry
    }

    const stem = lower.slice(0, -2);
    const stemWithE = lower.slice(0, -1);

    // Explicit silent-e verb check first (liked -> like, baked -> bake, smiled -> smile)
    if (SILENT_E_VERBS.has(stemWithE)) {
      return preserveCase(stemWithE);
    }

    // Doubled final consonant (slipped -> slip, stopped -> stop, hugged -> hug, patted -> pat)
    if (
      stem.length >= 3 &&
      stem[stem.length - 1] === stem[stem.length - 2] &&
      !['l', 's', 'z', 'f'].includes(stem[stem.length - 1])
    ) {
      const undoubled = stem.slice(0, -1);
      if (COMMON_VERBS.has(undoubled) || !COMMON_VERBS.has(stem)) {
        return preserveCase(undoubled);
      }
    }

    if (COMMON_VERBS.has(stem)) {
      return preserveCase(stem);
    }
    if (COMMON_VERBS.has(stemWithE)) {
      return preserveCase(stemWithE);
    }

    // Heuristic silent-e restoration for CVC-like stems (e.g., taped -> tape, hoped -> hope)
    if (
      stem.length >= 3 &&
      !VOWELS.has(stem[stem.length - 1]) &&
      VOWELS.has(stem[stem.length - 2]) &&
      !VOWELS.has(stem[stem.length - 3]) &&
      !['w', 'x', 'y'].includes(stem[stem.length - 1]) &&
      !stem.endsWith('er') &&
      !stem.endsWith('en') &&
      !stem.endsWith('el') &&
      !stem.endsWith('or') &&
      !stem.endsWith('it')
    ) {
      return preserveCase(stemWithE);
    }

    return preserveCase(stem);
  }

  // Present participle -ing
  if (lower.endsWith('ing') && lower.length > 4 && !NON_PARTICIPLE_ING_WORDS.has(lower)) {
    const stem = lower.slice(0, -3);
    const stemWithE = `${stem}e`;

    // lying -> lie, dying -> die, tying -> tie
    if (stem.endsWith('y') && (stem === 'ly' || stem === 'dy' || stem === 'ty')) {
      return preserveCase(`${stem.slice(0, -1)}ie`);
    }

    // Check explicit silent-e verbs (having -> have, diving -> dive, making -> make)
    if (SILENT_E_VERBS.has(stemWithE)) {
      return preserveCase(stemWithE);
    }

    // Doubled consonant (running -> run, putting -> put, sitting -> sit, swimming -> swim)
    if (
      stem.length >= 3 &&
      stem[stem.length - 1] === stem[stem.length - 2] &&
      !['l', 's', 'z', 'f'].includes(stem[stem.length - 1])
    ) {
      const undoubled = stem.slice(0, -1);
      if (COMMON_VERBS.has(undoubled) || !COMMON_VERBS.has(stem)) {
        return preserveCase(undoubled);
      }
    }

    if (COMMON_VERBS.has(stem)) {
      return preserveCase(stem);
    }
    if (COMMON_VERBS.has(stemWithE)) {
      return preserveCase(stemWithE);
    }

    return preserveCase(stem);
  }

  // 3rd-person singular -s / -es
  if (lower.endsWith('s') && lower.length > 2) {
    if (lower.endsWith('ies') && lower.length > 4) {
      const ieBase = lower.slice(0, -1);
      if (SILENT_E_VERBS.has(ieBase) || COMMON_VERBS.has(ieBase)) {
        return preserveCase(ieBase);
      }
      return preserveCase(`${lower.slice(0, -3)}y`);
    }
    if (lower.endsWith('es') && lower.length > 3) {
      const withoutEs = lower.slice(0, -2);
      const withoutS = lower.slice(0, -1);
      if (
        withoutEs.endsWith('ch') ||
        withoutEs.endsWith('sh') ||
        withoutEs.endsWith('x') ||
        withoutEs.endsWith('z') ||
        withoutEs.endsWith('s') ||
        withoutEs.endsWith('o')
      ) {
        if (COMMON_VERBS.has(withoutEs) || !COMMON_VERBS.has(withoutS)) {
          return preserveCase(withoutEs);
        }
      }
      if (SILENT_E_VERBS.has(withoutS) || COMMON_VERBS.has(withoutS)) {
        return preserveCase(withoutS);
      }
      return preserveCase(withoutEs);
    }
    return preserveCase(lower.slice(0, -1));
  }

  return word;
}

/**
 * Split text into sentences while preserving SALT markers and punctuation.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const result: string[] = [];
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Split on sentence-ending punctuation followed by whitespace (not inside brackets)
    const parts = line.split(/(?<=[.!?])\s+(?![^[]*\])/);
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned) result.push(cleaned);
    }
  }
  return result;
}

/**
 * NLTK-compatible word tokenizer splitting contractions ('s, n't, 'll, 'm, 'd, 're, 've)
 * and punctuation into separate tokens so SALT morpheme rules match upstream SpeechTranscription.
 */
export function tokenizeForSalt(sentence: string): string[] {
  const rawTokens = sentence.trim().split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (const raw of rawTokens) {
    let token = raw;
    const trailingPunct: string[] = [];

    // Strip leading punctuation if any (excluding SALT parens/brackets handled upstream)
    while (token.length > 1 && /^["“‘]/.test(token)) {
      tokens.push(token[0]);
      token = token.slice(1);
    }

    // Strip trailing sentence punctuation
    while (token.length > 1 && /[.,?!;:"”’]$/.test(token)) {
      trailingPunct.unshift(token[token.length - 1]);
      token = token.slice(0, -1);
    }

    // Normalize curly apostrophes to straight apostrophe
    token = token.replace(/’/g, "'");

    // Split English contractions cleanly (matching NLTK word_tokenize)
    const lower = token.toLowerCase();
    if (lower === "can't") {
      tokens.push(token[0] === 'C' ? 'Ca' : 'ca', "n't");
    } else if (lower === "won't") {
      tokens.push(token[0] === 'W' ? 'Wo' : 'wo', "n't");
    } else if (lower.endsWith("n't") && token.length > 3) {
      tokens.push(token.slice(0, -3), "n't");
    } else if (/'(ll|re|ve)$/i.test(token) && token.length > 3) {
      tokens.push(token.slice(0, -3), token.slice(-3).toLowerCase());
    } else if (/'(s|m|d|t)$/i.test(token) && token.length > 2) {
      tokens.push(token.slice(0, -2), token.slice(-2).toLowerCase());
    } else if (token) {
      tokens.push(token);
    }

    for (const p of trailingPunct) {
      tokens.push(p);
    }
  }

  return tokens;
}

/**
 * Lightweight contextual English POS tagger tuned for child language transcripts
 * and SALT inflectional morpheme rules.
 */
export function posTagTokens(tokens: string[]): TaggedToken[] {
  const tagged: TaggedToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const lower = word.toLowerCase();
    const prev = i > 0 ? tagged[i - 1] : null;
    const prevWord = prev ? prev.word.toLowerCase() : '';
    const nextWord = i + 1 < tokens.length ? tokens[i + 1].toLowerCase() : '';

    // Punctuation
    if (/^[.,?!;:"“”‘’]+$/.test(word)) {
      tagged.push({ word, tag: 'PUNCT' });
      continue;
    }

    // Contraction suffixes
    if (lower === "'s") {
      // Distinguish possessive "'s" (POS) vs contraction "'s" (VBZ)
      const isContractionHost = CONTRACTION_S_HOSTS.has(prevWord);
      const nextIsVerbLike =
        nextWord.endsWith('ing') ||
        nextWord === 'not' ||
        nextWord === 'a' ||
        nextWord === 'an' ||
        nextWord === 'the' ||
        nextWord === 'all' ||
        nextWord === 'going' ||
        nextWord === 'very' ||
        nextWord === 'so' ||
        nextWord === 'famous' ||
        nextWord === 'good' ||
        nextWord === 'mad' ||
        nextWord === 'sad' ||
        nextWord === 'happy' ||
        nextWord === 'been' ||
        nextWord === 'got' ||
        ADVERBS.has(nextWord) ||
        PREPOSITIONS_AND_CONJUNCTIONS.has(nextWord);

      if (isContractionHost || nextIsVerbLike) {
        tagged.push({ word, tag: 'VBZ' });
      } else {
        tagged.push({ word, tag: 'POS' });
      }
      continue;
    }

    if (["n't", "'t", "'ll", "'m", "'d", "'re", "'ve"].includes(lower)) {
      const tag: PosTag = lower === "'m" || lower === "'re" ? 'VBP' : lower === "'ll" || lower === "'d" ? 'MD' : 'OTHER';
      tagged.push({ word, tag });
      continue;
    }

    // Pronouns
    if (SINGULAR_SUBJECT_PRONOUNS.has(lower) || PLURAL_OR_NON3S_PRONOUNS.has(lower) || ['me', 'him', 'her', 'us', 'them'].includes(lower)) {
      tagged.push({ word, tag: 'PRP' });
      continue;
    }

    // Determiners
    if (DETERMINERS.has(lower)) {
      tagged.push({ word, tag: 'DT' });
      continue;
    }

    // Modals & Auxiliaries
    if (MODAL_AND_AUX_VERBS.has(lower)) {
      if (lower === 'does' || lower === 'has') {
        tagged.push({ word, tag: 'VBZ' });
      } else if (lower === 'did' || lower === 'had') {
        tagged.push({ word, tag: 'VBD' });
      } else if (lower === 'do' || lower === 'have') {
        tagged.push({ word, tag: 'VBP' });
      } else {
        tagged.push({ word, tag: 'MD' });
      }
      continue;
    }

    // To-be verbs
    if (lower === 'is') {
      tagged.push({ word, tag: 'VBZ' });
      continue;
    }
    if (lower === 'am' || lower === 'are') {
      tagged.push({ word, tag: 'VBP' });
      continue;
    }
    if (lower === 'was' || lower === 'were') {
      tagged.push({ word, tag: 'VBD' });
      continue;
    }
    if (lower === 'be' || lower === 'been') {
      tagged.push({ word, tag: 'VB' });
      continue;
    }

    // Prepositions / Conjunctions
    if (PREPOSITIONS_AND_CONJUNCTIONS.has(lower)) {
      tagged.push({ word, tag: 'IN' });
      continue;
    }

    // Adverbs
    if (ADVERBS.has(lower)) {
      tagged.push({ word, tag: 'RB' });
      continue;
    }

    // Irregular past tense verbs
    if (IRREGULAR_PAST_VERBS.has(lower)) {
      tagged.push({ word, tag: 'VBD' });
      continue;
    }

    // -ing forms (present participle / gerund)
    if (lower.endsWith('ing') && lower.length > 4 && !NON_PARTICIPLE_ING_WORDS.has(lower)) {
      const stem = lemmatizeVerb(lower);
      if (stem !== lower) {
        tagged.push({ word, tag: 'VBG' });
        continue;
      }
    }

    // -ed forms (past tense VBD unless clearly an adjective modifying a noun or predicate adj after to-be)
    if (lower.endsWith('ed') && lower.length > 3 && !NON_PAST_ED_WORDS.has(lower)) {
      const afterDeterminer = prev?.tag === 'DT';
      const afterToBeOrLinking =
        prev !== null && (isToBeVerb(prevWord) || ['very', 'so', 'really', 'too', 'felt', 'feel', 'feels', 'got', 'get', 'was', 'were'].includes(prevWord));
      if (PREDICATE_ADJECTIVE_ED.has(lower) && (afterDeterminer || afterToBeOrLinking)) {
        tagged.push({ word, tag: 'JJ' });
        continue;
      }
      tagged.push({ word, tag: 'VBD' });
      continue;
    }

    // Words ending in -s: distinguish plural noun (NNS) vs 3rd-person singular verb (VBZ)
    if (lower.endsWith('s') && lower.length > 2 && !NON_PLURAL_S_WORDS.has(lower)) {
      const verbLemma = lemmatizeVerb(lower);
      const nounLemma = lemmatizeNoun(lower);
      const canBeVerb = COMMON_VERBS.has(verbLemma) || lower === 'goes' || lower === 'does';
      const canBeNoun = COMMON_COUNT_NOUNS.has(nounLemma);

      // Context strongly favoring plural noun (NNS):
      // after determiner, possessive ('s), adjective, preposition, or number
      const nounContext =
        prev !== null &&
        (prev.tag === 'DT' ||
          prev.tag === 'POS' ||
          prev.tag === 'JJ' ||
          prev.tag === 'IN' ||
          ['some', 'two', 'three', 'four', 'five', 'many', 'all', 'other', 'my', 'his', 'her', 'our', 'their', 'your'].includes(prevWord));

      // Context strongly favoring 3rd-person singular verb (VBZ):
      // after singular subject pronoun (he/she/it) or singular noun/proper noun
      const verbContext =
        prev !== null &&
        (SINGULAR_SUBJECT_PRONOUNS.has(prevWord) ||
          prev.tag === 'NN' ||
          prev.tag === 'NNP' ||
          prev.tag === 'RB');

      if (nounContext && !SINGULAR_SUBJECT_PRONOUNS.has(prevWord)) {
        tagged.push({ word, tag: 'NNS' });
        continue;
      }
      if (canBeVerb && verbContext && (!canBeNoun || SINGULAR_SUBJECT_PRONOUNS.has(prevWord))) {
        tagged.push({ word, tag: 'VBZ' });
        continue;
      }
      if (canBeVerb && !canBeNoun) {
        tagged.push({ word, tag: 'VBZ' });
        continue;
      }
      tagged.push({ word, tag: 'NNS' });
      continue;
    }

    // Base verb after modal / "to" / pronoun
    if (COMMON_VERBS.has(lower)) {
      if (
        prev !== null &&
        (prev.tag === 'MD' ||
          prevWord === 'to' ||
          prev.tag === 'PRP' ||
          prevWord === "n't" ||
          prevWord === 'not' ||
          prev.tag === 'NNS')
      ) {
        tagged.push({ word, tag: prevWord === 'to' || prev.tag === 'MD' ? 'VB' : 'VBP' });
        continue;
      }
    }

    // Proper nouns (capitalized non-initial word)
    if (i > 0 && /^[A-Z][a-z]+$/.test(word)) {
      tagged.push({ word, tag: 'NNP' });
      continue;
    }

    if (COMMON_COUNT_NOUNS.has(lower)) {
      tagged.push({ word, tag: 'NN' });
      continue;
    }

    if (COMMON_VERBS.has(lower)) {
      tagged.push({ word, tag: 'VB' });
      continue;
    }

    tagged.push({ word, tag: 'NN' });
  }

  return tagged;
}
