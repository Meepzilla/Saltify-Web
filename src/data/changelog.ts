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
