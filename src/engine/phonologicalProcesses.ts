/**
 * Phonological process analysis.
 *
 * Takes the per-word comparison of expected (dictionary) phones vs heard phones
 * (see speechSounds.compareWordsToHeard) and classifies each difference into the
 * phonological processes clinicians score: fronting, stopping, gliding, final consonant
 * deletion, cluster reduction, weak syllable deletion, and so on. Also counts
 * opportunities, so each process can be reported as a percentage of occurrence.
 *
 * The analysis is only as good as its inputs: the "expected" form is the dictionary
 * pronunciation of the word Whisper wrote (so the target word should be checked), and the
 * heard sounds come from an automatic phoneme recognizer.
 */
import { comparablePhone, samePhone, type WordSoundComparison } from './speechSounds';

export type ProcessId =
  | 'velar-fronting'
  | 'palatal-fronting'
  | 'backing'
  | 'stopping'
  | 'gliding'
  | 'vowelization'
  | 'deaffrication'
  | 'affrication'
  | 'labialization'
  | 'interdental-lisp'
  | 'glottal-replacement'
  | 'prevocalic-voicing'
  | 'final-devoicing'
  | 'devoicing'
  | 'assimilation'
  | 'final-consonant-deletion'
  | 'initial-consonant-deletion'
  | 'medial-consonant-deletion'
  | 'cluster-reduction'
  | 'weak-syllable-deletion'
  | 'epenthesis';

export interface ProcessInfo {
  id: ProcessId;
  label: string;
  /** Short label for inline chips. */
  short: string;
  description: string;
}

export const PROCESSES: Record<ProcessId, ProcessInfo> = {
  'velar-fronting': { id: 'velar-fronting', label: 'Velar fronting', short: 'Fronting', description: 'Velar /k g ŋ/ produced further forward, e.g. "cat" → [tæt].' },
  'palatal-fronting': { id: 'palatal-fronting', label: 'Palatal fronting', short: 'Palatal fronting', description: '/ʃ ʒ tʃ dʒ/ produced as /s z ts dz/, e.g. "shoe" → [su].' },
  backing: { id: 'backing', label: 'Backing', short: 'Backing', description: 'Front sounds produced as velars, e.g. "top" → [kɑp].' },
  stopping: { id: 'stopping', label: 'Stopping', short: 'Stopping', description: 'Fricatives or affricates produced as stops, e.g. "sun" → [tʌn].' },
  gliding: { id: 'gliding', label: 'Gliding', short: 'Gliding', description: 'Liquids /l ɹ/ produced as glides /w j/, e.g. "rabbit" → [wæbɪt].' },
  vowelization: { id: 'vowelization', label: 'Vowelization', short: 'Vowelization', description: 'Liquid or r-colored vowel produced as a vowel, e.g. "bottle" → [bɑtoʊ], "water" → [wɑtə].' },
  deaffrication: { id: 'deaffrication', label: 'Deaffrication', short: 'Deaffrication', description: 'Affricates produced as fricatives, e.g. "chip" → [ʃɪp].' },
  affrication: { id: 'affrication', label: 'Affrication', short: 'Affrication', description: 'Fricatives produced as affricates, e.g. "shoe" → [tʃu].' },
  labialization: { id: 'labialization', label: 'Labialization (th → f/v)', short: 'Labialization', description: '/θ ð/ produced as /f v/, e.g. "thumb" → [fʌm].' },
  'interdental-lisp': { id: 'interdental-lisp', label: 'Interdental /s z/ (lisp)', short: 'Interdental', description: '/s z/ produced as /θ ð/, e.g. "sun" → [θʌn].' },
  'glottal-replacement': { id: 'glottal-replacement', label: 'Glottal replacement', short: 'Glottal', description: 'A consonant replaced by a glottal stop, e.g. "bottle" → [bɑʔəl].' },
  'prevocalic-voicing': { id: 'prevocalic-voicing', label: 'Prevocalic voicing', short: 'Voicing', description: 'Voiceless consonant voiced before a vowel, e.g. "pig" → [bɪɡ].' },
  'final-devoicing': { id: 'final-devoicing', label: 'Final consonant devoicing', short: 'Final devoicing', description: 'Voiced final consonant made voiceless, e.g. "bed" → [bɛt].' },
  devoicing: { id: 'devoicing', label: 'Devoicing', short: 'Devoicing', description: 'Voiced consonant made voiceless (not word-final).' },
  assimilation: { id: 'assimilation', label: 'Assimilation (consonant harmony)', short: 'Assimilation', description: 'A consonant changed to match another consonant in the word, e.g. "dog" → [ɡɑɡ].' },
  'final-consonant-deletion': { id: 'final-consonant-deletion', label: 'Final consonant deletion', short: 'FCD', description: 'Word-final consonant omitted, e.g. "cup" → [kʌ].' },
  'initial-consonant-deletion': { id: 'initial-consonant-deletion', label: 'Initial consonant deletion', short: 'ICD', description: 'Word-initial consonant omitted, e.g. "cup" → [ʌp].' },
  'medial-consonant-deletion': { id: 'medial-consonant-deletion', label: 'Medial consonant deletion', short: 'Medial deletion', description: 'A consonant inside the word omitted.' },
  'cluster-reduction': { id: 'cluster-reduction', label: 'Cluster reduction', short: 'Cluster red.', description: 'A consonant cluster simplified, e.g. "spoon" → [pun], "stop" → [tɑp].' },
  'weak-syllable-deletion': { id: 'weak-syllable-deletion', label: 'Weak syllable deletion', short: 'WSD', description: 'An unstressed syllable omitted, e.g. "banana" → [nænə].' },
  epenthesis: { id: 'epenthesis', label: 'Epenthesis', short: 'Epenthesis', description: 'A vowel inserted, usually into a cluster, e.g. "blue" → [bəlu].' },
};

