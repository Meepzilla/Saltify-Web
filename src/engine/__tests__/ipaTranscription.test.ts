import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TRANSCRIPT } from '../sampleData';
import { DEFAULT_SPEAKER_ALIASES, EMPTY_CLIENT_INFO, type SessionRecord } from '../../types/saltify';
import { buildExportText } from '../exporter';
import {
  arpabetToBroadIpa,
  convertTranscriptToIpa,
  ensureIpaDictionary,
  formatUtteranceBodyAsIpa,
  isIpaDictionaryLoaded,
  tokenizeUtteranceBodyToIpa,
  wordToBroadIpa,
} from '../ipaTranscription';

beforeAll(async () => {
  await ensureIpaDictionary();
});

describe('arpabetToBroadIpa (General American IPA symbols & Maximal Onset)', () => {
  it('uses authentic Unicode IPA characters (script ɡ, turned ɹ, vowels, stress)', () => {
    // Script g (U+0261) and turned r (U+0279) — never plain ASCII 'g' or 'r'
    const green = arpabetToBroadIpa('G R IY1 N');
    expect(green).toBe('ɡɹin');
    expect(green).toContain('\u0261');
    expect(green).toContain('\u0279');
    expect(green).not.toContain('g');
    expect(green).not.toContain('r');

    // Full inventory of General American broad IPA vowels & consonants
    expect(arpabetToBroadIpa('F AA1 DH ER0')).toBe('ˈfɑðɚ'); // ɑ ð ɚ ˈ
    expect(arpabetToBroadIpa('K AE1 T')).toBe('kæt'); // æ (monosyllable: no ˈ)
    expect(arpabetToBroadIpa('K AH1 P')).toBe('kʌp'); // stressed AH -> ʌ
    expect(arpabetToBroadIpa('AH0 B AW1 T')).toBe('əˈbaʊt'); // unstressed AH -> ə, aʊ
    expect(arpabetToBroadIpa('B EH1 D')).toBe('bɛd'); // ɛ
    expect(arpabetToBroadIpa('S IH1 T')).toBe('sɪt'); // ɪ
    expect(arpabetToBroadIpa('D AO1 G')).toBe('dɔɡ'); // ɔ ɡ
    expect(arpabetToBroadIpa('B UH1 K')).toBe('bʊk'); // ʊ
    expect(arpabetToBroadIpa('B ER1 D')).toBe('bɝd'); // stressed ER -> ɝ
    expect(arpabetToBroadIpa('T AY1 M')).toBe('taɪm'); // aɪ
    expect(arpabetToBroadIpa('B OY1')).toBe('bɔɪ'); // ɔɪ
    expect(arpabetToBroadIpa('D EY1')).toBe('deɪ'); // eɪ
    expect(arpabetToBroadIpa('HH OW1 M')).toBe('hoʊm'); // oʊ
    expect(arpabetToBroadIpa('TH IH1 NG K')).toBe('θɪŋk'); // θ ŋ
    expect(arpabetToBroadIpa('SH IY1')).toBe('ʃi'); // ʃ
    expect(arpabetToBroadIpa('M EH1 ZH ER0')).toBe('ˈmɛʒɚ'); // ʒ
    expect(arpabetToBroadIpa('CH EH1 R')).toBe('tʃɛɹ'); // tʃ
    expect(arpabetToBroadIpa('JH AH1 M P')).toBe('dʒʌmp'); // dʒ
    expect(arpabetToBroadIpa('Y EH1 S')).toBe('jɛs'); // j
  });

  it('places primary (ˈ) and secondary (ˌ) stress at syllable onsets via Maximal Onset', () => {
    expect(arpabetToBroadIpa('W AO1 T ER0')).toBe('ˈwɔtɚ');
    expect(arpabetToBroadIpa('P L EY1 G R AW2 N D')).toBe('ˈpleɪˌɡɹaʊnd');
    expect(arpabetToBroadIpa('S AH1 M TH IH0 NG')).toBe('ˈsʌmθɪŋ');
    expect(arpabetToBroadIpa('CH IH1 L D R AH0 N')).toBe('ˈtʃɪldɹən');
    // NG cannot start an English syllable onset, so it stays in the preceding coda
    expect(arpabetToBroadIpa('S IH1 NG ER0')).toBe('ˈsɪŋɚ');
    // Secondary stress placed before legal onset cluster
    expect(arpabetToBroadIpa('AE2 S T R AH0 N AO1 T')).toBe('ˌæstɹəˈnɔt');
  });

  it('omits primary stress marks on monosyllables', () => {
    expect(arpabetToBroadIpa('S P R IH1 NG')).toBe('spɹɪŋ');
    expect(arpabetToBroadIpa('D AO1 G')).not.toContain('ˈ');
  });
});

