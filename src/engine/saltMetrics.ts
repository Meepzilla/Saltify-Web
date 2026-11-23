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
    let body = u.body.trim();

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

    // Extract & count mazes: parenthetical segments like "(I I)" or "(and a)"
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
      /[>^]\s*$/.test(body) || /\bX{2,}\b/i.test(body);
    if (!isAbandonedOrUnintelligible) {
      completeIntelligible += 1;
    }

    // Count omitted words/morphemes outside mazes
    const omissionMatches = body.match(OMISSION_RE);
    if (omissionMatches) {
      omissionCount += omissionMatches.length;
    }

    // Count bound morphemes outside mazes
    const boundMatches = body.match(BOUND_MORPHEME_RE);
    const uttBound = boundMatches ? boundMatches.length : 0;
    boundMorphemes += uttBound;

    // Remove bracket codes for word counting while keeping spoken root words
    const strippedBrackets = body.replace(/\[[^\]]*\]/g, '');
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
      // Extract root word before any SALT slash bound morpheme (e.g. "walk/ed" -> "walk")
      const root = tok.split('/')[0].replace(/[^a-zA-Z0-9'-]/g, '');
      if (!root) continue;

      uttWords += 1;
      vocab.add(root.toLowerCase());
    }

    totalWords += uttWords;
    totalMorphemes += uttWords + uttBound;
  }

  const denomUtterances = completeIntelligible > 0 ? completeIntelligible : nonEmpty.length;
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
    totalWords,
    uniqueWords: vocab.size,
    typeTokenRatio: totalWords > 0 ? Number((vocab.size / totalWords).toFixed(2)) : 0,
    mluWords: denomUtterances > 0 ? Number((totalWords / denomUtterances).toFixed(2)) : 0,
    totalMorphemes,
    boundMorphemes,
    mluMorphemes:
      denomUtterances > 0 ? Number((totalMorphemes / denomUtterances).toFixed(2)) : 0,
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
  };
}
