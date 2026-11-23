import posTagger from 'wink-pos-tagger';
import lemmatizer from 'wink-lemmatizer';

const tagger = posTagger();

const TO_BE_VERBS = new Set([
  'am',
  'is',
  'are',
  'will be',
  'was',
  'were',
  'been',
  "'m",
  "'s",
  "'re",
]);

/**
 * Checks whether a token represents a "to be" verb form, matching
 * oss-slu/SpeechTranscription addConventions.isToBeVerb().
 */
export function isToBeVerb(verb: string): boolean {
  return TO_BE_VERBS.has(verb.toLowerCase());
}

/**
 * Conjugates an English base verb into 3rd-person singular present indicative
 * (replaces Python's unmaintained `pattern.text.en.conjugate` for `/*3s` coding).
 */
export function conjugateThirdPersonSingular(baseVerb: string): string {
  if (!baseVerb) return baseVerb;
  const lower = baseVerb.toLowerCase();

  const irregulars: Record<string, string> = {
    be: 'is',
    have: 'has',
    do: 'does',
    go: 'goes',
    can: 'can',
    may: 'may',
    must: 'must',
    shall: 'shall',
    will: 'will',
  };

  const matchCase = (result: string): string => {
    if (baseVerb[0] === baseVerb[0].toUpperCase() && baseVerb[0] !== baseVerb[0].toLowerCase()) {
      return result[0].toUpperCase() + result.slice(1);
    }
    return result;
  };

  if (irregulars[lower]) {
    return matchCase(irregulars[lower]);
  }

  if (/(?:s|ss|sh|ch|x|z|o)$/.test(lower)) {
    return matchCase(`${lower}es`);
  }
  if (/[^aeiou]y$/.test(lower)) {
    return matchCase(`${lower.slice(0, -1)}ies`);
  }
  return matchCase(`${lower}s`);
}

/**
 * Splits leading [M:SS] timestamp and optional speaker prefix (C, E, or custom alias)
 * from an utterance line so NLP/SALT transforms never corrupt headers.
 */
export function extractLinePrefix(
  line: string,
  speakerAliases: readonly string[] = ['C', 'E']
): { prefix: string; body: string } {
  let remaining = line.trim();
  let prefix = '';

  const tsMatch = remaining.match(/^(\[\d+:\d{2}\])\s*/);
  if (tsMatch) {
    prefix += tsMatch[1] + ' ';
    remaining = remaining.slice(tsMatch[0].length);
  }

  const normalizedAliases = [...new Set([...speakerAliases, 'C', 'E', 'Speaker 1', 'Speaker 2'])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const alias of normalizedAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const spkMatch = remaining.match(new RegExp(`^(${escaped})(?=\\s+)`));
    if (spkMatch) {
      prefix += spkMatch[1] + ' ';
      remaining = remaining.slice(spkMatch[0].length).trimStart();
      break;
    }
  }

  return { prefix, body: remaining };
}

/**
 * Removes SALT error coding and mazes from a sentence so POS tagging and
 * lemmatization can analyze the clean grammatical form.
 * Mirrors oss-slu/SpeechTranscription addConventions.removeErrorCoding() with
 * improved handling for single-word mazes like `(He)` and trailing punctuation.
 */