export const PROCESS_ORDER: ProcessId[] = [
  'final-consonant-deletion',
  'cluster-reduction',
  'weak-syllable-deletion',
  'initial-consonant-deletion',
  'medial-consonant-deletion',
  'velar-fronting',
  'palatal-fronting',
  'backing',
  'stopping',
  'gliding',
  'vowelization',
  'deaffrication',
  'affrication',
  'labialization',
  'interdental-lisp',
  'glottal-replacement',
  'prevocalic-voicing',
  'final-devoicing',
  'devoicing',
  'assimilation',
  'epenthesis',
];

type Place = 'labial' | 'labiodental' | 'dental' | 'alveolar' | 'postalveolar' | 'palatal' | 'velar' | 'glottal';
type Manner = 'stop' | 'fricative' | 'affricate' | 'nasal' | 'liquid' | 'glide';
interface Features {
  place: Place;
  manner: Manner;
  voiced: boolean;
}

const CONSONANTS: Record<string, Features> = {
  p: { place: 'labial', manner: 'stop', voiced: false },
  b: { place: 'labial', manner: 'stop', voiced: true },
  m: { place: 'labial', manner: 'nasal', voiced: true },
  w: { place: 'labial', manner: 'glide', voiced: true },
  f: { place: 'labiodental', manner: 'fricative', voiced: false },
  v: { place: 'labiodental', manner: 'fricative', voiced: true },
  θ: { place: 'dental', manner: 'fricative', voiced: false },
  ð: { place: 'dental', manner: 'fricative', voiced: true },
  t: { place: 'alveolar', manner: 'stop', voiced: false },
  d: { place: 'alveolar', manner: 'stop', voiced: true },
  n: { place: 'alveolar', manner: 'nasal', voiced: true },
  s: { place: 'alveolar', manner: 'fricative', voiced: false },
  z: { place: 'alveolar', manner: 'fricative', voiced: true },
  ts: { place: 'alveolar', manner: 'affricate', voiced: false },
  dz: { place: 'alveolar', manner: 'affricate', voiced: true },
  l: { place: 'alveolar', manner: 'liquid', voiced: true },
  ɹ: { place: 'postalveolar', manner: 'liquid', voiced: true },
  ʃ: { place: 'postalveolar', manner: 'fricative', voiced: false },
  ʒ: { place: 'postalveolar', manner: 'fricative', voiced: true },
  tʃ: { place: 'postalveolar', manner: 'affricate', voiced: false },
  dʒ: { place: 'postalveolar', manner: 'affricate', voiced: true },
  j: { place: 'palatal', manner: 'glide', voiced: true },
  k: { place: 'velar', manner: 'stop', voiced: false },
  g: { place: 'velar', manner: 'stop', voiced: true },
  ŋ: { place: 'velar', manner: 'nasal', voiced: true },
  x: { place: 'velar', manner: 'fricative', voiced: false },
  h: { place: 'glottal', manner: 'fricative', voiced: false },
};

