export type ChangelogCategory = 'added' | 'improved' | 'fixed';

export interface ChangelogItem {
  category: ChangelogCategory;
  summary: string;
  detail?: string;
}

export interface ChangelogRelease {
  version: string;
  date: string; // ISO calendar date YYYY-MM-DD
  title: string;
  summary: string;
  changes: ChangelogItem[];
}

/**
 * Current application version injected from package.json at build/test time.
 */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Chronological release history (newest first) reflecting shipped Saltify Web milestones.
 */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: '1.7.0',
    date: '2026-11-26',
    title: 'Expected Words: Teach Whisper Your Sample\'s Vocabulary',
    summary:
      'Give Whisper the names and story words you expect in a sample and it spells them correctly far more often.',
    changes: [
      {
        category: 'added',
        summary: 'Expected words per session (Client & sample info, or audio ⋯ → Expected words…)',
        detail:
          'List the child\'s name, family names and story vocabulary (e.g. "Maya, frog, jar, gopher, beehive"). Whisper receives them as a hint before transcribing, including the Second Opinion model. In testing with a relevant word list, Whisper Small made 31% fewer errors on clean audio (5.8% → 4.0%) and fewer in noise (17.9% → 15.7%).',
      },
      {
        category: 'improved',
        summary: 'Use only words you expect',
        detail:
          'An unrelated word list made noisy recordings slightly worse in testing (17.9% → 20.8%), and a listed word can occasionally replace a similar-sounding one, so keep the list to words likely to be said. The hint never appears in the transcript.',
      },
    ],
  },
  {
    version: '1.6.1',
    date: '2026-11-26',
    title: 'Type Your Own Fix & Live Review Sensitivity',
    summary:
      'Every flagged word now has a "Replace with…" field, and review sensitivity sliders update the highlights live without re-transcribing.',
    changes: [
      {
        category: 'added',
        summary: '"Replace with…" on every flagged word',
        detail:
          'Tap any underlined word to type the correct word or phrase (e.g. "went to"), alongside "Use the other model\'s word", Remove word, Keep this word and Listen & spectrogram. Other flags in the line keep their positions.',
      },
      {
        category: 'added',
        summary: 'Live review sensitivity (Transcript ⋯ → Review sensitivity)',
        detail:
          'Two sliders set how unsure Whisper must be before a word is flagged (default 60%) and when second-opinion disagreements are flagged (default 90%). Highlights and the flag count update while you drag; Reset restores the recommended values. Applies to sessions transcribed from this version on.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-11-26',
    title: 'Second Opinion: Compare Two Whisper Models',
    summary:
      'Optionally transcribe with a second Whisper model and flag the words where the two disagree, with a one-tap way to use the other model\'s word.',
    changes: [
      {
        category: 'added',
        summary: 'Second Opinion setting (Settings → Speech & Models)',
        detail:
          'Runs a second model (e.g. Base alongside Small) over the same audio after the main transcription. On 90 benchmark clips (clean, noisy and child-like pitch + noise), this raised the share of Whisper Small\'s mistakes that get flagged from 57% to 66% with a similar number of flags. Adds about 50% to transcription time; off by default.',
      },
      {
        category: 'added',
        summary: 'Disagreement words show what the other model heard',
        detail:
          'Words where the models disagree get a dashed violet underline. Tap one to use the other model\'s word, remove a word the other model did not hear (often a hallucinated ending), keep your word, or open the spectrogram. Resolving one word keeps the line\'s other flags.',
      },
      {
        category: 'improved',
        summary: 'Why the transcript is not merged automatically',
        detail:
          'Automatically picking the more confident model\'s word did not beat Whisper Small alone in testing (the two models are each right about half the time when they disagree), so the choice is left to you.',
      },
      {
        category: 'fixed',
        summary: 'Menus near the left edge stay on screen',
        detail: 'Pop-up menus now open to the right when there is no room to the left, which matters on phones.',
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-11-26',
    title: 'Uncertain-Word Flags & Spectrogram View',
    summary:
      'Highlights the words Whisper was unsure about so you know where to listen again, and adds a spectrogram with formant (F1–F3) and pitch tracks for checking what the child actually said.',
    changes: [
      {
        category: 'added',
        summary: 'Uncertain words are highlighted in the Transcript',
        detail:
          'Whisper\'s confidence is recorded for every word during transcription. Words below 60% get an amber wavy underline (red below 35%); hover or long-press to see the percentage and tap to open that utterance in the spectrogram. Editing a line clears its highlights. Toggle in Transcript ⋯ → Highlight uncertain words.',
      },
      {
        category: 'added',
        summary: 'Spectrogram with formant and pitch tracks',
        detail:
          'Open from Transcript ⋯ → Spectrogram, the audio bar ⋯ menu, or by tapping an uncertain word. Shows a wideband (formants) or narrowband (harmonics) spectrogram up to 6 kHz with F1/F2/F3 dots, an F0 pitch track, a time/frequency readout, play-this-utterance, and ← / → to step through utterances. Formants use LPC with an 8000 Hz ceiling suited to children; values are approximate and never change your transcript.',
      },
    ],
  },
  {
    version: '1.4.2',
    date: '2026-11-26',
    title: 'More Accurate Grammar Check for are / is / was / were',
    summary:
      'Grammar Check now finds the real subject before checking verb agreement, so it stops flagging correct sentences and catches errors it used to miss.',
    changes: [
      {
        category: 'fixed',
        summary: 'Correct "are" no longer flagged',
        detail:
          'Relative clauses ("the toys that are broken"), compound subjects ("He and she are playing") and questions ("What are you doing?") are no longer coded as errors or given an extra *are.',
      },
      {
        category: 'improved',
        summary: 'Catches agreement errors with nouns, questions and "there"',
        detail:
          'Codes "The dog are", "The dogs is", "My mom and dad is", "Are he coming?", "Where is they?", "There is two dogs", "Does they like it?" and "The cookies was", including plural-only nouns like pants and irregular plurals like children and feet.',
      },
      {
        category: 'fixed',
        summary: 'Fewer false /*3s and omitted-auxiliary codes',
        detail:
          '"He and she walk" and "the dogs that walk" no longer get /*3s, and *is / *am / *are is only inserted for a pronoun that starts its clause ("He running"), not "I saw him running". Subjunctive "if I were" is left alone, and imperatives like "Do it!" are not treated as questions.',
      },
    ],
  },
  {
    version: '1.4.1',
    date: '2026-11-26',
    title: 'Redesigned, Less Cluttered Workspace',
    summary:
      'A cleaner layout built for iPad and phones: a compact audio bar, Transcript / SALT tabs with an optional split view, and secondary actions tucked into ⋯ menus. On iPad landscape the transcript gets almost twice the room.',
    changes: [
      {
        category: 'improved',
        summary: 'Compact one-row audio bar',
        detail:
          'Record, upload, playback, waveform, speed, volume boost and Transcribe now share a single bar. Fine volume, restart, large waveform, rename, download WAV and the demo sample are in the bar\'s ⋯ menu.',
      },
      {
        category: 'improved',
        summary: 'Transcript and SALT tabs with an optional split view',
        detail:
          'Show one box at full width, or tap the split button to compare both side by side. Your choice is remembered on each device.',
      },
      {
        category: 'improved',
        summary: 'Fewer buttons, one place for each action',
        detail:
          'The sessions sidebar is a slide-out drawer on iPad and laptops. Client info, speech models, help, settings and what\'s new live in the header ⋯ menu; plain-text editing, lock, speaker names, clear and "review all lines" are in each box\'s ⋯ menu. SALT steps are Grammar, Morphemes, Clauses and POS.',
      },
      {
        category: 'improved',
        summary: 'Metrics stay on one line',
        detail: 'The metrics bar no longer wraps, and the duplicate Mark Clauses button was removed.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-25',
    title: 'Age & Context Norms Comparison',
    summary:
      "Automatically compares the child's SALT metrics against published age norms using the age (or DOB + sample date) and sampling context from Client Info, with z-scores and SALT-style WNL / Borderline / Significant flags.",
    changes: [
      {
        category: 'added',
        summary: 'Age & Context Norms card in the metrics panel',
        detail:
          'Compares MLUm and MLUw (Miller & Chapman 1981; Rice et al. 2010), clausal density and TNW per 50 utterances (SUGAR, Pavelko & Owens 2017), % maze words (SALT databases) and intelligibility (Rice et al. 2010) against the matching age band. Shows norm mean ± SD, z-score, status and source citation, with narrative and expository genre bands for clausal density.',
      },
      {
        category: 'added',
        summary: 'Norm status dots and inline calculation tooltip comparisons',
        detail:
          'MLUm, MLUw, TNW, CD (SI) and Maze pills and primary speaker cells show a green, amber or red dot for within normal limits, borderline (−1 to −1.5 SD) or significant (≤ −1.5 SD). Clicking any normed metric displays its age norm range, z-score, status badge and caveats directly inside the calculation tooltip.',
      },
      {
        category: 'improved',
        summary: 'Clear caveats for sample size and context mismatches',
        detail:
          'Warns when there are fewer than 50 C&I utterances, when the sampling context is blank, or when a conversation norm is applied to a narrative or expository sample. Accepts ages like 4;6, 4y 6m and 54 months, with tap-to-expand row caveats for touch devices.',
      },
    ],
  },
  {
    version: '1.3.6',
    date: '2026-11-25',
    title: 'IPA Broad Transcription & Reliable Monologue Auto-Labeling',
    summary:
      'Adds a non-destructive switch for General American English IPA broad transcription (/…/) with true IPA Unicode characters and export support, fixes false 2-speaker splits on monologues, and adds Auto / 1 Speaker / 2 Speakers modes to Label Speakers.',
    changes: [
      {
        category: 'added',
        summary: 'IPA broad transcription switch (/…/) with authentic IPA symbols',
        detail:
          'Toggle General American English broad phonemic IPA transcription directly from the Transcription Box, SALT Convention Box, Settings → SALT & Export, or Export & Print (Word, SALT .slt, plain text, clipboard, and print). Uses the 135k-word CMU Pronouncing Dictionary offline with true IPA Unicode characters (ɑ æ ʌ ə ɛ ɪ ɔ ʊ ɝ ɚ θ ð ʃ ʒ ŋ ɹ ɡ ˈ ˌ), Maximal Onset syllable stress, SALT morpheme & child overregularization support, and hover tooltips showing original spelling without altering your transcript or metrics.',
      },
      {
        category: 'fixed',
        summary: 'Single-speaker monologues are no longer randomly split into two speakers',
        detail:
          'Replaces noise-amplifying z-scored K-means thresholds with voiced-only acoustic feature extraction, sub-harmonic-safe YIN pitch tracking, and unsupervised 1D bimodality verification so natural pitch, vowel, or microphone-distance changes in a monologue stay labeled as one speaker.',
      },
      {
        category: 'fixed',
        summary: 'Multi-sentence Whisper chunks no longer collide on the same 0.6s audio slice',
        detail:
          'Preserves exact sub-second Whisper utterance boundaries and proportionally splits shared [M:SS] timestamps so each sentence is analyzed against its own audio segment.',
      },
      {
        category: 'fixed',
        summary: 'Narrative starters and quoted questions no longer trigger false Examiner labels',
        detail:
          'Text-only auto-labeling no longer flips monologues to Examiner on sentences starting with "When...", "What...", or "Okay, so...", or on quoted dialogue, while keeping clinical SLP prompts accurate.',
      },
      {
        category: 'added',
        summary: 'Auto / 1 Speaker / 2 Speakers mode selector in Label Speakers',
        detail:
          'Choose Auto-Detect (1 or 2 speakers), force 1 Speaker for monologues, or force 2 Speakers for close-voice conversations right next to the Auto-Label button.',
      },
    ],
  },
  {
    version: '1.3.5',
    date: '2026-11-24',
    title: 'Parts of Speech & SALT Standard Measures',
    summary:
      'Adds part-of-speech color coding and optional POS word codes, and aligns NTW, NDW, TTR and words/minute with the SALT Standard Measures Report.',
    changes: [
      {
        category: 'added',
        summary: 'Color-code parts of speech in utterances (Settings → SALT & Export)',
        detail:
          'Colors each word in the Transcription and SALT Convention boxes as noun, verb, auxiliary, pronoun, adjective, adverb, determiner, preposition, conjunction, number or interjection, with a color key. Display only: transcript text and metrics are unchanged.',
      },
      {
        category: 'added',
        summary: 'POS Codes button inserts part-of-speech word codes',
        detail:
          'Adds codes such as dog[N], run/3s[V] and he[PRO] after every spoken word in the SALT Convention box (tap again to remove). Mazes, comments, omitted words and SALT codes are skipped, and the codes never affect metrics, clause estimates, morpheme coding or Grammar Check.',
      },
      {
        category: 'fixed',
        summary: 'NTW, NDW and TTR use the C&I verbal utterance set',
        detail:
          'Matches the SALT Guide to the Standard Measures Report, where MLU, NTW and NDW are based on complete, intelligible, verbal utterances (excluding mazes). Maze % and words/minute still use all utterances.',
      },
      {
        category: 'fixed',
        summary: 'Nonverbal utterances are excluded from C&I verbal utterances',
        detail: 'An utterance like "C {nods}." no longer counts toward the MLU denominator.',
      },
      {
        category: 'fixed',
        summary: 'Words/minute counts all words produced, including maze words',
        detail: 'Matches SALT Words/Minute: ratio of all words produced to the elapsed time.',
      },
      {
        category: 'added',
        summary: 'Root identification (|) and linked words (_) are understood in metrics',
        detail:
          '"goed|go[EO:went]" counts under the root "go", and emphatic repeats coded as "very very_very|very" count as single words, per SALT conventions.',
      },
      {
        category: 'improved',
        summary: 'Whisper abbreviations drop the period ("Mr Smith"), and EH is coded as a filled pause',
        detail: 'SALT treats periods as utterance punctuation only, never as part of a word.',
      },
    ],
  },
  {
    version: '1.3.4',
    date: '2026-11-24',
    title: 'Transcription Stability & SALT Accuracy Fixes',
    summary:
      'Fixes the iPad Safari worker crash, recovers from WebGPU failures on Android, corrects MLU and word counts, improves clause estimates, and codes Whisper fillers as SALT mazes.',
    changes: [
      {
        category: 'fixed',
        summary: 'MLU now uses complete & intelligible utterances for both numerator and denominator',
        detail:
          'Previously words from abandoned (>), interrupted (^) and unintelligible utterances were added to the MLU numerator while being excluded from the denominator, inflating MLUw and MLUm.',
      },
      {
        category: 'fixed',
        summary: 'Unintelligible X/XX/XXX, {comments} and bracket codes are no longer counted as words',
        detail:
          'XXX was counted in TNW and NDW, and SALT comments like {laughs} were counted as spoken words. Single X now also marks an utterance as not intelligible.',
      },
      {
        category: 'fixed',
        summary: 'Adjacent mazes count as one maze',
        detail: '"(um) (I) I want" is one maze with two maze words, matching SALT.',
      },
      {
        category: 'improved',
        summary: 'More accurate automatic clause (SI) estimates',
        detail:
          'Fixes tagger mistakes that dropped clauses: "like" after a pronoun ("we like it" was excluded as SI-X) and relative clauses such as "the toy that fell" or "the dog that barks".',
      },
      {
        category: 'improved',
        summary: 'Whisper fillers and stutters are coded as SALT mazes automatically',
        detail:
          '"Um, I, I want, uh, the ball." becomes "(Um I) I want, (uh) the ball." Only fillers and repeated short function words are coded; emphatic repeats like "very very" are left alone. Sentences no longer split after "Mr." or "Dr.", and filler-only utterances are dropped.',
      },
      {
        category: 'fixed',
        summary: 'Whisper worker crash on iPad Safari ("Maximum call stack size exceeded")',
        detail:
          'Speaker assignment now runs on the main page, so the large grammar dictionary is no longer loaded inside the speech worker, where it overflowed Safari\'s small worker stack. The worker download shrank from 2.6 MB to 0.56 MB.',
      },
      {
        category: 'fixed',
        summary: 'WebGPU errors during transcription on Android ("reading \'destroy\'")',
        detail:
          'Phones and tablets now use the stable WASM engine in Auto mode, and if WebGPU fails while transcribing, Saltify switches to WASM and retries automatically instead of failing.',
      },
    ],
  },
  {
    version: '1.3.3',
    date: '2026-11-24',
    title: 'Fix Model Downloads on Cloudflare Workers',
    summary:
      'Omits outbound Referer headers on model downloads so Hugging Face no longer blocks requests originating from *.workers.dev domains.',
    changes: [
      {
        category: 'fixed',
        summary: 'Whisper model downloads failing with CORS / Failed to fetch on workers.dev',
        detail:
          'Hugging Face CloudFront returns HTTP 404 (without CORS headers) when a request carries a *.workers.dev Referer header. Saltify now sets referrerPolicy: "no-referrer" and Referrer-Policy: no-referrer so model downloads succeed reliably.',
      },
    ],
  },
  {
    version: '1.3.2',
    date: '2026-11-24',
    title: 'Clearer Model Errors & Stale Cache Repair',
    summary:
      'Model download and transcription errors now say exactly what failed and where, and stale cached web pages no longer break model loading.',
    changes: [
      {
        category: 'fixed',
        summary: 'Stale cached web pages breaking Whisper model loading',
        detail:
          'Removes index.html responses that older builds saved into the model cache, which caused "Unexpected token <" errors even after the 1.3.1 fix.',
      },
      {
        category: 'improved',
        summary: 'Model and transcription errors show the real cause',
        detail:
          'Errors now include the browser error, the step that failed, and the exact URL that could not be downloaded. The Error Log keeps full technical details and the stack trace.',
      },
    ],
  },
  {
    version: '1.3.1',
    date: '2026-11-23',
    title: 'On-Device Error Log & Cloudflare Model Download Fix',
    summary:
      'Adds a local Error Log & Diagnostics page for troubleshooting and resolves Whisper model downloads on Cloudflare Workers SPA hosting.',
    changes: [
      {
        category: 'added',
        summary: 'On-device Error Log & Diagnostics page (#settings/logs)',
        detail:
          'Automatically captures model download, transcription, audio, and runtime errors locally (with zero transcript text logged), plus Copy Report and Export JSON.',
      },
      {
        category: 'added',
        summary: 'One-tap View Log action on error notifications',
        detail:
          'Jump straight from any error toast to the full technical details and runtime context in Settings → Error Log.',
      },
      {
        category: 'fixed',
        summary: 'Whisper model downloads on Cloudflare Workers SPA hosting',
        detail:
          'Verifies /models/ serves JSON before attempting local model fetches so SPA HTML fallbacks no longer trigger "Unexpected token <" errors.',
      },
      {
        category: 'fixed',
        summary: 'Cloudflare Workers 25 MiB per-file static asset limit',
        detail:
          'Ships the compact 13.6 MiB ONNX Runtime WASM binary by default while keeping full air-gapped ORT bundles enabled in Docker builds.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-23',
    title: 'Settings Page, Change Log & Version Info',
    summary:
      'Centralizes all clinical, speech-model, self-hosting, audio playback, and export preferences alongside a dedicated Change Log and live version view.',
    changes: [
      {
        category: 'added',
        summary: 'Dedicated Settings page',
        detail:
          'Unified workspace view organizing General & Appearance, Speech & Models, SALT & Export defaults, and local storage status.',
      },
      {
        category: 'added',
        summary: 'Dedicated Change Log page with search and category filters',
        detail:
          'Browse every Saltify Web release chronologically, filter by Added, Improved, or Fixed, and copy version details with one click.',
      },
      {
        category: 'added',
        summary: 'Current version visibility across the app',
        detail:
          'Displays the running version in the sidebar footer, Settings header, About summary, and Change Log banner.',
      },
      {
        category: 'added',
        summary: 'Default speaker aliases for new sessions & one-click preferences reset',
        detail:
          'Set default Speaker 1 / Speaker 2 labels (e.g., C / E) applied to new sessions and restore factory defaults without touching saved sessions.',
      },
      {
        category: 'improved',
        summary: 'Hash-synced navigation between Workspace, Settings, and Change Log',
        detail:
          'Supports browser back/forward navigation (#settings, #settings/changelog) and quick Escape return while preserving active session work.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-23',
    title: 'SALT Clause Marking, Clausal Density & Live Calculation Tooltips',
    summary:
      'Adds full SALT Subordination Index clause coding, inline clause boundary tagging, and click-to-inspect live formulas for every clinical metric.',
    changes: [
      {
        category: 'added',
        summary: 'Interactive SALT Clause Coder ([SI-0]–[SI-4+], [SI-X])',
        detail:
          'Score utterances with Subordination Index codes and mark inline clause boundaries ([MC], [SC], [RC], [AC], [NC]) with keyboard shortcuts.',
      },
      {
        category: 'added',
        summary: 'Live Clausal Density & Complex Utterance metrics',
        detail:
          'Computes Clausal Density (SI), Total Clauses, Complex Utterance %, and SI-0 through SI-X distributions per speaker in real time.',
      },
      {
        category: 'added',
        summary: 'Interactive calculation tooltips on every SALT metric and clause KPI',
        detail:
          'Click any metric pill or speaker cell to inspect its exact SALT formula and substituted counts from the current transcript.',
      },
      {
        category: 'improved',
        summary: 'One-tap utterance SI cycling in the SALT Convention Box',
        detail:
          'Tap the +SI badge on any coded utterance line to quickly step through SI-1, SI-2, SI-3, SI-0, and SI-X on iPad and Android.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-23',
    title: 'Air-Gapped Self-Hosting, 400% Audio Boost & Acoustic Diarization',
    summary:
      'Enables zero-external-network clinic deployments, soft-limited speech amplification for quiet recordings, automatic speaker assignment, and iPad memory stability.',
    changes: [
      {
        category: 'added',
        summary: '100% air-gapped self-hosting support',
        detail:
          'Serve Whisper models from /models/ and ONNX Runtime WASM from /ort/ using included Docker Compose, Caddy, and Nginx configs.',
      },
      {
        category: 'added',
        summary: '400% (+12 dB) Web Audio output volume boost & RMS speech leveling',
        detail:
          'Amplifies quiet child speech with soft clipping protection during playback and embeds boost gain when exporting normalized WAV audio.',
      },
      {
        category: 'added',
        summary: 'Acoustic speaker diarization & one-tap Swap C ↔ E',
        detail:
          'Automatically assigns two speakers locally from acoustic features and lets clinicians swap speaker labels across both panes.',
      },
      {
        category: 'improved',
        summary: 'iPadOS Safari stability for larger Whisper models',
        detail:
          'Introduced pause-aware low-RAM audio chunking and conservative WASM threading to prevent mobile browser tab reloads.',
      },
      {
        category: 'fixed',
        summary: 'Idempotent inflectional morpheme tagging',
        detail:
          'Re-running Add Morphemes no longer creates duplicate slash markers on already-coded words.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-23',
    title: 'Initial Saltify Web On-Device SALT Transcription PWA',
    summary:
      'Launches the privacy-first, 100% on-device Progressive Web App for recording, transcribing, coding, and analyzing child language samples.',
    changes: [
      {
        category: 'added',
        summary: 'On-device OpenAI Whisper transcription in a Web Worker',
        detail:
          'Runs Whisper Tiny, Base, and Small (.en) locally via @huggingface/transformers with WebGPU acceleration and automatic WASM fallback.',
      },
      {
        category: 'added',
        summary: 'Cross-platform audio studio & high-DPI interactive waveform',
        detail:
          'Live microphone capture with VU meter, pause/resume, drag-and-drop audio upload, speed control (0.5x–1.5x), and [M:SS] timestamp scrubbing.',
      },
      {
        category: 'added',
        summary: 'SALT grammar check workbench & bound inflectional morphemes',
        detail:
          'Step-by-step pediatric grammar coding (mazes, overregularizations, omissions) and /s, /z, /ed, /3s, /ing, and contraction tagging.',
      },
      {
        category: 'added',
        summary: 'Real-time SALT metrics & multi-format client-side exports',
        detail:
          'Tracks MLUm, MLUw, TNW, NDW, TTR, Mazes %, and WPM per speaker, with local export to .docx, .slt, .txt, .wav, Print, and .saltify.json.',
      },
    ],
  },
] as const;

export function getCurrentRelease(
  releases: readonly ChangelogRelease[] = CHANGELOG_RELEASES,
  version: string = APP_VERSION
): ChangelogRelease {
  return releases.find((r) => r.version === version) ?? releases[0];
}

export function getChangelogCategoryCounts(
  releases: readonly ChangelogRelease[] = CHANGELOG_RELEASES
): {
  total: number;
  added: number;
  improved: number;
  fixed: number;
} {
  let added = 0;
  let improved = 0;
  let fixed = 0;
  for (const release of releases) {
    for (const item of release.changes) {
      if (item.category === 'added') added += 1;
      else if (item.category === 'improved') improved += 1;
      else if (item.category === 'fixed') fixed += 1;
    }
  }
  return { total: added + improved + fixed, added, improved, fixed };
}

export function filterChangelogReleases(
  releases: readonly ChangelogRelease[],
  query: string,
  category: 'all' | ChangelogCategory
): ChangelogRelease[] {
  const normalizedQuery = query.trim().toLowerCase();

  return releases
    .map((release) => {
      const releaseHeaderMatches =
        normalizedQuery.length > 0 &&
        (release.version.toLowerCase().includes(normalizedQuery) ||
          `v${release.version}`.toLowerCase().includes(normalizedQuery) ||
          release.title.toLowerCase().includes(normalizedQuery) ||
          release.summary.toLowerCase().includes(normalizedQuery) ||
          release.date.includes(normalizedQuery));

      const filteredChanges = release.changes.filter((item) => {
        if (category !== 'all' && item.category !== category) {
          return false;
        }
        if (!normalizedQuery || releaseHeaderMatches) {
          return true;
        }
        return (
          item.summary.toLowerCase().includes(normalizedQuery) ||
          (item.detail?.toLowerCase().includes(normalizedQuery) ?? false) ||
          item.category.includes(normalizedQuery)
        );
      });

      if (filteredChanges.length === 0) {
        return null;
      }

      return {
        ...release,
        changes: filteredChanges,
      };
    })
    .filter((entry): entry is ChangelogRelease => entry !== null);
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Formats an ISO calendar date (`YYYY-MM-DD`) cleanly without UTC timezone rollover.
 */
export function formatReleaseDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);
  const monthName = MONTH_NAMES[monthIdx];
  if (!monthName || day < 1 || day > 31) return isoDate;
  return `${monthName} ${day}, ${year}`;
}
