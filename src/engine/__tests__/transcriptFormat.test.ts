import { describe, expect, it } from 'vitest';
import {
  applySpeakerLabelsToLines,
  buildSaltHeader,
  formatWhisperChunks,
  parseUtteranceLines,
  remapSpeakerAliases,
  stripTimestamps,
} from '../transcriptFormat';
import { EMPTY_CLIENT_INFO } from '../../types/saltify';

describe('transcriptFormat', () => {
  it('formats Whisper timestamped chunks into [M:SS] sentence lines', () => {
    const out = formatWhisperChunks([
      { timestamp: [0, 4.2], text: ' Hello there! How are you?' },
      { timestamp: [65.3, 70], text: ' I went to the park...' },
    ]);
    expect(out).toBe('[0:00] Hello there!\n[0:00] How are you?\n[1:05] I went to the park');
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