describe('wordToBroadIpa (dictionary, clinical overrides, SALT morphemes & overregularizations)', () => {
  it('loads the CMU Pronouncing Dictionary lazily', () => {
    expect(isIpaDictionaryLoaded()).toBe(true);
  });

  it('applies clinical overrides for frequent pediatric speech words', () => {
    expect(wordToBroadIpa('putting')).toBe('ˈpʊtɪŋ');
    expect(wordToBroadIpa('was')).toBe('wʌz');
    expect(wordToBroadIpa('live')).toBe('lɪv');
    expect(wordToBroadIpa('wind')).toBe('wɪnd');
    expect(wordToBroadIpa('and')).toBe('ænd');
    expect(wordToBroadIpa('dogs')).toBe('dɔɡz');
    expect(wordToBroadIpa('um')).toBe('ʌm');
    expect(wordToBroadIpa('uh')).toBe('ʌ');
    expect(wordToBroadIpa('mm-hmm')).toBe('mˈhm');
    expect(wordToBroadIpa('uh-huh')).toBe('ʌˈhʌ');
  });

  it('handles contractions accurately', () => {
    expect(wordToBroadIpa("can't")).toBe('kænt');
    expect(wordToBroadIpa("I'm")).toBe('aɪm');
    expect(wordToBroadIpa("doesn't")).toBe('ˈdʌzənt');
    expect(wordToBroadIpa("there's")).toBe('ðɛɹz');
  });

  it('reconstructs SALT bound-morpheme and root-ID tokens into natural spoken IPA', () => {
    expect(wordToBroadIpa('dog/s')).toBe('dɔɡz');
    expect(wordToBroadIpa('walk/ed')).toBe('wɔkt');
    expect(wordToBroadIpa('go/3s')).toBe('ɡoʊz');
    expect(wordToBroadIpa("I/'m")).toBe('aɪm');
    expect(wordToBroadIpa("can/'t")).toBe('kænt');
    expect(wordToBroadIpa("is/n't")).toBe('ˈɪzənt');
    // Omitted bound morpheme `walk/*3s` was spoken as bare stem `walk`
    expect(wordToBroadIpa('walk/*3s')).toBe('wɔk');
    // Root identification `goed|go` transcribes what the child actually produced (`goed`)
    expect(wordToBroadIpa('goed|go')).toBe('ɡoʊd');
    // Linked emphatic words
    expect(wordToBroadIpa('very_very')).toBe('ˈvɛɹi ˈvɛɹi');
  });

  it('transcribes child overregularizations accurately via English inflectional phonology', () => {
    expect(wordToBroadIpa('goed')).toBe('ɡoʊd');
    expect(wordToBroadIpa('telled')).toBe('tɛld');
    expect(wordToBroadIpa('runned')).toBe('ɹʌnd');
    expect(wordToBroadIpa('falled')).toBe('fɔld');
    expect(wordToBroadIpa('eated')).toBe('ˈitɪd');
    expect(wordToBroadIpa('catched')).toBe('kætʃt');
    expect(wordToBroadIpa('foots')).toBe('fʊts');
    expect(wordToBroadIpa('mouses')).toBe('ˈmaʊsɪz');
    expect(wordToBroadIpa('childs')).toBe('tʃaɪldz');
    expect(wordToBroadIpa('sheeps')).toBe('ʃips');
  });

  it('handles integers, SALT unintelligible markers, and out-of-vocabulary words', () => {
    expect(wordToBroadIpa('0')).toBe('ˈzɪɹoʊ');
    expect(wordToBroadIpa('42')).toBe('ˈfɔɹti tu');
    expect(wordToBroadIpa('X')).toBe('X');
    expect(wordToBroadIpa('XX')).toBe('XX');
    expect(wordToBroadIpa('XXX')).toBe('XXX');

    // OOV novel child/proper word still emits valid IPA characters (turned ɹ, script ɡ, etc.)
    const oov = wordToBroadIpa('blorpgosh');
    expect(oov).toContain('ɹ');
    expect(oov).toContain('ɡ');
    expect(oov).toContain('ʃ');
    expect(oov).not.toContain('r');
    expect(oov).not.toContain('g');
  });
});

