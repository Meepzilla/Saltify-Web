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
  let totalWords = 0;
  let totalMorphemes = 0;
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
  const vocab = new Set<string>();

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

    // Check completeness / intelligibility (SALT: abandoned `>`, interrupted `^`, unintelligible `XXX`/`XX`)
    const isAbandonedOrUnintelligible =
      /[>^]\s*$/.test(body) || UNINTELLIGIBLE_IN_TEXT_RE.test(body);
    if (!isAbandonedOrUnintelligible) {
      completeIntelligible += 1;
    }

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
    for (const tok of tokens) {
      // Skip omitted words (e.g. "*to" or "*is" were NOT spoken by the child)
      if (tok.startsWith('*') || tok.endsWith('*')) {
        continue;
      }
      // Skip unintelligible markers (X, XX, XXX): not countable words in SALT
      if (UNINTELLIGIBLE_TOKEN_RE.test(tok)) {
        continue;
      }
      // Extract root word before any SALT slash bound morpheme (e.g. "walk/ed" -> "walk")
      const root = tok.split('/')[0].replace(/[^a-zA-Z0-9'-]/g, '');
      if (!root) continue;

      uttWords += 1;
      vocab.add(root.toLowerCase());
    }

    totalWords += uttWords;
    totalMorphemes += uttWords + uttBound;
    if (!isAbandonedOrUnintelligible) {
      ciWords += uttWords;
      ciMorphemes += uttWords + uttBound;
    }
  }

  // SALT MLU: numerator AND denominator use complete & intelligible utterances only.
  // (Falls back to all utterances only when none are complete & intelligible.)
  const useCi = completeIntelligible > 0;
  const denomUtterances = useCi ? completeIntelligible : nonEmpty.length;
  const mluWordNumerator = useCi ? ciWords : totalWords;
  const mluMorphNumerator = useCi ? ciMorphemes : totalMorphemes;
  const totalSpokenWithMazes = totalWords + mazeWords;
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
    wordsPerMinute:
      durationMinutes && totalWords > 0
        ? Math.round(totalWords / durationMinutes)
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
  const totalSpokenWithMazes = stats.totalWords + stats.mazeWords;

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
        formula: 'Unique Root Words (NDW) ÷ Total Spoken Words (TNW)',
        calculation:
          stats.totalWords > 0
            ? `${stats.uniqueWords} unique ÷ ${stats.totalWords} total = ${stats.typeTokenRatio.toFixed(2)}`
            : 'No spoken words to compute TTR yet.',
        note: 'Lexical diversity ratio (0.00–1.00) using case-insensitive root words before bound morpheme slashes.',
      };

    case 'totalWords':
      return {
        key,
        title: 'TNW — Total Number of Words',
        formula: 'Count of spoken root words outside mazes',
        calculation:
          stats.mazeWords > 0
            ? `${stats.totalWords} spoken words across ${stats.totalUtterances} utterances (${stats.mazeWords} maze words excluded)`
            : `${stats.totalWords} spoken words across ${stats.totalUtterances} utterances`,
        note: 'Counts words in all utterances. Excludes mazes (…), comments {…}, bracketed SALT codes […], omitted words (*word), and unintelligible X/XX/XXX.',
      };

    case 'uniqueWords':
      return {
        key,
        title: 'NDW — Number of Different Words',
        formula: 'Count of distinct spoken root words (case-insensitive)',
        calculation: `${stats.uniqueWords} unique root words out of ${stats.totalWords} total spoken words`,
        note: 'Bound morpheme inflections sharing a root (e.g., walk and walk/ed) count as 1 unique root word.',
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
            ? `${stats.mazeWords} maze words ÷ (${stats.totalWords} + ${stats.mazeWords} = ${totalSpokenWithMazes}) × 100 = ${stats.mazeWordPercent}% (${stats.mazeCount} ${stats.mazeCount === 1 ? 'maze' : 'mazes'})`
            : '0 mazes recorded.',
        note: 'Counts parenthetical fillers, repetitions, and revisions enclosed in (…).',
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
        formula: 'Total Spoken Words ÷ (Audio Duration in Seconds ÷ 60)',
        calculation:
          validDuration && mins && stats.wordsPerMinute !== null
            ? `${stats.totalWords} words ÷ (${validDuration.toFixed(1)}s ÷ 60 = ${mins.toFixed(2)} min) = ${stats.wordsPerMinute} WPM`
            : 'Requires audio duration and spoken words to calculate WPM.',
        note: 'Uses total spoken words outside mazes divided by total session audio length in minutes.',
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