/** Phonetic features of a (comparable) consonant, or null for vowels/unknown symbols. */
function features(phone: string): Features | null {
  if (phone === 'ʔ') return { place: 'glottal', manner: 'stop', voiced: false };
  if (phone === 'ɾ') return { place: 'alveolar', manner: 'stop', voiced: true };
  return CONSONANTS[comparablePhone(phone)] ?? null;
}

const RHOTIC_OR_DARK = new Set(['ɚ', 'əl']);

export function isConsonantPhone(phone: string): boolean {
  return features(phone) !== null;
}

export function isVowelPhone(phone: string): boolean {
  return !isConsonantPhone(phone) && /[aeiouæɑɒɔəɚɛɜɝɪʊʌɐᵻyøœɘɵɤ]/u.test(phone);
}

const OBSTRUENT: Manner[] = ['stop', 'fricative', 'affricate'];
const PLACE_RANK: Record<Place, number> = {
  labial: 0,
  labiodental: 1,
  dental: 2,
  alveolar: 3,
  postalveolar: 4,
  palatal: 5,
  velar: 6,
  glottal: 7,
};

/**
 * Function words are often reduced in connected speech by every speaker ("and" → [ən]),
 * so they are left out of process analysis, as in most single-word/connected-speech
 * phonological analyses.
 */
const FUNCTION_WORDS = new Set(
  (
    'a an the and or but so if of to in on at by for from with as is am are was were be been ' +
    'it its he him his she her they them their we us our you your i me my this that these those ' +
    'do does did has have had not no can will would could should just then than there here what ' +
    'um uh oh ah hmm yeah okay ok'
  ).split(' ')
);

export function isContentWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/'.*$/, '');
  return w.length > 0 && !FUNCTION_WORDS.has(w);
}

export interface ProcessOccurrence {
  process: ProcessId;
  /** Expected sound(s) and what was heard instead ('' = nothing). */
  from: string;
  to: string;
}

/** Classifies one substitution (expected consonant → heard sound). */
export function classifySubstitution(
  expected: string,
  heard: string,
  ctx: { isFinal: boolean; beforeVowel: boolean; otherConsonants: string[] }
): ProcessId[] {
  if (samePhone(expected, heard)) return [];
  const e = comparablePhone(expected);
  const E = features(expected);
  const heardIsVowel = isVowelPhone(heard);

  // Liquids / r-colored vowels produced as plain vowels
  if ((E?.manner === 'liquid' || RHOTIC_OR_DARK.has(e)) && heardIsVowel && !RHOTIC_OR_DARK.has(comparablePhone(heard))) {
    return ['vowelization'];
  }
  if (!E) return []; // vowel changes are not phonological processes in this analysis
  if (heard === 'ʔ') return ['glottal-replacement'];
  const H = features(heard);
  if (!H) return [];

  const out: ProcessId[] = [];
  // Manner
  if (E.manner === 'liquid' && H.manner === 'glide') out.push('gliding');
  else if ((E.manner === 'fricative' || E.manner === 'affricate') && E.place !== 'glottal' && H.manner === 'stop') out.push('stopping');
  else if (E.manner === 'affricate' && H.manner === 'fricative') out.push('deaffrication');
  else if (E.manner === 'fricative' && E.place !== 'glottal' && H.manner === 'affricate') out.push('affrication');

  // Place
  const harmony = ctx.otherConsonants.some((c) => samePhone(c, heard));
  if (E.place === 'velar' && PLACE_RANK[H.place] < PLACE_RANK.velar && H.place !== 'labial') out.push('velar-fronting');
  else if (E.place === 'postalveolar' && E.manner !== 'liquid' && H.place === 'alveolar' && OBSTRUENT.includes(H.manner))
    out.push('palatal-fronting');
  else if (E.place === 'dental' && H.place === 'labiodental') out.push('labialization');
  else if (e === 's' || e === 'z') {
    if (H.place === 'dental') out.push('interdental-lisp');
  }
  if (H.place === 'velar' && PLACE_RANK[E.place] < PLACE_RANK.velar && H.manner !== 'glide' && E.manner !== 'liquid') {
    out.push(harmony ? 'assimilation' : 'backing');
  }

  // Voicing (only when place and manner are otherwise kept)
  if (out.length === 0 && E.place === H.place && E.manner === H.manner && E.voiced !== H.voiced && OBSTRUENT.includes(E.manner)) {
    if (E.voiced) out.push(ctx.isFinal ? 'final-devoicing' : 'devoicing');
    else if (ctx.beforeVowel) out.push('prevocalic-voicing');
  }

  if (out.length === 0 && harmony && E.place !== H.place) out.push('assimilation');
  return out;
}