export function removeErrorCoding(input: string): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const output: string[] = [];
  let inMaze = false;

  for (const word of words) {
    if (inMaze) {
      if (word.includes(')')) {
        inMaze = false;
      }
      continue;
    }

    // Single-token maze e.g. "(He)" or "(um)"
    if (word.startsWith('(') && word.includes(')')) {
      continue;
    }

    // Multi-token maze start e.g. "(I"
    if (word.includes('(')) {
      inMaze = true;
      continue;
    }

    // Bracketed error codes: e.g. "are[EW:is]", "telled[EO:told]", "his[EP:her]", "at[EW]"
    if (word.includes('[')) {
      const bracketStart = word.indexOf('[');
      const bracketEnd = word.indexOf(']', bracketStart);
      if (bracketEnd !== -1) {
        const inside = word.slice(bracketStart + 1, bracketEnd);
        const trailingPunct = word.slice(bracketEnd + 1);
        const colonIdx = inside.indexOf(':');
        if (colonIdx !== -1) {
          const replacement = inside.slice(colonIdx + 1);
          output.push(replacement + trailingPunct);
        }
        // Else extra word [EW] or [EU]: omit token from clean sentence (preserve trailing sentence punctuation if attached)
        else if (trailingPunct && output.length > 0) {
          output[output.length - 1] += trailingPunct;
        }
        continue;
      }
    }

    // Omitted 3rd-person singular bound morpheme: "go/*3s" -> "goes"
    if (word.includes('/*3s')) {
      const match = word.match(/^([^/]+)\/\*3s(.*)$/);
      if (match) {
        output.push(conjugateThirdPersonSingular(match[1]) + match[2]);
        continue;
      }
    }

    // Omitted word marker: "*to" or "to*" -> "to"
    if (word.includes('*')) {
      const cleaned = word.replace(/\*/g, '');
      if (cleaned) output.push(cleaned);
      continue;
    }

    output.push(word);
  }

  return output.join(' ').trim();
}

/**
 * Simple sentence splitter preserving SALT codes and abbreviations.
 */
export function splitSentences(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const sentences: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // If the line starts with a timestamp or speaker code, keep each line as a clinical utterance
    if (/^\[\d+:\d{2}\]/.test(trimmed) || /^(?:C|E|Speaker \d+)\s+/.test(trimmed)) {
      sentences.push(trimmed);
      continue;
    }

    // Otherwise split plain prose on sentence-ending punctuation
    const parts = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g);
    if (parts) {
      for (const part of parts) {
        const clean = part.trim();
        if (clean) sentences.push(clean);
      }
    } else {
      sentences.push(trimmed);
    }
  }

  return sentences;
}

function lemmatizeNounPreservingCase(word: string): string {
  const lower = word.toLowerCase();
  // Common nouns where wink-lemmatizer or NLTK differs slightly or edge-cases occur
  const customNounLemmas: Record<string, string> = {
    cookies: 'cookie',
    boxes: 'box',
    castles: 'castle',
    kinds: 'kind',
    doctors: 'doctor',
    balloons: 'balloon',
    loops: 'loop',
    carrots: 'carrot',
    shoes: 'shoe',
    dogs: 'dog',
    kids: 'kid',
    toys: 'toy',
    boys: 'boy',
    girls: 'girl',
    stories: 'story',
    puppies: 'puppy',
    kitties: 'kitty',
    babies: 'baby',
    houses: 'house',
    horses: 'horse',
    buses: 'bus',
    glasses: 'glass',
    dishes: 'dish',
    brushes: 'brush',
    watches: 'watch',
    peaches: 'peach',
    friends: 'friend',
    hands: 'hand',
    blocks: 'block',
  };

  let lemma = customNounLemmas[lower] ?? lemmatizer.noun(lower);
  if (!lemma || lemma === lower) {
    // Fallback morphological stripping for regular plurals ending in s
    if (lower.endsWith('ies') && lower.length > 3) {
      lemma = lower.slice(0, -3) + 'y';
    } else if (/(?:ches|shes|xes|zes|sses)$/.test(lower)) {
      lemma = lower.slice(0, -2);
    } else if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 2) {
      lemma = lower.slice(0, -1);
    }
  }

  return restoreInitialCase(word, lemma);
}

