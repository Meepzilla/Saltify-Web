import type { SpeakerAliases } from '../types/saltify';
import { stripPosCodes } from './posCodes';
import { parseUtteranceLines } from './transcriptFormat';

type CmuDict = Record<string, string>;

let loadedDict: CmuDict | null = null;
let loadPromise: Promise<CmuDict> | null = null;

/**
 * Lazily loads the 135k-word CMU Pronouncing Dictionary on the main thread
 * (kept out of the Whisper Web Worker and code-split into its own offline-cached chunk).
 */
export async function ensureIpaDictionary(): Promise<CmuDict> {
  if (loadedDict) return loadedDict;
  if (!loadPromise) {
    loadPromise = import('cmu-pronouncing-dictionary').then((mod) => {
      loadedDict = mod.dictionary as CmuDict;
      return loadedDict;
    });
  }
  return loadPromise;
}

export function isIpaDictionaryLoaded(): boolean {
  return loadedDict !== null;
}

// ==================== ARPAbet -> GENERAL AMERICAN BROAD IPA ====================

/**
 * Exact General American English broad phonemic IPA symbols:
 * - True IPA U+0261 `ɡ` (script g), U+0279 `ɹ` (alveolar approximant)
 * - U+028C `ʌ` (stressed) vs U+0259 `ə` (unstressed schwa) for AH
 * - U+025D `ɝ` (stressed) vs U+025A `ɚ` (unstressed schwar) for ER
 * - Primary stress U+02C8 `ˈ` and secondary stress U+02CC `ˌ` placed at syllable onset
 */
const ARPABET_CONSONANT_TO_IPA: Record<string, string> = {
  P: 'p',
  B: 'b',
  T: 't',
  D: 'd',
  K: 'k',
  G: 'ɡ', // U+0261 Latin Small Letter Script G
  F: 'f',
  V: 'v',
  TH: 'θ', // U+03B8
  DH: 'ð', // U+00F0
  S: 's',
  Z: 'z',
  SH: 'ʃ', // U+0283
  ZH: 'ʒ', // U+0292
  HH: 'h',
  CH: 'tʃ',
  JH: 'dʒ',
  M: 'm',
  N: 'n',
  NG: 'ŋ', // U+014B
  L: 'l',
  R: 'ɹ', // U+0279 Latin Small Letter Turned R
  W: 'w',
  Y: 'j',
};

const ARPABET_VOWEL_TO_IPA: Record<string, string> = {
  AA: 'ɑ', // U+0251
  AE: 'æ', // U+00E6
  AO: 'ɔ', // U+0254
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ', // U+025B
  EY: 'eɪ',
  IH: 'ɪ', // U+026A
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ', // U+028A
  UW: 'u',
};

// Valid English 2-consonant and 3-consonant syllable onsets for the Maximal Onset Principle
const VALID_ONSET_2 = new Set([
  'P L', 'P R', 'P Y',
  'B L', 'B R', 'B Y',
  'T R', 'T W', 'T Y',
  'D R', 'D W', 'D Y',
  'K L', 'K R', 'K W', 'K Y',
  'G L', 'G R', 'G W', 'G Y',
  'F L', 'F R', 'F Y',
  'V Y',
  'TH R', 'TH W',
  'SH R',
  'HH Y', 'M Y', 'N Y',
  'S P', 'S T', 'S K', 'S F', 'S M', 'S N', 'S L', 'S W', 'S Y',
]);

const VALID_ONSET_3 = new Set([
  'S P L', 'S P R', 'S P Y',
  'S T R',
  'S K L', 'S K R', 'S K W', 'S K Y',
]);

function isLegalOnset(cluster: string[]): boolean {
  if (cluster.length === 0) return true;
  if (cluster.length === 1) return cluster[0] !== 'NG';
  if (cluster.length === 2) return VALID_ONSET_2.has(`${cluster[0]} ${cluster[1]}`);
  if (cluster.length === 3) return VALID_ONSET_3.has(`${cluster[0]} ${cluster[1]} ${cluster[2]}`);
  return false;
}

