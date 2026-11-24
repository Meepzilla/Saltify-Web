import type { ClientInfo, SpeakerAliases, UtteranceLine } from '../types/saltify';

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDurationPadded(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function parseTimestampToSeconds(timestamp: string): number | null {
  const clean = timestamp.replace(/[[\]]/g, '').trim();
  const match = clean.match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/** SALT filler words that are always coded as mazes. */
// SALT filled-pause words: AH, EH, ER, HM, HMM, UH, UM, MM (plus common Whisper spellings).
const FILLER_WORDS = new Set(['um', 'uh', 'uhm', 'umm', 'uhh', 'er', 'erm', 'ah', 'eh', 'hmm', 'hm', 'mm']);

/**
 * Short function words whose immediate repetition ("I I want", "the the dog") is a
 * disfluency in SALT and is coded as a maze: "(I) I want". Content words are left alone
 * because repeating them can be intentional ("very very big", "no no").
 */
const REPEATABLE_FUNCTION_WORDS = new Set([
  'i', 'a', 'an', 'the', 'and', 'but', 'so', 'or', 'he', 'she', 'it', 'we', 'they', 'you',
  'my', 'his', 'her', 'their', 'our', 'your', 'to', 'in', 'on', 'at', 'of', 'with', 'is',
  'was', 'are', 'that', 'this', 'there', 'then', 'me', 'him', 'them', 'if', 'when', 'because',
]);

/** Abbreviations that end in "." but do not end a sentence. */
const NON_TERMINAL_ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|e\.g|i\.e)\.$/i;

function normalizeWord(token: string): string {
  return token.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

/**
 * Converts Whisper disfluencies into SALT mazes:
 * - fillers: "Um, I want, uh, the ball." -> "(Um) I want (uh) the ball."
 * - repeated function words: "I, I want" -> "(I) I want"
 * Adjacent maze words merge into one maze: "(Um I) I want".
 * Text already containing parentheses (hand-coded) is returned unchanged.
 */
export function applyAutoMazes(sentence: string): string {
  if (!sentence.trim() || sentence.includes('(')) return sentence;
  const tokens = sentence.split(/\s+/).filter(Boolean);
  const isMaze = tokens.map(() => false);

  for (let i = 0; i < tokens.length; i++) {
    const w = normalizeWord(tokens[i]);
    if (!w) continue;
    if (FILLER_WORDS.has(w)) {
      isMaze[i] = true;
      continue;
    }
    const next = i + 1 < tokens.length ? normalizeWord(tokens[i + 1]) : '';
    if (next && next === w && REPEATABLE_FUNCTION_WORDS.has(w)) {
      isMaze[i] = true;
    }
  }

  if (!isMaze.some(Boolean)) return sentence;

  const out: string[] = [];
  let group: string[] = [];
  let groupTrailing = '';
  const flush = () => {
    if (group.length > 0) {
      out.push(`(${group.join(' ')})`);
      group = [];
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isMaze[i]) {
      // Drop commas around maze words; keep sentence-final punctuation for the utterance
      const terminal = /[.!?]+$/.exec(tok)?.[0] ?? '';
      group.push(tok.replace(/[,;:.!?]+$/, ''));
      groupTrailing = terminal;
      if (i === tokens.length - 1) {
        flush();
        if (groupTrailing && out.length > 0) out[out.length - 1] += groupTrailing;
      }
      continue;
    }
    flush();
    groupTrailing = '';
    out.push(tok);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Splits text into sentences on . ! ? without breaking after abbreviations like "Mr." or "Dr.".
 */
export function splitIntoUtterances(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    if (/[.!?]["')\]]*$/.test(word) && !NON_TERMINAL_ABBREVIATIONS.test(word)) {
      sentences.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) sentences.push(current.join(' '));
  return sentences;
}

/**
 * Formats Whisper segments into Saltify's standard `[M:SS] utterance` line format,
 * matching diarizationAndTranscription.formatTranscriptionWithTimestamps().
 * Splits multi-sentence segments into utterances and codes fillers/repetitions as SALT mazes.
 */
export function formatWhisperChunks(
  chunks: Array<{ timestamp: [number, number | null]; text: string }>
): string {
  const lines: string[] = [];

  for (const chunk of chunks) {
    const startSec = chunk.timestamp?.[0] ?? 0;
    const cleaned = chunk.text
      .replace(/\.\.\./g, '')
      .replace(/`/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) continue;

    const ts = formatTimestamp(startSec);
    for (const rawSentence of splitIntoUtterances(cleaned)) {
      // SALT: periods are not legal word characters, so "Mr." -> "Mr"
      const sentence = rawSentence.replace(
        /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt)\.(?=\s|$)/g,
        (m, abbr: string, offset: number, full: string) =>
          offset + m.length >= full.length ? `${abbr}.` : abbr
      );
      const coded = applyAutoMazes(sentence.trim());
      // Skip utterances that are only fillers, e.g. "(Um.)" — not a countable utterance
      if (!coded || /^\([^)]*\)[.!?]*$/.test(coded)) continue;
      lines.push(`[${ts}] ${coded}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parses a transcript into structured utterance lines with timestamps & speaker labels.
 */
export function parseUtteranceLines(
  text: string,
  aliases: SpeakerAliases
): UtteranceLine[] {
  const rawLines = text.split(/\r?\n/);
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  const s1Candidates = [...new Set([s1, 'Speaker 1', 'C'])].sort((a, b) => b.length - a.length);
  const s2Candidates = [...new Set([s2, 'Speaker 2', 'E'])].sort((a, b) => b.length - a.length);

  return rawLines.map((raw, index) => {
    let remaining = raw.trim();
    let timestampStr: string | null = null;
    let timestampSec: number | null = null;
    let speaker: string | null = null;
    let speakerSlot: 'speaker1' | 'speaker2' | null = null;

    const tsMatch = remaining.match(/^\[(\d+:\d{2})\]\s*/);
    if (tsMatch) {
      timestampStr = tsMatch[1];
      timestampSec = parseTimestampToSeconds(tsMatch[1]);
      remaining = remaining.slice(tsMatch[0].length);
    }

    const matchCandidate = (candidates: string[], slot: 'speaker1' | 'speaker2'): boolean => {
      for (const candidate of candidates) {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^(${escaped})(?:\\s+|$)`);
        const m = remaining.match(re);
        if (m) {
          speaker = m[1];
          speakerSlot = slot;
          remaining = remaining.slice(m[0].length).trimStart();
          return true;
        }
      }
      return false;
    };

    if (!matchCandidate(s1Candidates, 'speaker1')) {
      matchCandidate(s2Candidates, 'speaker2');
    }

    return {
      index,
      raw,
      timestampStr,
      timestampSec,
      speaker,
      speakerSlot,
      body: remaining,
    };
  });
}

/**
 * Applies a speaker label (or clears it if null) to specific 0-based line indices.
 * Replaces any previous speaker label cleanly while keeping timestamps intact.
 */
export function applySpeakerLabelsToLines(
  text: string,
  lineIndices: ReadonlySet<number>,
  targetSpeaker: string | null,
  aliases: SpeakerAliases
): string {
  const parsed = parseUtteranceLines(text, aliases);
  return parsed
    .map((line) => {
      if (!lineIndices.has(line.index) || !line.raw.trim()) {
        return line.raw;
      }
      const tsPart = line.timestampStr ? `[${line.timestampStr}] ` : '';
      const spkPart = targetSpeaker ? `${targetSpeaker} ` : '';
      return `${tsPart}${spkPart}${line.body}`.trimEnd();
    })
    .join('\n');
}

/**
 * Rewrites existing speaker prefixes across a transcript when speaker aliases change,
 * matching components/audio_menu.py customizeSpeakerAliases().
 */
export function remapSpeakerAliases(
  text: string,
  previousAliases: SpeakerAliases,
  nextAliases: SpeakerAliases
): string {
  if (!text.trim()) return text;
  const parsed = parseUtteranceLines(text, previousAliases);
  const next1 = nextAliases.speaker1.trim() || 'C';
  const next2 = nextAliases.speaker2.trim() || 'E';

  return parsed
    .map((line) => {
      if (!line.raw.trim() || !line.speakerSlot) {
        return line.raw;
      }
      const tsPart = line.timestampStr ? `[${line.timestampStr}] ` : '';
      const newSpeaker = line.speakerSlot === 'speaker1' ? next1 : next2;
      return `${tsPart}${newSpeaker} ${line.body}`.trimEnd();
    })
    .join('\n');
}

/**
 * Swaps Speaker 1 and Speaker 2 labels across all labeled utterances in a transcript.
 */
export function swapSpeakersInTranscript(
  text: string,
  aliases: SpeakerAliases
): string {
  if (!text.trim()) return text;
  const parsed = parseUtteranceLines(text, aliases);
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  return parsed
    .map((line) => {
      if (!line.raw.trim() || !line.speakerSlot) {
        return line.raw;
      }
      const tsPart = line.timestampStr ? `[${line.timestampStr}] ` : '';
      const swapped = line.speakerSlot === 'speaker1' ? s2 : s1;
      return `${tsPart}${swapped} ${line.body}`.trimEnd();
    })
    .join('\n');
}

/**
 * Strips leading `[M:SS] ` timestamps from every line (for Word/SALT export).
 */
export function stripTimestamps(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[\d+:\d{2}\]\s*/, ''))
    .join('\n')
    .trim();
}

/**
 * Builds standard SALT Software transcript header lines from ClientInfo and speaker aliases.
 */
export function buildSaltHeader(
  clientInfo: ClientInfo,
  aliases: SpeakerAliases
): string {
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';
  const lines: string[] = [`$ ${s1 === 'C' ? 'Child' : s1}, ${s2 === 'E' ? 'Examiner' : s2}`];

  if (clientInfo.name.trim()) lines.push(`+ Name: ${clientInfo.name.trim()}`);
  if (clientInfo.gender.trim()) lines.push(`+ Gender: ${clientInfo.gender.trim()}`);
  if (clientInfo.dateOfBirth.trim()) lines.push(`+ DOB: ${clientInfo.dateOfBirth.trim()}`);
  if (clientInfo.dateOfSample.trim()) lines.push(`+ DOE: ${clientInfo.dateOfSample.trim()}`);
  if (clientInfo.age.trim()) lines.push(`+ CA: ${clientInfo.age.trim()}`);
  if (clientInfo.examinerName.trim()) lines.push(`+ Examiner: ${clientInfo.examinerName.trim()}`);
  if (clientInfo.samplingContext.trim()) lines.push(`+ Context: ${clientInfo.samplingContext.trim()}`);

  return lines.join('\n');
}

/**
 * Builds plain readable Client Info header lines (matching client_info.py __str__).
 */
export function buildReadableClientHeader(clientInfo: ClientInfo): string {
  const pairs: Array<[string, string]> = [
    ['Name', clientInfo.name],
    ['Age', clientInfo.age],
    ['Gender', clientInfo.gender],
    ['Date of Birth', clientInfo.dateOfBirth],
    ['Date of Sample', clientInfo.dateOfSample],
    ['Examiner Name', clientInfo.examinerName],
    ['Sampling Context', clientInfo.samplingContext],
  ];
  return pairs
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `${k}: ${v.trim()}`)
    .join('\n');
}