function lemmatizeVerbPreservingCase(word: string): string {
  const lower = word.toLowerCase();
  const customVerbLemmas: Record<string, string> = {
    putting: 'put',
    running: 'run',
    swimming: 'swim',
    sitting: 'sit',
    getting: 'get',
    hitting: 'hit',
    cutting: 'cut',
    stopping: 'stop',
    dropping: 'drop',
    slipping: 'slip',
    slipped: 'slip',
    stopped: 'stop',
    dropped: 'drop',
    hopped: 'hop',
    grabbed: 'grab',
    hugged: 'hug',
    clapped: 'clap',
    untied: 'untie',
    tied: 'tie',
    tried: 'try',
    cried: 'cry',
    carried: 'carry',
    played: 'play',
    stayed: 'stay',
    liked: 'like',
    loved: 'love',
    baked: 'bake',
    danced: 'dance',
    smiled: 'smile',
    lived: 'live',
    used: 'use',
    moved: 'move',
    having: 'have',
    making: 'make',
    taking: 'take',
    giving: 'give',
    coming: 'come',
    riding: 'ride',
    hiding: 'hide',
    diving: 'dive',
    baking: 'bake',
    dancing: 'dance',
    smiling: 'smile',
    writing: 'write',
    biting: 'bite',
    driving: 'drive',
    goes: 'go',
    does: 'do',
    likes: 'like',
    walks: 'walk',
    wants: 'want',
    plays: 'play',
    runs: 'run',
    eats: 'eat',
    looks: 'look',
    jumps: 'jump',
  };

  let lemma = customVerbLemmas[lower] ?? lemmatizer.verb(lower);

  // If still unchanged for regular -ed or -ing forms, apply gentle morphological rule
  if (lemma === lower) {
    if (lower.endsWith('ied') && lower.length > 4) {
      lemma = lower.slice(0, -3) + 'y';
    } else if (lower.endsWith('ed') && lower.length > 3) {
      const stem = lower.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && !/[lsz]$/.test(stem)) {
        lemma = stem.slice(0, -1);
      } else {
        lemma = stem;
      }
    } else if (lower.endsWith('ing') && lower.length > 4) {
      const stem = lower.slice(0, -3);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && !/[lsz]$/.test(stem)) {
        lemma = stem.slice(0, -1);
      } else {
        lemma = stem;
      }
    }
  }

  return restoreInitialCase(word, lemma);
}

function restoreInitialCase(original: string, target: string): string {
  if (!original || !target) return target;
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return target.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

/**
 * Adds SALT inflectional bound morpheme slash coding to a single clean sentence
 * (without SALT error coding), matching oss-slu/SpeechTranscription
 * addConventions.addInflectionalMorphemesToSentence().
 *
 * Rules applied:
 * - Plural nouns ending in 's' (NNS): `dogs` -> `dog/s`
 * - Possessive `'s` (POS): `John's` -> `John/z`
 * - Verb contraction `'s`: `it's` -> `it/'s`
 * - Past tense ending in 'ed' (VBD): `walked` -> `walk/ed`
 * - 3rd-person singular present verb (VBZ, excluding `is`, `has`): `goes` -> `go/3s`
 * - Present participle (VBG preceded by a "to be" verb): `working` -> `work/ing`
 * - Contractions: `/n't`, `/'t`, `/'ll`, `/'m`, `/'d`, `/'re`, `/'ve`
 *   with irregular exceptions: `can't` -> `can/'t`, `don't` -> `don't`, `won't` -> `won't`
 */
function encodeAlphaIndex(index: number): string {
  let n = index;
  let result = '';
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  } while (n > 0);
  return result.padStart(2, 'A');
}

function decodeAlphaIndex(tag: string): number {
  let n = 0;
  for (let i = 0; i < tag.length; i++) {
    n = n * 26 + (tag.charCodeAt(i) - 65);
  }
  return n;
}

export function addInflectionalMorphemesToSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (!trimmed) return '';

  // Protect already-SALT-coded slash tokens (e.g. walk/ed, dog/s, I/'m, can/'t, did/n't, John/z, walk/*3s)
  // using pure-letter placeholders so wink-pos-tagger never splits them into multiple tokens
  // and repeated "Add Morphemes" presses remain strictly idempotent.
  const preservedTokens: string[] = [];
  const masked = trimmed.replace(/[A-Za-z0-9']+\/[A-Za-z0-9'*]+/g, (match) => {
    const id = `SALTCODED${encodeAlphaIndex(preservedTokens.length)}`;
    preservedTokens.push(match);
    return id;
  });

  const tokens = tagger.tagSentence(masked);
  let converted = '';
  let mostRecentVerbIsToBe = false;
  let inDoubleQuote = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const val = token.value;
    const pos = token.pos;
    const lower = val.toLowerCase();

    // Restore already SALT-coded token verbatim and update to-be verb context
    const maskedMatch = val.match(/^SALTCODED([A-Z]{2,})$/);
    if (maskedMatch) {
      const originalCoded = preservedTokens[decodeAlphaIndex(maskedMatch[1])];
      const lowerCoded = originalCoded.toLowerCase();
      converted += `${originalCoded} `;
      const root = lowerCoded.split('/')[0];
      if (/\/(?:'m|'s|'re)$/.test(lowerCoded) || isToBeVerb(root)) {
        mostRecentVerbIsToBe = true;
      } else if (/\/(?:ed|3s|ing)$/.test(lowerCoded)) {
        mostRecentVerbIsToBe = false;
      }
      continue;
    }

    // Preserve quotation marks without introducing spaces inside quotes
    if (val === '“' || val === '‘' || (val === '"' && !inDoubleQuote)) {
      converted += val;
      if (val === '"') inDoubleQuote = true;
      continue;
    }
    if (val === '”' || val === '’' || (val === '"' && inDoubleQuote)) {
      converted = converted.replace(/ $/, '') + val + ' ';
      if (val === '"') inDoubleQuote = false;
      continue;
    }

    // Plural noun ending in 's'
    if (pos === 'NNS' && lower.endsWith('s') && lower.length > 2) {
      converted += `${lemmatizeNounPreservingCase(val)}/s `;
    }
    // Possessive 's
    else if (val === "'s" && pos === 'POS') {
      converted = converted.replace(/ $/, '') + '/z ';
    }
    // Contraction 's (verb is/has)
    else if (val === "'s") {
      converted = converted.replace(/ $/, '') + "/'s ";
    }
    // Regular past tense verb ending in 'ed'
    else if (pos === 'VBD' && lower.endsWith('ed') && lower.length > 2) {
      converted += `${lemmatizeVerbPreservingCase(val)}/ed `;
    }
    // Third-person singular present verb (excluding is, has)
    else if (pos === 'VBZ' && lower !== 'is' && lower !== 'has' && lower !== "'s") {
      converted += `${lemmatizeVerbPreservingCase(val)}/3s `;
    }
    // Present participle after a "to be" verb (distinguishes participle from gerund)
    else if (pos === 'VBG' && mostRecentVerbIsToBe && lower.endsWith('ing')) {
      const lemma = lemmatizeVerbPreservingCase(val);
      if (lemma.toLowerCase() === lower) {
        converted += `${lemma} `;
      } else {
        converted += `${lemma}/ing `;
      }
    }
    // Contraction suffixes
    else if (lower === "n't") {
      converted = converted.replace(/ $/, '') + "/n't ";
    } else if (lower === "'t") {
      converted = converted.replace(/ $/, '') + "/'t ";
    } else if (lower === "'ll") {
      converted = converted.replace(/ $/, '') + "/'ll ";
    } else if (lower === "'m") {
      converted = converted.replace(/ $/, '') + "/'m ";
    } else if (lower === "'d") {
      converted = converted.replace(/ $/, '') + "/'d ";
    } else if (lower === "'re") {
      converted = converted.replace(/ $/, '') + "/'re ";
    } else if (lower === "'ve") {
      converted = converted.replace(/ $/, '') + "/'ve ";
    }
    // Punctuation attachment
    else if (val === ',' || val === ';') {
      converted = converted.replace(/ $/, '') + val + ' ';
    } else if (val === '.' || val === '?' || val === '!') {
      converted = converted.replace(/ $/, '') + val + ' ';
    } else {
      converted += val + ' ';
    }

    // Track whether the most recent verb is a "to be" verb
    if (
      pos === 'VB' ||
      pos === 'VBD' ||
      pos === 'VBP' ||
      pos === 'VBZ' ||
      lower === 'been'
    ) {
      mostRecentVerbIsToBe = isToBeVerb(lower);
    }
  }

  // Irregular SALT contraction conventions (exact parity with addConventions.py)
  converted = converted
    .replace(/\bca\/n't\b/g, "can/'t")
    .replace(/\bCa\/n't\b/g, "Can/'t")
    .replace(/\bdo\/n't\b/g, "don't")
    .replace(/\bDo\/n't\b/g, "Don't")
    .replace(/\bwo\/n't\b/g, "won't")
    .replace(/\bWo\/n't\b/g, "Won't");

  return converted.trim();
}

/**
 * Merges bound morphemes from a clean saltified sentence back into an utterance
 * that already contains SALT error coding (`[EW]`, `[EW:...]`, `[EO:...]`,
 * `[EP:...]`, `*word`, `/*3s`, `(mazes)`).
 */
export function addInflectionalMorphemesToLine(
  line: string,
  speakerAliases: readonly string[] = ['C', 'E']
): string {
  const { prefix, body } = extractLinePrefix(line, speakerAliases);
  if (!body) return line.trim();

  const hasErrorCoding =
    body.includes('[') || body.includes('*') || body.includes('(');

  if (!hasErrorCoding) {
    return `${prefix}${addInflectionalMorphemesToSentence(body)}`.trim();
  }

  const clean = removeErrorCoding(body);
  const morphemesOnClean = addInflectionalMorphemesToSentence(clean);
  const originalWords = body.split(/\s+/).filter(Boolean);
  const correctedWords = morphemesOnClean.split(/\s+/).filter(Boolean);

  const finalWords: string[] = [];
  let origIdx = 0;
  let corrIdx = 0;

  while (origIdx < originalWords.length) {
    const origWord = originalWords[origIdx];

    // Extra word [EW] or [EU] (no replacement colon) was omitted in clean sentence
    if (origWord.includes('[') && !origWord.includes(':')) {
      finalWords.push(origWord);
      origIdx += 1;
      continue;
    }

    // Word-level substitution [EW:...] / [EO:...] / [EP:...] or omission * / /*3s
    if (origWord.includes('[') || origWord.includes('*')) {
      finalWords.push(origWord);
      origIdx += 1;
      corrIdx += 1;
      continue;
    }

    // Maze token(s) enclosed in parentheses: "(I I)" or "(He)"
    if (origWord.includes('(')) {
      finalWords.push(origWord);
      if (!origWord.includes(')')) {
        origIdx += 1;
        while (origIdx < originalWords.length) {
          finalWords.push(originalWords[origIdx]);
          if (originalWords[origIdx].includes(')')) {
            break;
          }
          origIdx += 1;
        }
      }
      origIdx += 1;
      continue;
    }

    // Normal word: pull saltified morpheme form from correctedWords
    if (corrIdx < correctedWords.length) {
      let nextWord = correctedWords[corrIdx];
      // If a following standalone bracket code (e.g. "[SI-1].", "[EU].") carried the sentence's
      // terminal punctuation, removeErrorCoding temporarily moved that punctuation onto this word.
      if (!/[.!?]+$/.test(origWord) && /[.!?]+$/.test(nextWord)) {
        let lookahead = origIdx + 1;
        while (
          lookahead < originalWords.length &&
          originalWords[lookahead].includes('[') &&
          !originalWords[lookahead].includes(':')
        ) {
          if (/^\[[^\]]+\][.!?]+$/.test(originalWords[lookahead])) {
            nextWord = nextWord.replace(/[.!?]+$/, '');
            break;
          }
          lookahead += 1;
        }
      }
      finalWords.push(nextWord);
    } else {
      finalWords.push(origWord);
    }
    origIdx += 1;
    corrIdx += 1;
  }

  return `${prefix}${finalWords.join(' ')}`.trim();
}

/**
 * Applies SALT inflectional morphemes across an entire multi-line transcript,
 * preserving timestamps, speaker prefixes, and any existing SALT error coding.
 */
export function addInflectionalMorphemes(
  transcript: string,
  speakerAliases: readonly string[] = ['C', 'E']
): string {
  const lines = transcript.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    result.push(addInflectionalMorphemesToLine(line, speakerAliases));
  }

  return result.join('\n');
}

/**
 * Normalizes a timestamped correction line before appending it to the Convention Box
 * without stripping SALT bracket annotations (mirrors components/salt_utils.py).
 */
export function formatCorrectionForConventionBox(correctedSentence: string): string {
  const sentence = correctedSentence.trim();
  if (!sentence) return '';
  const tsMatch = sentence.match(/^(\[\d+:\d{2}\])\s*(.*)$/);
  if (tsMatch) {
    return `${tsMatch[1]} ${tsMatch[2].trim()}`;
  }
  return sentence;
}