interface ParsedArpaToken {
  base: string;
  stress: '0' | '1' | '2' | null;
  ipa: string;
}

function parseArpabetToken(raw: string): ParsedArpaToken | null {
  const match = /^([A-Z]+)([012])?$/.exec(raw);
  if (!match) return null;
  const base = match[1];
  const stress = (match[2] as '0' | '1' | '2' | undefined) ?? null;

  if (stress !== null) {
    if (base === 'AH') {
      return { base, stress, ipa: stress === '0' ? 'ə' : 'ʌ' };
    }
    if (base === 'ER') {
      return { base, stress, ipa: stress === '0' ? 'ɚ' : 'ɝ' };
    }
    const vowelIpa = ARPABET_VOWEL_TO_IPA[base];
    if (vowelIpa) return { base, stress, ipa: vowelIpa };
  }

  const consIpa = ARPABET_CONSONANT_TO_IPA[base];
  if (consIpa) return { base, stress: null, ipa: consIpa };
  return null;
}

/**
 * Converts a CMUdict ARPAbet transcription (e.g. "P L EY1 G R AW2 N D")
 * into General American English broad IPA (e.g. "ˈpleɪˌɡɹaʊnd"), placing
 * primary (`ˈ`) and secondary (`ˌ`) stress marks at syllable onsets via the
 * Maximal Onset Principle and omitting primary stress on monosyllables.
 */
export function arpabetToBroadIpa(arpabet: string): string {
  const tokens: ParsedArpaToken[] = [];
  for (const raw of arpabet.trim().split(/\s+/)) {
    const parsed = parseArpabetToken(raw);
    if (parsed) tokens.push(parsed);
  }
  if (tokens.length === 0) return '';

  const vowelIndices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].stress !== null) vowelIndices.push(i);
  }

  // Monosyllabic or vowelless words (e.g., "dog", "hmm"): no stress mark in broad IPA
  if (vowelIndices.length <= 1) {
    return tokens.map((t) => t.ipa).join('');
  }

  // Determine syllable start indices using Maximal Onset Principle
  const syllableStarts: number[] = [0];
  for (let s = 1; s < vowelIndices.length; s++) {
    const prevV = vowelIndices[s - 1];
    const currV = vowelIndices[s];
    const consCount = currV - prevV - 1;
    let onsetLen = 0;
    const maxCheck = Math.min(3, consCount);
    for (let len = maxCheck; len >= 1; len--) {
      const slice = tokens.slice(currV - len, currV).map((t) => t.base);
      if (isLegalOnset(slice)) {
        onsetLen = len;
        break;
      }
    }
    syllableStarts.push(currV - onsetLen);
  }

  let out = '';
  for (let s = 0; s < syllableStarts.length; s++) {
    const start = syllableStarts[s];
    const end = s + 1 < syllableStarts.length ? syllableStarts[s + 1] : tokens.length;
    const stress = tokens[vowelIndices[s]].stress;
    if (stress === '1') out += 'ˈ';
    else if (stress === '2') out += 'ˌ';
    for (let i = start; i < end; i++) {
      out += tokens[i].ipa;
    }
  }
  return out;
}

// ==================== CLINICAL OVERRIDES, MORPHOLOGY & G2P FALLBACK ====================

/**
 * Clinical SLP broad IPA overrides for conversational fillers, common weak/citation forms,
 * and spoken variants missing from or inconsistent in CMUdict.
 */
