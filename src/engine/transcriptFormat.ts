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

/**
 * Formats Whisper segments into Saltify's standard `[M:SS] utterance` line format,
 * matching diarizationAndTranscription.formatTranscriptionWithTimestamps().
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

    // Split multi-sentence chunks into individual utterance lines while keeping the segment timestamp
    const sentences = cleaned
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const ts = formatTimestamp(startSec);
    for (const sentence of sentences) {
      lines.push(`[${ts}] ${sentence}`);
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
