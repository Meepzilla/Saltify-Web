import type {
  SiDistribution,
  SpeakerAliases,
  SpeakerMetrics,
  TranscriptMetrics,
  UtteranceLine,
} from '../types/saltify';
import { parseUtteranceClauseCoding } from './clauseAnalysis';
import { parseUtteranceLines } from './transcriptFormat';

const BOUND_MORPHEME_RE = /\/(?:s|z|ed|3s|ing|n't|'t|'s|'m|'re|'ll|'d|'ve)\b/gi;
const ERROR_CODE_RE = /\[(?:EW|EO|EP|EU|E[A-Z]*)(?::[^\]]+)?\]/gi;
const OMISSION_RE = /(?:\/\*[a-z0-9']+|\*[a-zA-Z]+|[a-zA-Z]+\*)/g;
/** SALT unintelligible markers: X (word), XX (segment), XXX (utterance). Uppercase only. */
const UNINTELLIGIBLE_TOKEN_RE = /^X{1,3}$/;
const UNINTELLIGIBLE_IN_TEXT_RE = /(?:^|\s)X{1,3}(?=[\s.,!?>^]|$)/;
/** SALT comments, e.g. {laughs} or {points to picture}, are not spoken words. */
const COMMENT_RE = /\{[^}]*\}/g;

/**
 * Returns the countable word root for a SALT token, or '' if it is not a countable word.
 * - Root identification: "goed|go" -> "go", "very_very|very" -> "very"
 * - Bound morphemes:     "walk/ed" -> "walk"
 * - Linked words:        "Beauty_and_the_Beast" stays one word
 * - Sound effects:       "%woof_woof" -> "woof_woof"
 */
function wordRoot(tok: string): string {
  let core = tok;
  const bar = core.lastIndexOf('|');
  if (bar !== -1) core = core.slice(bar + 1);
  core = core.split('/')[0].replace(/^%/, '');
  return core.replace(/[^a-zA-Z0-9'_-]/g, '');
}

function createEmptySiDistribution(): SiDistribution {
  return {
    si0: 0,
    si1: 0,
    si2: 0,
    si3Plus: 0,
    siX: 0,
  };
}

function createEmptySpeakerMetrics(speaker: string): SpeakerMetrics {
  return {
    speaker,
    totalUtterances: 0,
    completeIntelligibleUtterances: 0,
    ciWords: 0,
    ciMorphemes: 0,
    allWords: 0,
    totalWords: 0,
    uniqueWords: 0,
    typeTokenRatio: 0,
    mluWords: 0,
    totalMorphemes: 0,
    boundMorphemes: 0,
    mluMorphemes: 0,
    mazeCount: 0,
    mazeWords: 0,
    mazeWordPercent: 0,
    errorCount: 0,
    omissionCount: 0,
    wordsPerMinute: null,
    totalClauses: 0,
    clauseScoredUtterances: 0,
    clauseExcludedUtterances: 0,
    clausalDensity: null,
    complexUtterances: 0,
    complexUtterancePercent: 0,
    siDistribution: createEmptySiDistribution(),
  };
}

function analyzeUtteranceSet(
  label: string,
  utterances: UtteranceLine[],
  durationSeconds: number | null
): SpeakerMetrics {
  const nonEmpty = utterances.filter((u) => u.body.trim().length > 0);
  if (nonEmpty.length === 0) {
    return createEmptySpeakerMetrics(label);
  }

  let completeIntelligible = 0;
  let ciWords = 0;
  let ciMorphemes = 0;
  /** Words outside mazes across ALL utterances (fallback when no C&I utterances). */
  let allWords = 0;
  let allMorphemes = 0;
  let boundMorphemes = 0;
  let mazeCount = 0;
  let mazeWords = 0;
  let errorCount = 0;
  let omissionCount = 0;
  let totalClauses = 0;
  let clauseScoredUtterances = 0;
  let clauseExcludedUtterances = 0;
  let complexUtterances = 0;
  const siDistribution = createEmptySiDistribution();
  const ciVocab = new Set<string>();
  const allVocab = new Set<string>();

  for (const u of nonEmpty) {
    let body = u.body.replace(COMMENT_RE, ' ').trim();

    // Parse clause / SALT Subordination Index coding before stripping brackets
    const clauseCoding = parseUtteranceClauseCoding(body);
    if (clauseCoding.isExcluded) {
      clauseExcludedUtterances += 1;
      siDistribution.siX += 1;
    } else if (clauseCoding.isScored && clauseCoding.clauseCount !== null) {
      const count = clauseCoding.clauseCount;
      clauseScoredUtterances += 1;
      totalClauses += count;
      if (count >= 2) {
        complexUtterances += 1;
      }
      if (count === 0) {
        siDistribution.si0 += 1;
      } else if (count === 1) {
        siDistribution.si1 += 1;
      } else if (count === 2) {
        siDistribution.si2 += 1;
      } else {
        siDistribution.si3Plus += 1;
      }
    }

    // Count errors & omissions on the utterance
    const errorMatches = body.match(ERROR_CODE_RE);
    if (errorMatches) errorCount += errorMatches.length;

    // Extract & count mazes: parenthetical segments like "(I I)" or "(and a)".
    // Adjacent mazes "(um) (I) I" are one maze in SALT, so merge them before counting.
    body = body.replace(/\)\s*\(/g, ' ');
    const mazeMatches = body.match(/\([^)]*\)/g);
    if (mazeMatches) {
      mazeCount += mazeMatches.length;
      for (const m of mazeMatches) {
        const inner = m.slice(1, -1).trim();
        if (inner) {
          mazeWords += inner.split(/\s+/).filter(Boolean).length;
        }
      }
      body = body.replace(/\([^)]*\)/g, ' ');
    }

    // Completeness / intelligibility (SALT: abandoned `>`, interrupted `^`, unintelligible X/XX/XXX)
    const isAbandonedOrUnintelligible =
      /[>^]\s*$/.test(body) || UNINTELLIGIBLE_IN_TEXT_RE.test(body);

    // Remove bracket codes (e.g. [EW:told], [SI-1]) before counting words and morphemes
    const strippedBrackets = body.replace(/\[[^\]]*\]/g, '');

    // Count omitted words/morphemes outside mazes
    const omissionMatches = body.match(OMISSION_RE);
    if (omissionMatches) {
      omissionCount += omissionMatches.length;
    }

    // Count bound morphemes outside mazes
    const boundMatches = strippedBrackets.match(BOUND_MORPHEME_RE);
    const uttBound = boundMatches ? boundMatches.length : 0;
    boundMorphemes += uttBound;

    const tokens = strippedBrackets
      .split(/\s+/)
      .map((t) => t.replace(/^[.,!?;:"'<>^]+|[.,!?;:"'<>^]+$/g, ''))
      .filter(Boolean);

    let uttWords = 0;
    const uttRoots: string[] = [];
    for (const tok of tokens) {
      // Skip omitted words (e.g. "*to" or "*is" were NOT spoken by the child)
      if (tok.startsWith('*') || tok.endsWith('*')) {
        continue;
      }
      // Skip unintelligible markers (X, XX, XXX): not countable words in SALT
      if (UNINTELLIGIBLE_TOKEN_RE.test(tok)) {
        continue;
      }
      const root = wordRoot(tok);
      if (!root) continue;

      uttWords += 1;
      uttRoots.push(root.toLowerCase());
    }

    allWords += uttWords;
    allMorphemes += uttWords + uttBound;
    for (const r of uttRoots) allVocab.add(r);

    // SALT analysis set = Complete & Intelligible *Verbal* utterances. A nonverbal utterance
    // such as "C {nods}." (no words after removing comments/mazes/codes) is not verbal.
    const isCompleteIntelligibleVerbal = !isAbandonedOrUnintelligible && uttWords > 0;
    if (isCompleteIntelligibleVerbal) {
      completeIntelligible += 1;
      ciWords += uttWords;
      ciMorphemes += uttWords + uttBound;
      for (const r of uttRoots) ciVocab.add(r);
    }
  }

  // SALT Standard Measures: MLUw, MLUm, NTW, NDW are based on the C&I Verbal Utts
  // (complete, intelligible, verbal utterances), excluding mazes. Falls back to all
  // utterances only when there are no C&I verbal utterances at all.
  const useCi = completeIntelligible > 0;
  const denomUtterances = useCi ? completeIntelligible : nonEmpty.length;
  const mluWordNumerator = useCi ? ciWords : allWords;
  const mluMorphNumerator = useCi ? ciMorphemes : allMorphemes;
  const totalWords = mluWordNumerator;
  const totalMorphemes = mluMorphNumerator;
  const vocab = useCi ? ciVocab : allVocab;
  // Maze Words as % of Total Words and Words/Minute use ALL utterances (SALT: not C&I-based).
  const totalSpokenWithMazes = allWords + mazeWords;
  const durationMinutes =
    durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : null;
  const clausalDensity =
    clauseScoredUtterances > 0
      ? Number((totalClauses / clauseScoredUtterances).toFixed(2))
      : null;
  const complexUtterancePercent =
    clauseScoredUtterances > 0
      ? Number(((complexUtterances / clauseScoredUtterances) * 100).toFixed(1))
      : 0;

  return {
    speaker: label,
    totalUtterances: nonEmpty.length,
    completeIntelligibleUtterances: completeIntelligible,
    ciWords: mluWordNumerator,
    ciMorphemes: mluMorphNumerator,
    allWords,
    totalWords,
    uniqueWords: vocab.size,
    typeTokenRatio: totalWords > 0 ? Number((vocab.size / totalWords).toFixed(2)) : 0,
    mluWords:
      denomUtterances > 0 ? Number((mluWordNumerator / denomUtterances).toFixed(2)) : 0,
    totalMorphemes,
    boundMorphemes,
    mluMorphemes:
      denomUtterances > 0 ? Number((mluMorphNumerator / denomUtterances).toFixed(2)) : 0,
    mazeCount,
    mazeWords,
    mazeWordPercent:
      totalSpokenWithMazes > 0
        ? Number(((mazeWords / totalSpokenWithMazes) * 100).toFixed(1))
        : 0,
    errorCount,
    omissionCount,
    // SALT Words/Minute: all words produced (including maze words) ÷ elapsed minutes
    wordsPerMinute:
      durationMinutes && totalSpokenWithMazes > 0
        ? Math.round(totalSpokenWithMazes / durationMinutes)
        : null,
    totalClauses,
    clauseScoredUtterances,
    clauseExcludedUtterances,
    clausalDensity,
    complexUtterances,
    complexUtterancePercent,
    siDistribution,
  };
}

/**
 * Computes real-time SALT language sample metrics (MLUm, MLUw, TNW, NDW, TTR,
 * mazes, coded errors, WPM) overall and separately for Child vs Examiner.
 */
export function computeSaltMetrics(
  text: string,
  aliases: SpeakerAliases,
  durationSeconds: number | null = null
): TranscriptMetrics {
  const lines = parseUtteranceLines(text, aliases).filter((l) => l.body.trim().length > 0);
  const s1Lines = lines.filter((l) => l.speakerSlot === 'speaker1');
  const s2Lines = lines.filter((l) => l.speakerSlot === 'speaker2');
  const unlabeled = lines.filter((l) => l.speakerSlot === null);

  const s1Label = aliases.speaker1.trim() || 'C';
  const s2Label = aliases.speaker2.trim() || 'E';

  return {
    overall: analyzeUtteranceSet('All Speakers', lines, durationSeconds),
    speaker1: analyzeUtteranceSet(s1Label, s1Lines, durationSeconds),
    speaker2: analyzeUtteranceSet(s2Label, s2Lines, durationSeconds),
    unlabeledUtterances: unlabeled.length,
    durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
  };
}

export type MetricCalculationKey =
  | 'mluMorphemes'
  | 'mluWords'
  | 'typeTokenRatio'
  | 'totalWords'
  | 'uniqueWords'
  | 'boundMorphemes'
  | 'mazeWordPercent'
  | 'errorAndOmissionCount'
  | 'wordsPerMinute'
  | 'clausalDensity'
  | 'totalClauses'
  | 'clauseScoredUtterances'
  | 'complexUtterancePercent';

export interface MetricCalculationBreakdown {
  key: MetricCalculationKey;
  title: string;
  formula: string;
  calculation: string;
  note: string;
}

/**
 * Generates an exact, human-readable calculation breakdown (formula + live substituted values
 * + clinical SALT rule note) for any speaker metric cell or KPI card.
 */
export function describeMetricCalculation(
  key: MetricCalculationKey,
  stats: SpeakerMetrics,
  durationSeconds: number | null = null
): MetricCalculationBreakdown {
  const usesCiDenom = stats.completeIntelligibleUtterances > 0;
  const denomUtt = usesCiDenom ? stats.completeIntelligibleUtterances : stats.totalUtterances;
  const denomLabel = usesCiDenom ? 'C&I utterances' : 'utterances';
  const totalSpokenWithMazes = stats.allWords + stats.mazeWords;

  switch (key) {
    case 'mluMorphemes':
      return {
        key,
        title: 'MLUm — Mean Length of Utterance (Morphemes)',
        formula: '(Words + Bound Morphemes in C&I Utterances) ÷ C&I Utterances',
        calculation:
          denomUtt > 0
            ? `(${stats.ciWords} words + ${stats.ciMorphemes - stats.ciWords} bound = ${stats.ciMorphemes}) ÷ ${denomUtt} ${denomLabel} = ${stats.mluMorphemes.toFixed(2)}`
            : 'No utterances to compute MLUm yet.',
        note: 'Counts root words plus bound morphemes in Complete & Intelligible utterances only (excludes abandoned >, interrupted ^, and utterances with X/XX/XXX). Mazes (…), comments {…}, bracket codes […] and omitted words (*word) are not counted.',
      };

    case 'mluWords':
      return {
        key,
        title: 'MLUw — Mean Length of Utterance (Words)',
        formula: 'Words in C&I Utterances ÷ C&I Utterances',
        calculation:
          denomUtt > 0
            ? `${stats.ciWords} words ÷ ${denomUtt} ${denomLabel} = ${stats.mluWords.toFixed(2)}`
            : 'No utterances to compute MLUw yet.',
        note: 'Counts spoken words outside mazes in Complete & Intelligible utterances only, divided by the number of those utterances.',
      };

    case 'typeTokenRatio':
      return {
        key,
        title: 'TTR — Type-Token Ratio',
        formula: 'NDW ÷ NTW (C&I verbal utterances)',
        calculation:
          stats.totalWords > 0
            ? `${stats.uniqueWords} unique ÷ ${stats.totalWords} total = ${stats.typeTokenRatio.toFixed(2)}`
            : 'No spoken words to compute TTR yet.',
        note: 'Lexical diversity ratio (0.00–1.00) using case-insensitive word roots from complete & intelligible verbal utterances. Sensitive to sample length; compare samples of similar size.',
      };

    case 'totalWords':
      return {
        key,
        title: 'TNW — Total Number of Words',
        formula: 'Words outside mazes in C&I verbal utterances',
        calculation: `${stats.totalWords} words across ${stats.completeIntelligibleUtterances} C&I verbal utterances (of ${stats.totalUtterances} total)`,
        note: 'SALT NTW: based on complete, intelligible, verbal utterances. Excludes mazes (…), comments {…}, bracketed codes […], omitted words (*word), part words (w*) and unintelligible X/XX/XXX.',
      };

    case 'uniqueWords':
      return {
        key,
        title: 'NDW — Number of Different Words',
        formula: 'Distinct word roots in C&I verbal utterances (case-insensitive)',
        calculation: `${stats.uniqueWords} different word roots out of ${stats.totalWords} words`,
        note: 'SALT NDW: counts different word roots, so walk and walk/ed count once, and goed|go counts as go. Excludes mazes.',
      };

    case 'boundMorphemes':
      return {
        key,
        title: 'Bound Inflectional Morphemes (/m)',
        formula: 'Count of SALT slash morphemes outside mazes',
        calculation: `${stats.boundMorphemes} bound morphemes + ${stats.totalWords} root words = ${stats.totalMorphemes} total morphemes`,
        note: "Counts /s, /z, /ed, /3s, /ing, and contracted suffixes (/n't, /'t, /'s, /'m, /'re, /'ll, /'d, /'ve).",
      };

    case 'mazeWordPercent':
      return {
        key,
        title: 'Mazes & Maze Word Percentage',
        formula: 'Maze Words ÷ (Spoken Words + Maze Words) × 100',
        calculation:
          totalSpokenWithMazes > 0
            ? `${stats.mazeWords} maze words ÷ (${stats.allWords} + ${stats.mazeWords} = ${totalSpokenWithMazes}) × 100 = ${stats.mazeWordPercent}% (${stats.mazeCount} ${stats.mazeCount === 1 ? 'maze' : 'mazes'})`
            : '0 mazes recorded.',
        note: 'SALT Maze Words as % of Total Words, across all utterances. Mazes are filled pauses, false starts, repetitions and reformulations in (…); adjacent mazes count as one.',
      };

    case 'errorAndOmissionCount':
      return {
        key,
        title: 'SALT Error & Omission Codes',
        formula: 'Bracketed Error Codes + Omitted Words & Morphemes',
        calculation: `${stats.errorCount} error codes + ${stats.omissionCount} omissions = ${stats.errorCount + stats.omissionCount} total codes`,
        note: 'Counts [EW], [EO], [EP], [EU] tags plus omitted words (*word) and omitted morphemes (/*3s, /*ed, /*s). Clause [SI-*] tags are not counted as errors.',
      };

    case 'wordsPerMinute': {
      const validDuration = durationSeconds && durationSeconds > 0 ? durationSeconds : null;
      const mins = validDuration ? validDuration / 60 : null;
      return {
        key,
        title: 'WPM — Speaking Rate (Words Per Minute)',
        formula: 'All Words Including Mazes ÷ (Audio Duration in Seconds ÷ 60)',
        calculation:
          validDuration && mins && stats.wordsPerMinute !== null
            ? `${stats.allWords + stats.mazeWords} words ÷ (${validDuration.toFixed(1)}s ÷ 60 = ${mins.toFixed(2)} min) = ${stats.wordsPerMinute} WPM`
            : 'Requires audio duration and spoken words to calculate WPM.',
        note: 'SALT Words/Minute: all words produced in all utterances, including maze words, divided by the audio length in minutes.',
      };
    }

    case 'clausalDensity': {
      const { si0, si1, si2, si3Plus, siX } = stats.siDistribution;
      return {
        key,
        title: 'Clausal Density (SALT Subordination Index)',
        formula: 'Total Clauses ÷ Clause-Scored Utterances',
        calculation:
          stats.clausalDensity !== null
            ? `${stats.totalClauses} clauses ÷ ${stats.clauseScoredUtterances} scored utterances = ${stats.clausalDensity.toFixed(2)} (SI-0: ${si0}, SI-1: ${si1}, SI-2: ${si2}, SI-3+: ${si3Plus}${siX > 0 ? `, ${siX} excluded [SI-X]` : ''})`
            : 'No clause-scored utterances yet — open Mark Clauses to code [SI-0..N] or inline clauses.',
        note: 'Unmarked utterances and [SI-X] excluded utterances are omitted from both numerator and denominator per SALT SI conventions.',
      };
    }

    case 'totalClauses':
      return {
        key,
        title: 'Total Clauses & Scored Utterances',
        formula: 'Sum of clause counts across all scored utterances',
        calculation:
          stats.clauseScoredUtterances > 0 || stats.clauseExcludedUtterances > 0
            ? `${stats.totalClauses} total clauses across ${stats.clauseScoredUtterances} scored of ${stats.totalUtterances} utterances${stats.clauseExcludedUtterances > 0 ? ` (${stats.clauseExcludedUtterances} excluded [SI-X])` : ''}`
            : 'No utterances have been marked for clauses yet.',
        note: 'Uses explicit [SI-N] when present, or falls back to inline clause markers ([MC], [SC], [RC], [AC], [NC], [CL]) without double-counting.',
      };

    case 'clauseScoredUtterances':
      return {
        key,
        title: 'Clause-Scored Utterances (Denominator)',
        formula: 'Count of utterances with [SI-0..N] or inline clause markers (excluding [SI-X])',
        calculation: `${stats.clauseScoredUtterances} scored out of ${stats.totalUtterances} total utterances${stats.clauseExcludedUtterances > 0 ? ` · ${stats.clauseExcludedUtterances} excluded [SI-X]` : ''}${stats.totalUtterances - stats.clauseScoredUtterances - stats.clauseExcludedUtterances > 0 ? ` · ${stats.totalUtterances - stats.clauseScoredUtterances - stats.clauseExcludedUtterances} unmarked` : ''}`,
        note: 'Only scored utterances form the Clausal Density denominator; [SI-X] (abandoned, unintelligible, elliptical) and unmarked lines are excluded.',
      };

    case 'complexUtterancePercent':
      return {
        key,
        title: 'Complex Utterances (2+ Clauses)',
        formula: 'Utterances with ≥ 2 Clauses ÷ Scored Utterances × 100',
        calculation:
          stats.clauseScoredUtterances > 0
            ? `${stats.complexUtterances} multi-clause utterances ÷ ${stats.clauseScoredUtterances} scored × 100 = ${stats.complexUtterancePercent}%`
            : 'No clause-scored utterances yet.',
        note: 'Percentage of scored utterances coded [SI-2], [SI-3], or higher (or containing 2+ inline clause markers).',
      };
  }
}
