import type { SpeakerAliases } from '../../types/session';

export interface ParsedTranscriptLine {
  index: number;
  raw: string;
  timestampLabel: string | null;
  timestampSeconds: number | null;
  speakerRole: 'speaker1' | 'speaker2' | 'none';
  speakerLabel: string | null;
  content: string;
}

const KNOWN_SPEAKER1 = ['Speaker 1', 'C', 'Child'];
const KNOWN_SPEAKER2 = ['Speaker 2', 'E', 'Examiner'];

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseTimestampSeconds(line: string): number | null {
  const match = line.trim().match(/^\[(\d+):(\d{2})\]/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

export function stripTimestamps(text: string): string {
  return text.replace(/^\[\d+:\d{2}\]\s*/gm, '');
}

export function parseTranscriptLines(
  text: string,
  aliases: SpeakerAliases
): ParsedTranscriptLine[] {
  const s1Labels = Array.from(new Set([aliases.speaker1, ...KNOWN_SPEAKER1].filter(Boolean)));
  const s2Labels = Array.from(new Set([aliases.speaker2, ...KNOWN_SPEAKER2].filter(Boolean)));

  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw, index) => {
      let rest = raw.trim();
      let timestampLabel: string | null = null;
      let timestampSeconds: number | null = null;

      const tsMatch = rest.match(/^\[(\d+):(\d{2})\]\s*(.*)$/);
      if (tsMatch) {
        timestampLabel = `[${tsMatch[1]}:${tsMatch[2]}]`;
        timestampSeconds = Number.parseInt(tsMatch[1], 10) * 60 + Number.parseInt(tsMatch[2], 10);
        rest = tsMatch[3];
      }

      let speakerRole: 'speaker1' | 'speaker2' | 'none' = 'none';
      let speakerLabel: string | null = null;

      for (const label of s1Labels) {
        if (rest.startsWith(`${label} `)) {
          speakerRole = 'speaker1';
          speakerLabel = label;
          rest = rest.slice(label.length).trimStart();
          break;
        }
      }

      if (speakerRole === 'none') {
        for (const label of s2Labels) {
          if (rest.startsWith(`${label} `)) {
            speakerRole = 'speaker2';
            speakerLabel = label;
            rest = rest.slice(label.length).trimStart();
            break;
          }
        }
      }

      return {
        index,
        raw,
        timestampLabel,
        timestampSeconds,
        speakerRole,
        speakerLabel,
        content: rest,
      };
    });
}

/**
 * Apply a speaker label to selected line indices in a transcript, cleanly replacing any existing speaker label.
 */
export function applySpeakerLabelsToLines(
  text: string,
  selectedIndices: Set<number>,
  targetRole: 'speaker1' | 'speaker2' | 'none',
  aliases: SpeakerAliases
): string {
  const parsed = parseTranscriptLines(text, aliases);
  const targetLabel =
    targetRole === 'speaker1'
      ? aliases.speaker1
      : targetRole === 'speaker2'
        ? aliases.speaker2
        : null;

  return parsed
    .map((line) => {
      if (!selectedIndices.has(line.index) || !line.raw.trim()) {
        return line.raw;
      }
      const parts = [line.timestampLabel, targetLabel, line.content].filter(Boolean);
      return parts.join(' ');
    })
    .join('\n');
}

/**
 * Update all existing speaker labels across a transcript when speaker aliases change.
 */
export function renameSpeakerAliasesInText(
  text: string,
  previousAliases: SpeakerAliases,
  nextAliases: SpeakerAliases
): string {
  if (!text.trim()) return text;
  const parsed = parseTranscriptLines(text, previousAliases);
  return parsed
    .map((line) => {
      if (!line.raw.trim()) return line.raw;
      if (line.speakerRole === 'speaker1') {
        return [line.timestampLabel, nextAliases.speaker1, line.content].filter(Boolean).join(' ');
      }
      if (line.speakerRole === 'speaker2') {
        return [line.timestampLabel, nextAliases.speaker2, line.content].filter(Boolean).join(' ');
      }
      return line.raw;
    })
    .join('\n');
}

/**
 * Swap Speaker 1 and Speaker 2 labels across all labeled utterances in a transcript.
 */
export function swapSpeakersInText(text: string, aliases: SpeakerAliases): string {
  if (!text.trim()) return text;
  const parsed = parseTranscriptLines(text, aliases);
  const s1 = aliases.speaker1.trim() || 'C';
  const s2 = aliases.speaker2.trim() || 'E';

  return parsed
    .map((line) => {
      if (!line.raw.trim()) return line.raw;
      if (line.speakerRole === 'speaker1') {
        return [line.timestampLabel, s2, line.content].filter(Boolean).join(' ');
      }
      if (line.speakerRole === 'speaker2') {
        return [line.timestampLabel, s1, line.content].filter(Boolean).join(' ');
      }
      return line.raw;
    })
    .join('\n');
}

