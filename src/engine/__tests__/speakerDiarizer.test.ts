import { describe, expect, it } from 'vitest';
import { DEMO_TRANSCRIPT } from '../sampleData';
import {
  assignRolesFromTextList,
  autoAssignSpeakersInTranscript,
  diarizeSpeakerSegments,
  WHISPER_SAMPLE_RATE,
  type TimedUtterance,
} from '../speakerDiarizer';
import { parseUtteranceLines, swapSpeakersInTranscript } from '../transcriptFormat';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const VOWELS_ALL: ReadonlyArray<[number, number, number]> = [
  [270, 2290, 3010],
  [530, 1840, 2480],
  [730, 1090, 2440],
  [570, 840, 2410],
  [300, 870, 2240],
  [660, 1720, 2410],
  [440, 1020, 2240],
];
const VOWELS_FRONT: ReadonlyArray<[number, number, number]> = [
  [270, 2290, 3010],
  [530, 1840, 2480],
  [660, 1720, 2410],
];
const VOWELS_BACK: ReadonlyArray<[number, number, number]> = [
  [570, 840, 2410],
  [300, 870, 2240],
  [730, 1090, 2440],
];

interface SynthSpeaker {
  baseF0: number;
  f0StdSt: number;
  vtScale: number;
}

function applyBandpass(signal: Float32Array, freq: number, bw: number, sr: number): Float32Array {
  const r = Math.exp((-Math.PI * bw) / sr);
  const cosW = Math.cos((2 * Math.PI * freq) / sr);
  const a1 = -2 * r * cosW;
  const a2 = r * r;
  const gain = (1 - r) * Math.sqrt(1 - 2 * r * cosW + r * r) * 0.5;
  const out = new Float32Array(signal.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const y = gain * signal[i] - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function applyLowpass(signal: Float32Array, cutoffHz: number, sr: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sr;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(signal.length);
  let y = 0;
  for (let i = 0; i < signal.length; i++) {
    y += alpha * (signal[i] - y);
    out[i] = y;
  }
  return out;
}

function synthesizeFormantUtterance(
  speaker: SynthSpeaker,
  durationSec: number,
  rng: () => number,
  opts: {
    pitchShiftSt?: number;
    slopeSt?: number;
    fricativeProb?: number;
    vowels?: ReadonlyArray<[number, number, number]>;
    lowpassHz?: number;
    gain?: number;
  } = {},
  sr = WHISPER_SAMPLE_RATE
): Float32Array {
  const len = Math.floor(durationSec * sr);
  const out = new Float32Array(len);
  const pitchShiftSt = opts.pitchShiftSt ?? randn(rng) * speaker.f0StdSt;
  const uttBaseF0 = speaker.baseF0 * Math.pow(2, pitchShiftSt / 12);
  const slopeSt = opts.slopeSt ?? randn(rng) * 2.5;
  const fricativeProb = opts.fricativeProb ?? 0.22;
  const vowels = opts.vowels ?? VOWELS_ALL;

  let pos = 0;
  let phase = 0;
  while (pos < len) {
    const segLen = Math.min(len - pos, Math.floor(((140 + rng() * 140) / 1000) * sr));
    const r = rng();
    if (r < 0.08) {
      for (let i = 0; i < segLen; i++) out[pos + i] = randn(rng) * 0.005;
    } else if (r < 0.08 + fricativeProb) {
      const noise = new Float32Array(segLen);
      for (let i = 0; i < segLen; i++) noise[i] = randn(rng) * 0.25;
      const filt = applyBandpass(noise, 3200 + rng() * 2800, 1200, sr);
      for (let i = 0; i < segLen; i++) out[pos + i] = filt[i] * 0.6;
    } else {
      const vowel = vowels[Math.floor(rng() * vowels.length)];
      const f1 = Math.min(7200, vowel[0] * speaker.vtScale * (0.95 + rng() * 0.1));
      const f2 = Math.min(7200, vowel[1] * speaker.vtScale * (0.95 + rng() * 0.1));
      const f3 = Math.min(7400, vowel[2] * speaker.vtScale * (0.95 + rng() * 0.1));
      const source = new Float32Array(segLen);
      for (let i = 0; i < segLen; i++) {
        const instF0 = uttBaseF0 * Math.pow(2, (slopeSt * ((pos + i) / len - 0.5)) / 12);
        phase += instF0 / sr;
        if (phase >= 1) phase -= 1;
        let pulse = 0;
        for (let h = 1; h <= 8; h++) {
          pulse += (1 / Math.pow(h, 0.9)) * Math.sin(2 * Math.PI * h * phase);
        }
        source[i] = pulse * (0.25 + 0.75 * Math.sin(Math.PI * (i / segLen))) * 0.3;
      }
      const b1 = applyBandpass(source, f1, 80, sr);
      const b2 = applyBandpass(source, f2, 110, sr);
      const b3 = applyBandpass(source, f3, 160, sr);
      for (let i = 0; i < segLen; i++) out[pos + i] = b1[i] + 0.7 * b2[i] + 0.35 * b3[i];
    }
    pos += segLen;
  }

  const filtered = opts.lowpassHz ? applyLowpass(out, opts.lowpassHz, sr) : out;
  const gain = opts.gain ?? 1.0;
  for (let i = 0; i < len; i++) {
    filtered[i] = filtered[i] * gain + randn(rng) * 0.008;
  }
  return filtered;
}

function synthesizeVoice(
  f0Hz: number,
  durationSec: number,
  sampleRate = WHISPER_SAMPLE_RATE
): Float32Array {
  const len = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    out[i] =
      0.35 * Math.sin(2 * Math.PI * f0Hz * t) +
      0.22 * Math.sin(2 * Math.PI * f0Hz * 2 * t) +
      0.14 * Math.sin(2 * Math.PI * f0Hz * 3 * t) +
      0.08 * Math.sin(2 * Math.PI * f0Hz * 4 * t);
  }
  return out;
}

function concatSegments(
  items: Array<{ wav: Float32Array; text: string }>,
  sr = WHISPER_SAMPLE_RATE
): { audio: Float32Array; segments: TimedUtterance[] } {
  const totalLen = items.reduce((s, item) => s + item.wav.length, 0);
  const audio = new Float32Array(totalLen);
  const segments: TimedUtterance[] = [];
  let offset = 0;
  for (const item of items) {
    audio.set(item.wav, offset);
    const startSec = offset / sr;
    const endSec = (offset + item.wav.length) / sr;
    segments.push({ startSec, endSec, text: item.text });
    offset += item.wav.length;
  }
  return { audio, segments };
}

const ADULT_MALE: SynthSpeaker = { baseF0: 120, f0StdSt: 2.0, vtScale: 1.0 };
const ADULT_FEMALE: SynthSpeaker = { baseF0: 205, f0StdSt: 2.2, vtScale: 1.18 };
const YOUNG_CHILD: SynthSpeaker = { baseF0: 295, f0StdSt: 2.8, vtScale: 1.42 };

const MONOLOGUE_STORY = [
  'Once upon a time there was a little boy who had a pet frog.',
  'He kept the frog in a big glass jar in his bedroom.',
  'When he went to sleep at night, the frog climbed right out.',
  'In the morning the boy woke up and saw the jar was empty.',
  'He looked inside his boot and under the bed.',
  'The dog stuck his whole head inside the jar.',
  'Where did that silly frog go?',
  'The boy yelled, "Where are you?"',
  'Then the dog fell right out of the window and broke the jar.',
  'Okay, so the boy climbed down to pick him up.',
  'They walked into the woods behind the house to keep looking.',
  'The boy looked inside a hole in the ground and a gopher bit his nose.',
  'Meanwhile the dog was barking at a big beehive hanging from a tree.',
  'What a surprise, those branches were deer antlers!',
  'When they listened behind a log, they found the frog with his family.',
  'So the boy took a baby frog home and waved goodbye.',
];

describe('speakerDiarizer & swapSpeakersInTranscript', () => {
  it('separates higher-pitched child voice (speaker1) from lower-pitched adult examiner (speaker2)', () => {
    const sr = WHISPER_SAMPLE_RATE;
    const adult1 = synthesizeVoice(125, 1.5, sr);
    const child1 = synthesizeVoice(290, 1.5, sr);
    const adult2 = synthesizeVoice(128, 1.5, sr);
    const child2 = synthesizeVoice(285, 1.5, sr);

    const combined = new Float32Array(adult1.length * 4);
    combined.set(adult1, 0);
    combined.set(child1, adult1.length);
    combined.set(adult2, adult1.length * 2);
    combined.set(child2, adult1.length * 3);

    const result = diarizeSpeakerSegments(
      combined,
      [
        { startSec: 0.0, endSec: 1.5, text: 'Tell me what happened next?' },
        { startSec: 1.5, endSec: 3.0, text: 'He walk to the store and telled a story.' },
        { startSec: 3.0, endSec: 4.5, text: 'Can you tell me more about the dog?' },
        { startSec: 4.5, endSec: 6.0, text: 'The dog goed home fast.' },
      ],
      sr
    );

    expect(result.speakerCount).toBe(2);
    expect(result.roles).toEqual(['speaker2', 'speaker1', 'speaker2', 'speaker1']);
  });

  it('keeps realistic single-speaker monologues as 1 speaker across male, female, and expressive child voices', () => {
    for (const [seed, spk, expressive] of [
      [101, ADULT_MALE, false],
      [202, ADULT_FEMALE, false],
      [303, YOUNG_CHILD, true],
    ] as const) {
      const rng = mulberry32(seed);
      const items = MONOLOGUE_STORY.map((text, idx) => ({
        wav: synthesizeFormantUtterance(spk, 1.4 + rng() * 1.0, rng, {
          pitchShiftSt:
            expressive && (idx === 6 || idx === 13)
              ? 5.0
              : expressive && idx === 14
              ? -4.2
              : undefined,
        }),
        text,
      }));
      const { audio, segments } = concatSegments(items);
      const result = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);

      expect(result.speakerCount).toBe(1);
      expect(result.roles.every((r) => r === 'speaker1')).toBe(true);
    }
  });

  it('does not split a monologue when phonemes, mic tilt, or gradual pitch drift vary across utterances', () => {
    // 1. Extreme front-vowel + sibilant half vs back-vowel half (same female speaker)
    {
      const rng = mulberry32(404);
      const items = MONOLOGUE_STORY.map((text, idx) => ({
        wav: synthesizeFormantUtterance(ADULT_FEMALE, 1.5, rng, {
          vowels: idx < 8 ? VOWELS_FRONT : VOWELS_BACK,
          fricativeProb: idx < 8 ? 0.42 : 0.05,
        }),
        text,
      }));
      const { audio, segments } = concatSegments(items);
      const result = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(result.speakerCount).toBe(1);
      expect(result.roles.every((r) => r === 'speaker1')).toBe(true);
    }

    // 2. Head-turn / mic-distance lowpass tilt on second half (same male speaker)
    {
      const rng = mulberry32(505);
      const items = MONOLOGUE_STORY.map((text, idx) => ({
        wav: synthesizeFormantUtterance(ADULT_MALE, 1.5, rng, {
          lowpassHz: idx >= 8 ? 1800 : undefined,
          gain: idx >= 8 ? 0.5 : 1.0,
        }),
        text,
      }));
      const { audio, segments } = concatSegments(items);
      const result = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(result.speakerCount).toBe(1);
    }

    // 3. Gradual -4 semitone pitch drift across a 16-utterance monologue (same female speaker)
    {
      const rng = mulberry32(606);
      const items = MONOLOGUE_STORY.map((text, idx) => ({
        wav: synthesizeFormantUtterance(ADULT_FEMALE, 1.5, rng, {
          pitchShiftSt: 2.0 - (idx / 15) * 4.0,
        }),
        text,
      }));
      const { audio, segments } = concatSegments(items);
      const result = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(result.speakerCount).toBe(1);
    }
  });

  it('detects 2 speakers accurately in Child + Male SLP, Child + Female SLP, Female + Male, and Asymmetric Narratives', () => {
    const convLines = [
      { who: 'E', text: 'Tell me what happened in the story?' },
      { who: 'C', text: 'Once upon a time the boy had a frog in a jar.' },
      { who: 'E', text: 'What happened when he went to sleep?' },
      { who: 'C', text: 'The frog jumped out and runned away into the woods.' },
      { who: 'E', text: 'Oh really? Then what did they do?' },
      { who: 'C', text: 'The boy looked in his boot and the dog falled out.' },
      { who: 'E', text: 'Can you tell me more about the dog?' },
      { who: 'C', text: 'The bees chased him because he knocked down the hive.' },
      { who: 'E', text: 'Did they find the frog at the end?' },
      { who: 'C', text: 'Yes, he was behind a log with baby frogs.' },
      { who: 'E', text: 'Good job! Anything else you remember?' },
      { who: 'C', text: 'They waved goodbye and goed home happy.' },
    ];

    // Child (4yo) + Female SLP (realistic clinical pair)
    {
      const rng = mulberry32(707);
      const items = convLines.map((line) => ({
        wav: synthesizeFormantUtterance(
          line.who === 'C' ? YOUNG_CHILD : ADULT_FEMALE,
          1.6,
          rng
        ),
        text: line.text,
      }));
      const { audio, segments } = concatSegments(items);
      const res = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(res.speakerCount).toBe(2);
      const correct = convLines.filter(
        (line, i) => res.roles[i] === (line.who === 'C' ? 'speaker1' : 'speaker2')
      ).length;
      expect(correct).toBeGreaterThanOrEqual(10);
    }

    // Adult Female + Adult Male with purely neutral text (no linguistic cues)
    {
      const rng = mulberry32(808);
      const items = MONOLOGUE_STORY.slice(0, 12).map((text, i) => ({
        wav: synthesizeFormantUtterance(i % 2 === 0 ? ADULT_MALE : ADULT_FEMALE, 1.6, rng),
        text,
      }));
      const { audio, segments } = concatSegments(items);
      const res = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(res.speakerCount).toBe(2);
      const matchA = items.filter((_, i) => res.roles[i] === (i % 2 === 0 ? 'speaker2' : 'speaker1')).length;
      expect(matchA).toBeGreaterThanOrEqual(10);
    }

    // Asymmetric clinical narrative (16 child utterances + 3 male SLP prompts)
    {
      const rng = mulberry32(909);
      const plan = [
        { who: 'E', text: 'Tell me what happened in this story?' },
        ...MONOLOGUE_STORY.slice(0, 6).map((text) => ({ who: 'C', text })),
        { who: 'E', text: 'Uh-huh, what happened next?' },
        ...MONOLOGUE_STORY.slice(6, 12).map((text) => ({ who: 'C', text })),
        { who: 'E', text: 'Anything else you remember?' },
        ...MONOLOGUE_STORY.slice(12, 16).map((text) => ({ who: 'C', text })),
      ];
      const items = plan.map((line) => ({
        wav: synthesizeFormantUtterance(line.who === 'C' ? YOUNG_CHILD : ADULT_MALE, 1.5, rng),
        text: line.text,
      }));
      const { audio, segments } = concatSegments(items);
      const res = diarizeSpeakerSegments(audio, segments, WHISPER_SAMPLE_RATE);
      expect(res.speakerCount).toBe(2);
      const correct = plan.filter(
        (line, i) => res.roles[i] === (line.who === 'C' ? 'speaker1' : 'speaker2')
      ).length;
      expect(correct).toBeGreaterThanOrEqual(18);
    }
  });

  it('handles shared [M:SS] timestamps and explicit single/two speaker modes cleanly', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };
    const rng = mulberry32(1111);
    const items = MONOLOGUE_STORY.slice(0, 9).map((text) => ({
      wav: synthesizeFormantUtterance(ADULT_FEMALE, 1.5, rng),
      text,
    }));
    const { audio } = concatSegments(items);

    // Simulate Whisper outputting 3 sentences under each [0:00], [0:04], [0:09] timestamp
    const transcript = items
      .map((item, i) => {
        const ts = i < 3 ? '0:00' : i < 6 ? '0:04' : '0:09';
        return `[${ts}] ${item.text}`;
      })
      .join('\n');

    const autoRes = autoAssignSpeakersInTranscript(transcript, aliases, audio, WHISPER_SAMPLE_RATE);
    expect(autoRes.method).toBe('acoustic');
    expect(autoRes.speakerCount).toBe(1);
    expect(
      parseUtteranceLines(autoRes.transcript, aliases).every((l) => l.speakerSlot === 'speaker1')
    ).toBe(true);

    // Explicit 'single' mode forces 1 speaker even on a 2-speaker transcript
    const twoSpeakerRaw = [
      '[0:00] Tell me what happened in the story?',
      '[0:05] He telled a funny story and goed home.',
    ].join('\n');
    const singleForced = autoAssignSpeakersInTranscript(
      twoSpeakerRaw,
      aliases,
      null,
      WHISPER_SAMPLE_RATE,
      { mode: 'single' }
    );
    expect(singleForced.speakerCount).toBe(1);
    expect(
      parseUtteranceLines(singleForced.transcript, aliases).every(
        (l) => l.speakerSlot === 'speaker1'
      )
    ).toBe(true);

    // Explicit 'two' mode splits even a single speaker when requested by the clinician
    const twoForced = autoAssignSpeakersInTranscript(
      transcript,
      aliases,
      audio,
      WHISPER_SAMPLE_RATE,
      { mode: 'two' }
    );
    expect(twoForced.speakerCount).toBe(2);
  });

  it('auto-assigns speakers via text cues accurately for both monologues and clinical dialogues, and swaps cleanly', () => {
    const aliases = { speaker1: 'C', speaker2: 'E' };

    // 1. Text-only 1-speaker monologue with "When...", "Okay, so...", and rhetorical/quoted questions
    const monoRoles = assignRolesFromTextList(MONOLOGUE_STORY);
    expect(monoRoles.every((r) => r === 'speaker1')).toBe(true);

    const monoTranscript = MONOLOGUE_STORY.map((line, i) => `[0:${String(i * 3).padStart(2, '0')}] ${line}`).join('\n');
    const monoAssigned = autoAssignSpeakersInTranscript(monoTranscript, aliases, null);
    expect(monoAssigned.speakerCount).toBe(1);
    expect(
      parseUtteranceLines(monoAssigned.transcript, aliases).every(
        (l) => l.speakerSlot === 'speaker1'
      )
    ).toBe(true);

    // 2. Text-only 2-speaker clinical sample (including Saltify's DEMO_TRANSCRIPT)
    const strippedDemo = parseUtteranceLines(DEMO_TRANSCRIPT, aliases)
      .map((l) => `[${l.timestampStr}] ${l.body}`)
      .join('\n');
    const demoAssigned = autoAssignSpeakersInTranscript(strippedDemo, aliases, null);
    expect(demoAssigned.speakerCount).toBe(2);
    const demoExpected = parseUtteranceLines(DEMO_TRANSCRIPT, aliases).map((l) => l.speakerSlot);
    const demoActual = parseUtteranceLines(demoAssigned.transcript, aliases).map(
      (l) => l.speakerSlot
    );
    expect(demoActual).toEqual(demoExpected);

    // 3. Short 2-line Q&A + swap round-trip
    const raw = [
      '[0:00] Tell me what happened in the story?',
      '[0:05] He telled a funny story and goed home.',
    ].join('\n');

    const assigned = autoAssignSpeakersInTranscript(raw, aliases, null);
    expect(assigned.speakerCount).toBe(2);
    expect(assigned.transcript).toContain('[0:00] E ');
    expect(assigned.transcript).toContain('[0:05] C ');

    const swapped = swapSpeakersInTranscript(assigned.transcript, aliases);
    expect(swapped).toContain('[0:00] C ');
    expect(swapped).toContain('[0:05] E ');
  });
});
