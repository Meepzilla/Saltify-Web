import { describe, expect, it } from 'vitest';
import {
  applySpeakerLabelsToLines,
  buildSaltHeader,
  extractWhisperUtterances,
  formatWhisperChunks,
  parseUtteranceLines,
  remapSpeakerAliases,
  stripTimestamps,
  swapSpeakersInTranscript,
} from '../transcriptFormat';
import { EMPTY_CLIENT_INFO } from '../../types/saltify';

describe('transcriptFormat', () => {
  it('formats Whisper timestamped chunks into [M:SS] sentence lines', () => {
    const out = formatWhisperChunks([
      { timestamp: [0, 4.2], text: ' Hello there! How are you?' },
      { timestamp: [65.3, 70], text: ' I went to the park...' },
    ]);
    expect(out).toBe('[0:00] Hello there!\n[0:02] How are you?\n[1:05] I went to the park');
  });

  it('times each sentence from its own stretch of speech when regions are known', () => {
    const chunks: Array<{ timestamp: [number, number | null]; text: string }> = [
      { timestamp: [0, 14], text: ' I see a dog. It is big. Can I pet it?' },
    ];
    const regions = [
      { start: 0.2, end: 1.5 },
      { start: 5.1, end: 6.4 },
      { start: 11.8, end: 13.6 },
    ];
    const utts = extractWhisperUtterances(chunks, regions);
    expect(utts.map((u) => u.timestampStr)).toEqual(['0:00', '0:05', '0:11']);
    expect(utts[1].startSec).toBeCloseTo(5.1);
    // Without regions, starts are estimated from sentence length (no longer all 0:00)
    expect(extractWhisperUtterances(chunks).map((u) => u.timestampStr)).toEqual(['0:00', '0:04', '0:08']);
  });

  it('distributes multi-sentence Whisper chunks proportionally across [startSec, endSec]', () => {
    const utts = extractWhisperUtterances([
      { timestamp: [0, 6.0], text: ' Hello there! How are you doing today?' },
      { timestamp: [6.0, 9.0], text: ' Doing great.' },
    ]);
    expect(utts).toHaveLength(3);
    expect(utts[0].startSec).toBe(0);
    expect(utts[0].endSec).toBeGreaterThan(1.0);
    expect(utts[0].endSec).toBeLessThan(3.5);
    expect(utts[1].startSec).toBeCloseTo(utts[0].endSec, 5);
    expect(utts[1].endSec).toBeCloseTo(6.0, 5);
    expect(utts[2].startSec).toBe(6.0);
    expect(utts[2].endSec).toBe(9.0);
  });

  it('applies and replaces speaker labels without duplicating prefixes', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const initial = '[0:00] Hello.\n[0:05] E Hi there.';
    const updated = applySpeakerLabelsToLines(initial, new Set([0, 1]), 'C', aliases);
    expect(updated).toBe('[0:00] C Hello.\n[0:05] C Hi there.');
  });

  it('remaps speaker aliases cleanly across existing lines', () => {
    const prev = { speaker1: 'C', speaker2: 'E' };
    const next = { speaker1: 'Leo', speaker2: 'Clinician' };
    const text = '[0:00] E Ready?\n[0:04] C Yes!';
    expect(remapSpeakerAliases(text, prev, next)).toBe(
      '[0:00] Clinician Ready?\n[0:04] Leo Yes!'
    );

    const parsed = parseUtteranceLines(remapSpeakerAliases(text, prev, next), next);
    expect(parsed[0].speakerSlot).toBe('speaker2');
    expect(parsed[1].speakerSlot).toBe('speaker1');
  });

  it('swaps Speaker 1 and Speaker 2 labels cleanly while leaving unlabeled lines intact', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const text = '[0:00] E Ready?\n[0:04] C Yes!\n[0:08] Unlabeled utterance.';
    const swapped = swapSpeakersInTranscript(text, aliases);
    expect(swapped).toBe('[0:00] C Ready?\n[0:04] E Yes!\n[0:08] Unlabeled utterance.');
    expect(swapSpeakersInTranscript(swapped, aliases)).toBe(text);
  });

  it('strips timestamps and generates valid SALT headers', () => {
    expect(stripTimestamps('[0:00] C Hello.\n[1:12] E Hi.')).toBe('C Hello.\nE Hi.');
    const header = buildSaltHeader(
      { ...EMPTY_CLIENT_INFO, name: 'Client_1', age: '4;6', samplingContext: 'Play' },
      { speaker1: 'C', speaker2: 'E' }
    );
    expect(header).toContain('$ Child, Examiner');
    expect(header).toContain('+ Name: Client_1');
    expect(header).toContain('+ CA: 4;6');
    expect(header).toContain('+ Context: Play');
  });
});