const CLINICAL_IPA_OVERRIDES: Record<string, string> = {
  and: 'ænd',
  was: 'wʌz',
  putting: 'ˈpʊtɪŋ',
  live: 'lɪv',
  wind: 'wɪnd',
  dogs: 'dɔɡz',
  um: 'ʌm',
  uhm: 'ʌm',
  umm: 'ʌm',
  uh: 'ʌ',
  uhh: 'ʌ',
  er: 'ɝ',
  erm: 'ɝm',
  eh: 'ɛ',
  ah: 'ɑ',
  mm: 'm',
  hm: 'hm',
  hmm: 'hm',
  mhm: 'mˈhm',
  'mm-hmm': 'mˈhm',
  'uh-huh': 'ʌˈhʌ',
  'uh-oh': 'ˈʌˌoʊ',
  kinda: 'ˈkaɪndə',
  sorta: 'ˈsɔɹtə',
  gonna: 'ˈɡʌnə',
  wanna: 'ˈwɑnə',
  gotta: 'ˈɡɑtə',
  yeah: 'jæ',
  yep: 'jɛp',
  nope: 'noʊp',
  yay: 'jeɪ',
  whoa: 'woʊ',
  okay: 'ˌoʊˈkeɪ',
  ok: 'ˌoʊˈkeɪ',
  mr: 'ˈmɪstɚ',
  mrs: 'ˈmɪsɪz',
  ms: 'mɪz',
  dr: 'ˈdɑktɚ',
  st: 'seɪnt',
  'i\'m': 'aɪm',
  'isn\'t': 'ˈɪzənt',
  'aren\'t': 'ɑɹnt',
  'wasn\'t': 'ˈwʌzənt',
  'weren\'t': 'wɝnt',
  'don\'t': 'doʊnt',
  'doesn\'t': 'ˈdʌzənt',
  'didn\'t': 'ˈdɪdənt',
  'can\'t': 'kænt',
  'won\'t': 'woʊnt',
  'wouldn\'t': 'ˈwʊdənt',
  'couldn\'t': 'ˈkʊdənt',
  'shouldn\'t': 'ˈʃʊdənt',
  'that\'s': 'ðæts',
  'there\'s': 'ðɛɹz',
  'what\'s': 'wʌts',
  'it\'s': 'ɪts',
  'he\'s': 'hiz',
  'she\'s': 'ʃiz',
  'we\'re': 'wɪɹ',
  'they\'re': 'ðɛɹ',
  'you\'re': 'jʊɹ',
  'let\'s': 'lɛts',
};

const IPA_SIBILANT_END = /(?:s|z|ʃ|ʒ|tʃ|dʒ)$/;
const IPA_VOICELESS_END = /(?:p|t|k|f|θ|s|ʃ|tʃ)$/;
const IPA_ALVEOLAR_STOP_END = /(?:t|d)$/;
const IPA_VOWEL_CHARS = /[ɑæʌəɛɪɔʊɝɚaeiou]/;

function countIpaSyllables(ipa: string): number {
  const matches = ipa.match(/(?:aɪ|aʊ|ɔɪ|eɪ|oʊ|[ɑæʌəɛɪɔʊɝɚaeiou])/g);
  return matches ? matches.length : 0;
}

function addPrimaryStressIfNeeded(ipa: string): string {
  if (ipa.includes('ˈ') || countIpaSyllables(ipa) <= 1) return ipa;
  return `ˈ${ipa}`;
}

/** Appends regular English -s/-es plural or 3rd-person singular allomorph (/s/, /z/, /ɪz/). */
function appendPluralAllomorph(stemIpa: string): string {
  if (!stemIpa) return '';
  if (IPA_SIBILANT_END.test(stemIpa)) {
    return addPrimaryStressIfNeeded(`${stemIpa}ɪz`);
  }
  if (IPA_VOICELESS_END.test(stemIpa)) {
    return `${stemIpa}s`;
  }
  return `${stemIpa}z`;
}

/** Appends regular English -ed past tense allomorph (/t/, /d/, /ɪd/). */
function appendPastAllomorph(stemIpa: string): string {
  if (!stemIpa) return '';
  if (IPA_ALVEOLAR_STOP_END.test(stemIpa)) {
    return addPrimaryStressIfNeeded(`${stemIpa}ɪd`);
  }
  if (IPA_VOICELESS_END.test(stemIpa)) {
    return `${stemIpa}t`;
  }
  return `${stemIpa}d`;
}

const ONES_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS_WORDS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function integerToWords(n: number): string[] {
  if (!Number.isFinite(n) || n < 0 || n > 9999) {
    return String(n)
      .split('')
      .map((d) => ONES_WORDS[Number(d)] ?? d);
  }
  if (n < 20) return [ONES_WORDS[n]];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? [TENS_WORDS[t]] : [TENS_WORDS[t], ONES_WORDS[r]];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r === 0
      ? [ONES_WORDS[h], 'hundred']
      : [ONES_WORDS[h], 'hundred', ...integerToWords(r)];
  }
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  return r === 0
    ? [ONES_WORDS[th], 'thousand']
    : [ONES_WORDS[th], 'thousand', ...integerToWords(r)];
}