/** Processes found in one word's comparison. */
export function processesInWord(row: WordSoundComparison): ProcessOccurrence[] {
  const exp = row.expected;
  if (exp.length === 0 || !isContentWord(row.word)) return [];
  const isC = exp.map(isConsonantPhone);
  const missing = new Set(row.sequence.filter((s) => s.status === 'missing').map((s) => s.ei!));
  // A non-liquid consonant "heard" as a vowel is effectively omitted ("spoon" → [əpun])
  for (const s of row.sequence) {
    if (
      s.status === 'different' &&
      s.ei !== undefined &&
      isC[s.ei] &&
      features(exp[s.ei])?.manner !== 'liquid' &&
      isVowelPhone(s.p)
    ) {
      missing.add(s.ei);
    }
  }
  // Consonants of a deleted syllable belong to weak syllable deletion, not consonant deletion
  // ("banana" → [nænə] loses /bə/).
  const vowelIdx = exp.map((_, k) => (isC[k] ? -1 : k)).filter((k) => k >= 0);
  const syllableLost = new Set<number>();
  if (vowelIdx.length >= 2) {
    for (const v of vowelIdx) {
      if (!missing.has(v)) continue;
      for (let k = v - 1; k >= 0 && isC[k] && missing.has(k); k--) syllableLost.add(k);
    }
  }
  const out: ProcessOccurrence[] = [];

  // Substitutions
  for (const item of row.sequence) {
    if (item.status !== 'different' || item.ei === undefined || missing.has(item.ei)) continue;
    const i = item.ei;
    // "blue" → [bəlu]: the recognizer's [əl] for /l/ after a consonant is an inserted vowel
    if (comparablePhone(exp[i]) === 'l' && comparablePhone(item.p) === 'əl' && i > 0 && isC[i - 1]) {
      out.push({ process: 'epenthesis', from: '', to: 'ə' });
      continue;
    }
    const ids = classifySubstitution(exp[i], item.p, {
      isFinal: i === exp.length - 1,
      beforeVowel: i + 1 < exp.length && !isC[i + 1],
      otherConsonants: exp.filter((_, k) => k !== i && isC[k]),
    });
    for (const id of ids) out.push({ process: id, from: exp[i], to: item.p });
  }

  // Consonant deletions
  const clusterOf = (i: number): [number, number] => {
    let a = i;
    let b = i;
    while (a > 0 && isC[a - 1]) a--;
    while (b < exp.length - 1 && isC[b + 1]) b++;
    return [a, b];
  };
  const handledClusters = new Set<string>();
  for (let i = 0; i < exp.length; i++) {
    if (!missing.has(i) || !isC[i] || syllableLost.has(i)) continue;
    const [a, b] = clusterOf(i);
    if (b > a) {
      const members = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      const kept = members.filter((k) => !missing.has(k));
      if (kept.length > 0) {
        const key = `${a}-${b}`;
        if (!handledClusters.has(key)) {
          handledClusters.add(key);
          out.push({
            process: 'cluster-reduction',
            from: members.map((k) => exp[k]).join(''),
            to: kept.map((k) => exp[k]).join(''),
          });
        }
        continue;
      }
    }
    if (b === exp.length - 1 && exp.length > 1) out.push({ process: 'final-consonant-deletion', from: exp[i], to: '' });
    else if (a === 0 && exp.length > 1) out.push({ process: 'initial-consonant-deletion', from: exp[i], to: '' });
    else if (exp.length > 1) out.push({ process: 'medial-consonant-deletion', from: exp[i], to: '' });
  }

  // Weak syllable deletion: a vowel missing from a word of 2+ syllables
  if (vowelIdx.length >= 2) {
    const lost = vowelIdx.filter((k) => missing.has(k));
    if (lost.length > 0 && lost.length < vowelIdx.length) {
      const from = exp.filter((_, k) => missing.has(k) && (!isC[k] || syllableLost.has(k))).join('');
      out.push({ process: 'weak-syllable-deletion', from, to: '' });
    }
  }

  // Epenthesis: an extra vowel between two produced consonants
  const seq = row.sequence.filter((s) => s.status !== 'missing');
  for (let k = 1; k < seq.length - 1; k++) {
    if (seq[k].status === 'extra' && isVowelPhone(seq[k].p) && isConsonantPhone(seq[k - 1].p) && isConsonantPhone(seq[k + 1].p)) {
      out.push({ process: 'epenthesis', from: '', to: seq[k].p });
    }
  }
  return out;
}

