import type { SaltMetrics, SpeakerAliases } from '../../types/session';

export type MetricsSpeakerFilter = 'all' | 'speaker1' | 'speaker2';

/**
 * Strip leading [m:ss] timestamp and optional speaker prefix from a line.
 */
function parseUtteranceLine(
  rawLine: string,
  aliases: SpeakerAliases
): { speaker: 'speaker1' | 'speaker2' | 'unknown'; body: string } {
  let body = rawLine.trim();
  body = body.replace(/^\[\d+:\d+\]\s*/, '');

  const s1Candidates = Array.from(new Set([aliases.speaker1, 'C', 'Speaker 1', 'Child'].filter(Boolean)));
  const s2Candidates = Array.from(new Set([aliases.speaker2, 'E', 'Speaker 2', 'Examiner'].filter(Boolean)));

  for (const label of s1Candidates) {
    if (body.startsWith(`${label} `)) {
      return { speaker: 'speaker1', body: body.slice(label.length).trim() };
    }
  }
  for (const label of s2Candidates) {
    if (body.startsWith(`${label} `)) {
      return { speaker: 'speaker2', body: body.slice(label.length).trim() };
    }
  }
  return { speaker: 'unknown', body };
}

/**
 * Compute standard clinical SALT language sample metrics (Utterances, TNW, NDW, TTR,
 * MLU-w, MLU-m, Mazes, and Error Codes) directly in the browser.
 */
export function computeSaltMetrics(
  text: string,
  aliases: SpeakerAliases,
  filter: MetricsSpeakerFilter = 'all'
): SaltMetrics {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('+') && !l.startsWith('$') && !l.startsWith('- ') && !l.startsWith(';'));

  let totalUtterances = 0;
  let totalWords = 0;
  let totalMorphemes = 0;
  let mazeCount = 0;
  let errorCodeCount = 0;
  const uniqueWordSet = new Set<string>();

  for (const rawLine of lines) {
    const parsed = parseUtteranceLine(rawLine, aliases);
    if (filter !== 'all' && parsed.speaker !== filter) {
      continue;
    }

    let body = parsed.body;
    if (!body) continue;

    // Count mazes "(...)" and strip them before computing main-body TNW/NDW/MLU (SALT convention)
    const mazeMatches = body.match(/\([^)]*\)/g);
    if (mazeMatches) {
      mazeCount += mazeMatches.length;
      body = body.replace(/\([^)]*\)/g, ' ');
    }

    // Count bracketed SALT error codes and omitted morphemes (*3s, *ed, etc.)
    const bracketErrors = body.match(/\[[A-Z]{2,3}(?::[^\]]+)?\]/g);
    if (bracketErrors) {
      errorCodeCount += bracketErrors.length;
    }
    const omittedMarkers = body.match(/\/\*[a-z0-9']+|\*[A-Za-z]+|[A-Za-z]+\*/g);
    if (omittedMarkers) {
      errorCodeCount += omittedMarkers.length;
    }

    const tokens = body.split(/\s+/).filter(Boolean);
    let utteranceWordCount = 0;

    for (const rawToken of tokens) {
      // Skip standalone utterance error codes like [EU] or unintelligible XXX
      if (/^\[[^\]]+\]$/.test(rawToken)) continue;

      // Strip attached bracket codes for root word & morpheme counting
      const withoutBrackets = rawToken.replace(/\[[^\]]+\]/g, '');
      // Strip trailing punctuation
      const cleaned = withoutBrackets.replace(/^[.,?!;:"“”‘’]+|[.,?!;:"“”‘’]+$/g, '');
      if (!cleaned) continue;

      // Skip omitted word markers (*the or the*) from produced words
      if (cleaned.startsWith('*') || cleaned.endsWith('*')) continue;

      // Count bound morphemes marked with "/" (excluding omitted morphemes "/*3s")
      const parts = cleaned.split('/');
      const rootWord = parts[0].toLowerCase().replace(/[^a-z'-]/g, '');
      if (!rootWord || rootWord === 'xxx' || rootWord === 'xx') continue;

      utteranceWordCount += 1;
      totalWords += 1;
      uniqueWordSet.add(rootWord);

      // 1 morpheme for the root + 1 for each non-omitted bound morpheme suffix
      let tokenMorphemes = 1;
      for (let p = 1; p < parts.length; p++) {
        const suffix = parts[p];
        if (suffix && !suffix.startsWith('*')) {
          tokenMorphemes += 1;
        }
      }
      totalMorphemes += tokenMorphemes;
    }

    if (utteranceWordCount > 0) {
      totalUtterances += 1;
    }
  }

  const uniqueWords = uniqueWordSet.size;
  const typeTokenRatio = totalWords > 0 ? uniqueWords / totalWords : 0;
  const mluWords = totalUtterances > 0 ? totalWords / totalUtterances : 0;
  const mluMorphemes = totalUtterances > 0 ? totalMorphemes / totalUtterances : 0;

  return {
    totalUtterances,
    totalWords,
    uniqueWords,
    typeTokenRatio,
    mluWords,
    mluMorphemes,
    totalMorphemes,
    mazeCount,
    errorCodeCount,
  };
}