describe('utterance & transcript broad IPA formatting', () => {
  it('wraps utterances in phonemic slashes and strips English punctuation', () => {
    expect(formatUtteranceBodyAsIpa('The little boy went home.')).toBe(
      '/ðə ˈlɪtəl bɔɪ wɛnt hoʊm/'
    );
    expect(formatUtteranceBodyAsIpa('He walked and laughed!')).toBe(
      '/hi wɔkt ænd læft/'
    );
    // Ensure periods are never left inside /.../ where they look like IPA syllable dots
    const formatted = formatUtteranceBodyAsIpa('Yes, she went there.');
    expect(formatted).not.toContain('.');
    expect(formatted).not.toContain(',');
  });

  it('transcribes mazes inside parentheses and keeps SALT comments literal', () => {
    expect(formatUtteranceBodyAsIpa('(Um) he went home {laughs}.')).toBe(
      '/(ʌm) hi wɛnt hoʊm {laughs}/'
    );
    // Standalone nonverbal comment stays outside slashes
    expect(formatUtteranceBodyAsIpa('{nods}')).toBe('{nods}');
  });

  it('supports preserveSaltCodes mode for the SALT Convention Box while stripping POS codes', () => {
    const line = '(um) he telled[EO:told] the dog/s[N] *to run [SI-1].';
    expect(formatUtteranceBodyAsIpa(line, { preserveSaltCodes: false })).toBe(
      '/(ʌm) hi tɛld ðə dɔɡz ɹʌn/'
    );
    expect(formatUtteranceBodyAsIpa(line, { preserveSaltCodes: true })).toBe(
      '/(ʌm) hi tɛld[EO:told] ðə dɔɡz *to ɹʌn [SI-1]/'
    );

    const segments = tokenizeUtteranceBodyToIpa('He walk/ed.', { preserveSaltCodes: false });
    const wordSegs = segments.filter((s) => s.kind === 'word');
    expect(wordSegs).toEqual([
      { kind: 'word', text: 'hi', original: 'He' },
      { kind: 'word', text: 'wɔkt', original: 'walked' },
    ]);
  });

  it('converts full multi-line transcripts preserving timestamps, speakers, and SALT headers', () => {
    const sample = [
      '$ Child, Examiner',
      '+ Name: Maya',
      '- 0:00',
      '[0:02] E What happened to the little dog?',
      '[0:05] C (Um) he goed|go[EO:went] home.',
    ].join('\n');

    const ipa = convertTranscriptToIpa(sample, DEFAULT_SPEAKER_ALIASES, {
      preserveSaltCodes: true,
    });
    const lines = ipa.split('\n');
    expect(lines[0]).toBe('$ Child, Examiner');
    expect(lines[1]).toBe('+ Name: Maya');
    expect(lines[2]).toBe('- 0:00');
    expect(lines[3]).toBe('[0:02] E /wʌt ˈhæpənd tu ðə ˈlɪtəl dɔɡ/');
    expect(lines[4]).toBe('[0:05] C /(ʌm) hi ɡoʊd[EO:went] hoʊm/');

    // Smoke test on the full built-in demo transcript
    const demoIpa = convertTranscriptToIpa(DEMO_TRANSCRIPT, DEFAULT_SPEAKER_ALIASES);
    for (const line of demoIpa.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^\[\d+:\d{2}\] [CE] \/.*\/$/);
      expect(line).not.toContain('r');
      expect(line).not.toContain('g');
    }
  });

  it('integrates with buildExportText when convertToIpa is enabled', () => {
    const session: SessionRecord = {
      id: 'test-session',
      name: 'Test Session',
      createdAt: 1732492800000,
      updatedAt: 1732492800000,
      clientInfo: { ...EMPTY_CLIENT_INFO, name: 'Maya' },
      speakerAliases: { ...DEFAULT_SPEAKER_ALIASES },
      transcriptionText: '[0:02] C The little boy went home.\n[0:05] E He walked and laughed.',
      conventionText: '[0:02] C The little boy went home [SI-1].\n[0:05] E He walk/ed and laugh/ed [SI-1].',
      grammarCheckPerformed: true,
      morphemesApplied: true,
      audioMeta: null,
      hasAudioBlob: false,
      notes: '',
    };

    const rawIpaExport = buildExportText(session, {
      useConventionText: false,
      stripTimestamps: true,
      includeSaltHeaders: false,
      convertToIpa: true,
    });
    expect(rawIpaExport).toBe(
      'C /ðə ˈlɪtəl bɔɪ wɛnt hoʊm/\nE /hi wɔkt ænd læft/'
    );

    const saltIpaExport = buildExportText(session, {
      useConventionText: true,
      stripTimestamps: true,
      includeSaltHeaders: false,
      convertToIpa: true,
    });
    expect(saltIpaExport).toBe(
      'C /ðə ˈlɪtəl bɔɪ wɛnt hoʊm [SI-1]/\nE /hi wɔkt ænd læft [SI-1]/'
    );
  });
});