/**
 * Reconstructs the spoken English word from a SALT bound-morpheme coded token:
 * - `dog/s` -> `dogs`, `walk/ed` -> `walked`, `go/3s` -> `goes`, `play/ing` -> `playing`
 * - `John/z` -> `john's`, `I/'m` -> `i'm`, `can/'t` -> `can't`, `is/n't` -> `isn't`
 * - `walk/*3s` -> `walk` (omitted morpheme was NOT spoken)
 */
function reconstructSpokenFromSaltMorpheme(token: string): string {
  // Handle root identification `goed|go` -> spoken surface is left side (`goed`)
  const surface = token.includes('|') ? token.split('|')[0] : token;
  if (!surface.includes('/')) return surface;

  const slashIdx = surface.indexOf('/');
  const stem = surface.slice(0, slashIdx);
  const morph = surface.slice(slashIdx + 1).toLowerCase();

  // Omitted bound morpheme (/*3s, /*ed, /*s, /*ing): child only produced the bare stem
  if (morph.startsWith('*')) return stem;

  // Contraction morphemes (I/'m, can/'t, is/n't, we/'re, they/'ve, he/'s, she/'d, I/'ll)
  if (morph.startsWith("'") || morph === "n't") {
    return `${stem}${morph}`;
  }

  // Possessive /z
  if (morph === 'z') {
    return `${stem}'s`;
  }

  // Plural /s or 3rd-person singular /3s
  if (morph === 's' || morph === '3s') {
    if (/(?:s|sh|ch|x|z|o)$/i.test(stem)) return `${stem}es`;
    if (/[^aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
    return `${stem}s`;
  }

  // Regular past /ed
  if (morph === 'ed') {
    if (/e$/i.test(stem)) return `${stem}d`;
    if (/[^aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ied`;
    return `${stem}ed`;
  }

  // Progressive /ing
  if (morph === 'ing') {
    if (/[^e]e$/i.test(stem) && stem.length > 2) return `${stem.slice(0, -1)}ing`;
    return `${stem}ing`;
  }

  return `${stem}${morph}`;
}

function lookupDictExact(lower: string, dict: CmuDict | null): string | null {
  if (CLINICAL_IPA_OVERRIDES[lower]) return CLINICAL_IPA_OVERRIDES[lower];
  if (!dict) return null;
  const arpa = dict[lower];
  if (arpa) return arpabetToBroadIpa(arpa);
  return null;
}

/**
 * Resolves regular inflections and child overregularizations (e.g., "goed", "telled",
 * "runned", "foots", "mouses", "childs") by stripping the suffix, looking up the stem
 * in CMUdict, and applying exact English phonological allomorphy.
 */
function lookupInflected(lower: string, dict: CmuDict | null): string | null {
  // Possessive 's
  if (lower.endsWith("'s") && lower.length > 2) {
    const stemIpa = lookupDictExact(lower.slice(0, -2), dict);
    if (stemIpa) return appendPluralAllomorph(stemIpa);
  }

  // Past -ed (including child overregularizations like goed, telled, runned, falled, eated, catched)
  if (lower.endsWith('ed') && lower.length > 3) {
    const candidates: string[] = [lower.slice(0, -2), lower.slice(0, -1)];
    // Doubled final consonant: runned -> run, sitted -> sit, putted -> put
    const base = lower.slice(0, -2);
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      candidates.push(base.slice(0, -1));
    }
    // -ied -> -y (e.g., flied -> fly)
    if (lower.endsWith('ied') && lower.length > 4) {
      candidates.push(`${lower.slice(0, -3)}y`);
    }
    for (const cand of candidates) {
      const stemIpa = lookupDictExact(cand, dict);
      if (stemIpa) return appendPastAllomorph(stemIpa);
    }
  }

  // Plural / 3s (-s, -es, -ies), e.g., foots, mouses, childs, sheeps, gooses
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 2) {
    const candidates: string[] = [lower.slice(0, -1)];
    if (lower.endsWith('es') && lower.length > 3) {
      candidates.push(lower.slice(0, -2));
    }
    if (lower.endsWith('ies') && lower.length > 4) {
      candidates.push(`${lower.slice(0, -3)}y`);
    }
    for (const cand of candidates) {
      const stemIpa = lookupDictExact(cand, dict);
      if (stemIpa) return appendPluralAllomorph(stemIpa);
    }
  }

  // Progressive -ing
  if (lower.endsWith('ing') && lower.length > 4) {
    const base = lower.slice(0, -3);
    const candidates = [base, `${base}e`];
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      candidates.push(base.slice(0, -1));
    }
    for (const cand of candidates) {
      const stemIpa = lookupDictExact(cand, dict);
      if (stemIpa) return addPrimaryStressIfNeeded(`${stemIpa}ɪŋ`);
    }
  }

  // -ly adverb
  if (lower.endsWith('ly') && lower.length > 4) {
    const stemIpa = lookupDictExact(lower.slice(0, -2), dict);
    if (stemIpa) return addPrimaryStressIfNeeded(`${stemIpa}li`);
  }

  // -er comparative / agentive
  if (lower.endsWith('er') && lower.length > 4) {
    const base = lower.slice(0, -2);
    const candidates = [base, `${base}e`];
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      candidates.push(base.slice(0, -1));
    }
    for (const cand of candidates) {
      const stemIpa = lookupDictExact(cand, dict);
      if (stemIpa) return addPrimaryStressIfNeeded(`${stemIpa}ɚ`);
    }
  }

  // -est superlative
  if (lower.endsWith('est') && lower.length > 5) {
    const base = lower.slice(0, -3);
    const candidates = [base, `${base}e`];
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      candidates.push(base.slice(0, -1));
    }
    for (const cand of candidates) {
      const stemIpa = lookupDictExact(cand, dict);
      if (stemIpa) return addPrimaryStressIfNeeded(`${stemIpa}ɪst`);
    }
  }

  return null;
}

/**
 * Attempts to split an unknown closed compound (e.g., "frogman", "treehouse") into
 * two known dictionary words.
 */
function lookupCompound(lower: string, dict: CmuDict | null): string | null {
  if (!dict || lower.length < 6) return null;
  for (let split = 3; split <= lower.length - 3; split++) {
    const left = lower.slice(0, split);
    const right = lower.slice(split);
    const leftIpa = lookupDictExact(left, dict);
    if (!leftIpa) continue;
    const rightIpa = lookupDictExact(right, dict) ?? lookupInflected(right, dict);
    if (rightIpa) {
      const cleanLeft = leftIpa.replace(/^ˈ/, '');
      const cleanRight = rightIpa.replace(/^ˈ/, '');
      return `ˈ${cleanLeft}ˌ${cleanRight}`;
    }
  }
  return null;
}

/**
 * Clean rule-based General American English grapheme-to-phoneme fallback for
 * out-of-vocabulary proper names or novel child words (always emitting true IPA characters).
 */
function ruleBasedEnglishToIpa(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  // Silent trailing 'e' check (magic-e pattern like "bale", "zike", "mope")
  const hasSilentE =
    w.length >= 3 &&
    w.endsWith('e') &&
    !w.endsWith('ee') &&
    !w.endsWith('le') &&
    /[bcdfghjklmnpqrstvwxz]$/.test(w.slice(0, -1)) &&
    /[aeiou]/.test(w.slice(0, -2));

  const core = hasSilentE ? w.slice(0, -1) : w;
  let out = '';
  let i = 0;

  while (i < core.length) {
    const rest = core.slice(i);
    const ch = core[i];
    const next = core[i + 1] ?? '';
    const isLastVowelMagicE =
      hasSilentE && i === core.length - 2 && /[aeiou]/.test(ch);

    // Multi-letter suffixes & clusters
    if (rest === 'tion' || rest === 'sion') {
      out += 'ʃən';
      i += 4;
    } else if (rest.startsWith('igh')) {
      out += 'aɪ';
      i += 3;
    } else if (rest.startsWith('tch')) {
      out += 'tʃ';
      i += 3;
    } else if (rest.startsWith('dge')) {
      out += 'dʒ';
      i += 3;
    } else if (rest.startsWith('ch')) {
      out += 'tʃ';
      i += 2;
    } else if (rest.startsWith('sh')) {
      out += 'ʃ';
      i += 2;
    } else if (rest.startsWith('th')) {
      out += 'θ';
      i += 2;
    } else if (rest.startsWith('ph')) {
      out += 'f';
      i += 2;
    } else if (rest.startsWith('wh')) {
      out += 'w';
      i += 2;
    } else if (rest.startsWith('ck')) {
      out += 'k';
      i += 2;
    } else if (rest.startsWith('ng')) {
      out += 'ŋ';
      i += 2;
    } else if (rest.startsWith('qu')) {
      out += 'kw';
      i += 2;
    } else if (rest.startsWith('kn') && i === 0) {
      out += 'n';
      i += 2;
    } else if (rest.startsWith('wr') && i === 0) {
      out += 'ɹ';
      i += 2;
    } else if (rest.startsWith('ee') || rest.startsWith('ea')) {
      out += 'i';
      i += 2;
    } else if (rest.startsWith('oo')) {
      out += 'u';
      i += 2;
    } else if (rest.startsWith('ai') || rest.startsWith('ay')) {
      out += 'eɪ';
      i += 2;
    } else if (rest.startsWith('oi') || rest.startsWith('oy')) {
      out += 'ɔɪ';
      i += 2;
    } else if (rest.startsWith('ou') || rest.startsWith('ow')) {
      out += 'aʊ';
      i += 2;
    } else if (rest.startsWith('au') || rest.startsWith('aw')) {
      out += 'ɔ';
      i += 2;
    } else if (rest.startsWith('oa')) {
      out += 'oʊ';
      i += 2;
    } else if (rest.startsWith('ar') && (i + 2 >= core.length || !/[aeiou]/.test(core[i + 2]))) {
      out += 'ɑɹ';
      i += 2;
    } else if (rest.startsWith('or') && (i + 2 >= core.length || !/[aeiou]/.test(core[i + 2]))) {
      out += 'ɔɹ';
      i += 2;
    } else if (
      (rest.startsWith('er') || rest.startsWith('ir') || rest.startsWith('ur')) &&
      (i + 2 >= core.length || !/[aeiou]/.test(core[i + 2]))
    ) {
      out += i === core.length - 2 && IPA_VOWEL_CHARS.test(out) ? 'ɚ' : 'ɝ';
      i += 2;
    } else if (rest === 'le' && i > 0 && !/[aeiou]/.test(core[i - 1])) {
      out += 'əl';
      i += 2;
    } else if (ch === next && /[bcdfghjklmnpqrstvwxz]/.test(ch)) {
      // Collapse doubled consonant
      i += 1;
    } else {
      switch (ch) {
        case 'a':
          out += isLastVowelMagicE ? 'eɪ' : 'æ';
          break;
        case 'e':
          out += isLastVowelMagicE ? 'i' : 'ɛ';
          break;
        case 'i':
          out += isLastVowelMagicE ? 'aɪ' : 'ɪ';
          break;
        case 'o':
          out += isLastVowelMagicE ? 'oʊ' : 'ɑ';
          break;
        case 'u':
          out += isLastVowelMagicE ? 'u' : 'ʌ';
          break;
        case 'y':
          out += i === 0 ? 'j' : i === core.length - 1 ? 'i' : 'ɪ';
          break;
        case 'c':
          out += /[eiy]/.test(next) ? 's' : 'k';
          break;
        case 'g':
          out += /[eiy]/.test(next) ? 'dʒ' : 'ɡ';
          break;
        case 'j':
          out += 'dʒ';
          break;
        case 'r':
          out += 'ɹ';
          break;
        case 'x':
          out += 'ks';
          break;
        case 'q':
          out += 'k';
          break;
        default:
          out += ch;
          break;
      }
      i += 1;
    }
  }

  return addPrimaryStressIfNeeded(out);
}

/**
 * Converts a single English word (or SALT-coded word such as `dog/s`, `walk/ed`, `goed|go`)
 * to General American English broad IPA (without surrounding slashes).
 */
export function wordToBroadIpa(rawWord: string): string {
  const reconstructed = reconstructSpokenFromSaltMorpheme(rawWord).replace(/’/g, "'");
  const trimmed = reconstructed.trim();
  if (!trimmed) return '';

  // SALT unintelligible markers X / XX / XXX stay literal (not /ɛks/)
  if (/^X{1,3}$/.test(trimmed)) return trimmed;

  // Numeric tokens -> spoken English numbers -> IPA
  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    return integerToWords(num)
      .map((w) => wordToBroadIpa(w))
      .filter(Boolean)
      .join(' ');
  }

  const lower = trimmed.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  if (!lower) return '';

  // Linked words (SALT `very_very`) or hyphenated compounds (`ice-cream`)
  if (trimmed.includes('_') || trimmed.includes('-')) {
    const fullOverride = lookupDictExact(lower, loadedDict);
    if (fullOverride) return fullOverride;
    const sep = trimmed.includes('_') ? '_' : '-';
    const parts = trimmed
      .split(sep)
      .map((p) => wordToBroadIpa(p))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }

  return (
    lookupDictExact(lower, loadedDict) ??
    lookupInflected(lower, loadedDict) ??
    lookupCompound(lower, loadedDict) ??
    ruleBasedEnglishToIpa(lower)
  );
}

// ==================== UTTERANCE & TRANSCRIPT CONVERSION ====================

export interface IpaUtteranceSegment {
  kind: 'word' | 'maze' | 'code' | 'space';
  /** Rendered IPA text (or preserved SALT code/comment/whitespace). */
  text: string;
  /** Original English word for tooltip cross-referencing (when kind === 'word'). */
  original?: string;
}

/**
 * Tokenizes an utterance body into IPA segments.
 * - `preserveSaltCodes: false` (default, Transcription Box / clean IPA): strips SALT
 *   bracket codes, omits `*omitted` words, omits English punctuation (so `.` is never
 *   confused with an IPA syllable break), keeps `(mazes)` with IPA inside, and preserves
 *   `{comments}` and `X/XX/XXX`.
 * - `preserveSaltCodes: true` (SALT Convention Box): converts spoken words (including
 *   recombined bound morphemes) to IPA while keeping SALT codes (`[EO:went]`, `[SI-1]`,
 *   `[MC]`), `*omitted` markers, `{comments}`, and `(mazes)` visible.
 */
export function tokenizeUtteranceBodyToIpa(
  body: string,
  options: { preserveSaltCodes?: boolean } = {}
): IpaUtteranceSegment[] {
  const preserveSaltCodes = options.preserveSaltCodes ?? false;
  const cleaned = stripPosCodes(body).trim();
  if (!cleaned) return [];

  // Split into SALT comments, bracket codes, mazes, omitted words, and normal tokens
  const tokenRe = /(\{[^}]*\}|\([^)]*\)|\[[^\]]+\]|\*[A-Za-z']+|\S+)/g;
  const rawTokens = cleaned.match(tokenRe) ?? [];
  const out: IpaUtteranceSegment[] = [];

  const pushSpaceIfNeeded = () => {
    if (out.length > 0 && out[out.length - 1].kind !== 'space') {
      out.push({ kind: 'space', text: ' ' });
    }
  };

  for (const raw of rawTokens) {
    // 1. SALT comment `{laughs}`
    if (raw.startsWith('{') && raw.endsWith('}')) {
      pushSpaceIfNeeded();
      out.push({ kind: 'code', text: raw });
      continue;
    }

    // 2. Standalone SALT bracket code `[SI-1]`, `[MC]`, `[EU]`, etc.
    if (raw.startsWith('[') && raw.endsWith(']')) {
      if (preserveSaltCodes) {
        pushSpaceIfNeeded();
        out.push({ kind: 'code', text: raw });
      }
      continue;
    }

    // 3. Omitted word `*is`, `*to`
    if (raw.startsWith('*')) {
      if (preserveSaltCodes) {
        pushSpaceIfNeeded();
        out.push({ kind: 'code', text: raw });
      }
      continue;
    }

    // 4. Maze `(um I)` -> render spoken fillers/words inside parentheses as IPA
    if (raw.startsWith('(') && raw.endsWith(')')) {
      const inner = raw.slice(1, -1).trim();
      const innerIpa = inner
        .split(/\s+/)
        .map((w) => wordToBroadIpa(w))
        .filter(Boolean)
        .join(' ');
      if (innerIpa) {
        pushSpaceIfNeeded();
        out.push({ kind: 'maze', text: `(${innerIpa})`, original: raw });
      }
      continue;
    }

    // 5. Abandoned `>` or interrupted `^` utterance marker
    if (/^[>^.,!?;:]+$/.test(raw)) {
      if (preserveSaltCodes && /[>^]/.test(raw)) {
        pushSpaceIfNeeded();
        out.push({ kind: 'code', text: raw.replace(/[^>^]/g, '') });
      }
      continue;
    }

    // 6. Spoken word possibly carrying inline SALT error code(s), e.g., `telled[EW:told].` or `goed|go[EO:went]`
    const codeMatch = /^([^[\]]+?)((?:\[[^\]]+\])+)[.,!?;:>^]*$/.exec(raw);
    const wordPart = codeMatch ? codeMatch[1] : raw.replace(/^[.,!?;:"“”]+|[.,!?;:"“”>^]+$/g, '');
    const trailingCodes = codeMatch ? codeMatch[2] : '';
    const trailingMarker = /[>^]$/.exec(raw)?.[0] ?? '';

    if (wordPart) {
      const ipa = wordToBroadIpa(wordPart);
      if (ipa) {
        pushSpaceIfNeeded();
        out.push({
          kind: 'word',
          text: ipa,
          original: reconstructSpokenFromSaltMorpheme(wordPart),
        });
      }
    }

    if (preserveSaltCodes && trailingCodes) {
      out.push({ kind: 'code', text: trailingCodes });
    }
    if (preserveSaltCodes && trailingMarker) {
      pushSpaceIfNeeded();
      out.push({ kind: 'code', text: trailingMarker });
    }
  }

  return out;
}

/**
 * Formats a single utterance body as a General American English broad IPA string
 * wrapped in standard phonemic slashes `/ ... /`.
 */
export function formatUtteranceBodyAsIpa(
  body: string,
  options: { preserveSaltCodes?: boolean } = {}
): string {
  const segments = tokenizeUtteranceBodyToIpa(body, options);
  if (segments.length === 0) return '';
  const joined = segments
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!joined) return '';

  // Keep standalone comments `{nods}` outside phonemic slashes
  if (/^\{[^}]*\}$/.test(joined)) return joined;
  return `/${joined}/`;
}

/**
 * Converts an entire multi-line transcript string to broad IPA transcription,
 * preserving `[M:SS]` timestamps, speaker labels, and blank lines.
 */
export function convertTranscriptToIpa(
  text: string,
  aliases: SpeakerAliases,
  options: { preserveSaltCodes?: boolean } = {}
): string {
  if (!text.trim()) return text;
  const parsed = parseUtteranceLines(text, aliases);

  return parsed
    .map((line) => {
      const trimmedRaw = line.raw.trim();
      if (!trimmedRaw) return line.raw;
      // Preserve SALT header and timing lines ($ Child, Examiner, + Name:, = comment, - 0:00)
      if (!line.speaker && /^(?:[$+=]\s|-\s+\d+:\d{2})/.test(trimmedRaw)) {
        return line.raw;
      }
      const ipaBody = formatUtteranceBodyAsIpa(line.body, options);
      if (!ipaBody) return line.raw;
      const tsPart = line.timestampStr ? `[${line.timestampStr}]` : null;
      return [tsPart, line.speaker, ipaBody].filter(Boolean).join(' ');
    })
    .join('\n');
}