/** How many chances the word gives for each process (for percentage of occurrence). */
export function opportunitiesInWord(row: WordSoundComparison): Partial<Record<ProcessId, number>> {
  const exp = row.expected;
  const opp: Partial<Record<ProcessId, number>> = {};
  if (exp.length === 0 || !isContentWord(row.word)) return opp;
  const add = (id: ProcessId, n = 1) => {
    if (n > 0) opp[id] = (opp[id] ?? 0) + n;
  };
  const isC = exp.map(isConsonantPhone);
  const feats = exp.map((p) => features(p));
  exp.forEach((p, i) => {
    const f = feats[i];
    const c = comparablePhone(p);
    if (RHOTIC_OR_DARK.has(c)) add('vowelization');
    if (!f) return;
    if (f.place === 'velar') add('velar-fronting');
    if (f.place === 'postalveolar' && f.manner !== 'liquid') add('palatal-fronting');
    if ((f.manner === 'fricative' || f.manner === 'affricate') && f.place !== 'glottal') add('stopping');
    if (f.manner === 'liquid') {
      add('gliding');
      if (i > 0 && !isC[i - 1]) add('vowelization');
    }
    if (f.manner === 'affricate') add('deaffrication');
    if (f.manner === 'fricative' && f.place !== 'glottal') add('affrication');
    if (f.place === 'dental') add('labialization');
    if (c === 's' || c === 'z') add('interdental-lisp');
    if (['alveolar', 'dental', 'postalveolar', 'labial', 'labiodental'].includes(f.place) && f.manner !== 'liquid' && f.manner !== 'glide')
      add('backing');
    if (c !== 'h') add('glottal-replacement');
    if (OBSTRUENT.includes(f.manner)) {
      if (f.voiced) add(i === exp.length - 1 ? 'final-devoicing' : 'devoicing');
      else if (i + 1 < exp.length && !isC[i + 1]) add('prevocalic-voicing');
    }
  });
  if (exp.length > 1 && isC[exp.length - 1]) add('final-consonant-deletion');
  if (exp.length > 1 && isC[0] && !isC[1]) add('initial-consonant-deletion');
  for (let i = 1; i < exp.length - 1; i++) if (isC[i] && !isC[i - 1] && !isC[i + 1]) add('medial-consonant-deletion');
  for (let i = 0; i < exp.length; i++) {
    if (isC[i] && i + 1 < exp.length && isC[i + 1] && (i === 0 || !isC[i - 1])) {
      add('cluster-reduction');
      add('epenthesis');
    }
  }
  if (exp.filter((_, k) => !isC[k]).length >= 2) add('weak-syllable-deletion');
  return opp;
}

export interface ProcessSummaryRow {
  process: ProcessId;
  occurrences: number;
  opportunities: number;
  /** Percentage of occurrence (0–100), null when there were no opportunities. */
  percent: number | null;
  examples: Array<{ word: string; expected: string; heard: string; from: string; to: string }>;
}

/** Totals across many words (e.g. all child utterances). Only processes that occurred are returned. */
export function summarizeProcesses(rows: WordSoundComparison[], maxExamples = 4): ProcessSummaryRow[] {
  const occ = new Map<ProcessId, ProcessSummaryRow>();
  const opp: Partial<Record<ProcessId, number>> = {};
  for (const row of rows) {
    for (const [id, n] of Object.entries(opportunitiesInWord(row)) as Array<[ProcessId, number]>) {
      opp[id] = (opp[id] ?? 0) + n;
    }
    for (const o of processesInWord(row)) {
      const entry =
        occ.get(o.process) ?? { process: o.process, occurrences: 0, opportunities: 0, percent: null, examples: [] };
      entry.occurrences += 1;
      if (entry.examples.length < maxExamples) {
        entry.examples.push({
          word: row.word.replace(/[.,!?;:]+$/, ''),
          expected: row.expected.join(''),
          heard: row.sequence.filter((s) => s.status !== 'missing').map((s) => s.p).join(''),
          from: o.from,
          to: o.to,
        });
      }
      occ.set(o.process, entry);
    }
  }
  return PROCESS_ORDER.filter((id) => occ.has(id)).map((id) => {
    const entry = occ.get(id)!;
    const opportunities = Math.max(opp[id] ?? 0, entry.occurrences);
    return {
      ...entry,
      opportunities,
      percent: opportunities > 0 ? Math.round((entry.occurrences / opportunities) * 100) : null,
    };
  });
}
