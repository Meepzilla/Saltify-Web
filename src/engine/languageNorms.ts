import type { ClientInfo, SpeakerMetrics } from '../types/saltify';

/**
 * Age- and context-referenced normative comparison for SALT language sample metrics.
 *
 * Only published, peer-reviewed reference values are encoded here:
 *  - Miller & Chapman (1981), JSHR 24(2): MLUm regression for 18–29 months (conversation/play).
 *  - Rice et al. (2010), JSLHR 53(2) (PMC2849178): SALT-coded MLUm / MLUw and % intelligible
 *    utterances for typically developing children, 2;6–8;11 in 6-month bands.
 *  - Pavelko & Owens (2017), LSHSS 48(3) (SUGAR): TNW per 50 utterances and clauses per
 *    sentence, 3;0–7;11 (conversation).
 *  - SALT database summaries (Miller et al.): % maze words ≈ 10–12% across ages (band only).
 *  - Clausal density bands for narrative / expository genres (Loban 1976; Nippold et al.
 *    2005/2009; Frizelle et al. 2018) are reference bands only — no z-score is computed.
 */

export type NormContext = 'conversation' | 'narrative' | 'expository';

export type NormStatus =
  | 'above' // > +1 SD in the favourable direction
  | 'wnl' // within normal limits (±1 SD)
  | 'borderline' // -1.0 to -1.5 SD (unfavourable direction)
  | 'significant' // ≤ -1.5 SD (unfavourable direction)
  | 'reference'; // band only, no SD available

export type NormMetricKey =
  | 'mluMorphemes'
  | 'mluWords'
  | 'clausalDensity'
  | 'totalWords'
  | 'mazeWordPercent'
  | 'intelligibility';

export interface NormComparison {
  key: NormMetricKey;
  label: string;
  /** Child's value as displayed (already scaled, e.g. TNW per 50 utterances). */
  value: number;
  valueLabel: string;
  /** Norm mean (or band midpoint for reference-only comparisons). */
  mean: number | null;
  sd: number | null;
  /** Human-readable normal range, e.g. "3.81 ± 0.69" or "1.40–1.70". */
  rangeLabel: string;
  /** Signed z-score in the metric's natural direction (positive = higher value). */
  z: number | null;
  status: NormStatus;
  /** Whether the norm was collected in the same sampling context as this sample. */
  contextMatch: boolean;
  /** Short citation (e.g. "Rice et al., 2010 · 4;0–4;5"). */
  source: string;
  /** Caveat shown to the clinician. */
  note?: string;
  /** Lower values are favourable (mazes). */
  lowerIsBetter?: boolean;
}

export interface NormsReport {
  ageMonths: number | null;
  ageLabel: string | null;
  context: NormContext;
  /** True when the context was inferred because the field was blank or unrecognised. */
  contextAssumed: boolean;
  contextLabel: string;
  sampleUtterances: number;
  /** Fewer than 50 C&I utterances — norms are less reliable. */
  smallSample: boolean;
  comparisons: NormComparison[];
  /** Why no comparisons could be produced (e.g. missing age). */
  unavailableReason?: string;
}

export const MIN_RELIABLE_UTTERANCES = 50;

// ---------------------------------------------------------------------------
// Age parsing
// ---------------------------------------------------------------------------

function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole months between two dates (SALT CA convention: completed months). */
export function monthsBetween(dob: Date, sample: Date): number | null {
  let months = (sample.getFullYear() - dob.getFullYear()) * 12 + (sample.getMonth() - dob.getMonth());
  if (sample.getDate() < dob.getDate()) months -= 1;
  return months >= 0 ? months : null;
}

/**
 * Parses SALT-style or free-text chronological age into total months.
 * Accepts "4;6", "4;6.12", "4:6", "4y 6m", "4 years 6 months", "54 months", "54m",
 * or a bare year "4". Decimal forms like "4.6" are rejected as ambiguous.
 */
export function parseAgeToMonths(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  // SALT convention: Y;M or Y;M.D (also tolerate Y:M)
  let m = /^(\d{1,2})\s*[;:]\s*(\d{1,2})(?:\.\d{1,2})?$/.exec(text);
  if (m) {
    const months = Number(m[2]);
    if (months > 11) return null;
    return Number(m[1]) * 12 + months;
  }

  // Months only: "54 months", "54 mo", "54m"
  m = /^(\d{1,3})\s*(?:m|mo|mos|month|months)$/.exec(text);
  if (m) return Number(m[1]);

  // "4y 6m", "4 years 6 months", "4 yrs, 6 mos"
  m = /^(\d{1,2})\s*(?:y|yr|yrs|year|years)[\s,]*(?:(\d{1,2})\s*(?:m|mo|mos|month|months))?$/.exec(text);
  if (m) {
    const months = m[2] ? Number(m[2]) : 0;
    if (months > 11) return null;
    return Number(m[1]) * 12 + months;
  }

  // Bare whole years: "4"
  m = /^(\d{1,2})$/.exec(text);
  if (m) return Number(m[1]) * 12;

  return null;
}

export function formatAgeMonths(months: number): string {
  return `${Math.floor(months / 12)};${months % 12}`;
}

/** Resolves age from the Age field, falling back to Date of Birth + Date of Sample. */
export function resolveAgeMonths(info: Pick<ClientInfo, 'age' | 'dateOfBirth' | 'dateOfSample'>): number | null {
  const fromField = parseAgeToMonths(info.age ?? '');
  if (fromField !== null) return fromField;
  const dob = parseIsoDate(info.dateOfBirth ?? '');
  const sample = parseIsoDate(info.dateOfSample ?? '');
  if (dob && sample) return monthsBetween(dob, sample);
  return null;
}

// ---------------------------------------------------------------------------
// Sampling context
// ---------------------------------------------------------------------------

export function classifySamplingContext(raw: string): { context: NormContext; assumed: boolean } {
  const text = raw.trim().toLowerCase();
  if (!text) return { context: 'conversation', assumed: true };
  if (/(exposit|persua|explain|favou?rite game|sport|procedur)/.test(text)) {
    return { context: 'expository', assumed: false };
  }
  if (/(narrat|retell|re-tell|story|stories|picture|wordless|frog|enni)/.test(text)) {
    return { context: 'narrative', assumed: false };
  }
  if (/(conver|play|free|interview|chat|talk)/.test(text)) {
    return { context: 'conversation', assumed: false };
  }
  return { context: 'conversation', assumed: true };
}

const CONTEXT_LABELS: Record<NormContext, string> = {
  conversation: 'Conversation / Play',
  narrative: 'Narrative',
  expository: 'Expository / Persuasive',
};

// ---------------------------------------------------------------------------
// Normative tables
// ---------------------------------------------------------------------------

interface AgeBand {
  minMonths: number;
  maxMonths: number; // inclusive
  label: string;
}

interface RiceRow extends AgeBand {
  mlum: [number, number];
  mluw: [number, number];
  intell: [number, number]; // percent
}

/** Rice et al. (2010), Tables 3 & 4 — unaffected (typically developing) children. */
export const RICE_2010_TD: readonly RiceRow[] = [
  { minMonths: 30, maxMonths: 35, label: '2;6–2;11', mlum: [3.23, 0.71], mluw: [2.91, 0.58], intell: [86, 11] },
  { minMonths: 36, maxMonths: 41, label: '3;0–3;5', mlum: [3.81, 0.69], mluw: [3.43, 0.61], intell: [91, 6] },
  { minMonths: 42, maxMonths: 47, label: '3;6–3;11', mlum: [4.09, 0.67], mluw: [3.71, 0.58], intell: [92, 9] },
  { minMonths: 48, maxMonths: 53, label: '4;0–4;5', mlum: [4.57, 0.76], mluw: [4.1, 0.65], intell: [91, 8] },
  { minMonths: 54, maxMonths: 59, label: '4;6–4;11', mlum: [4.75, 0.79], mluw: [4.28, 0.72], intell: [94, 6] },
  { minMonths: 60, maxMonths: 65, label: '5;0–5;5', mlum: [4.88, 0.72], mluw: [4.38, 0.63], intell: [94, 5] },
  { minMonths: 66, maxMonths: 71, label: '5;6–5;11', mlum: [4.96, 0.7], mluw: [4.47, 0.61], intell: [94, 5] },
  { minMonths: 72, maxMonths: 77, label: '6;0–6;5', mlum: [5.07, 0.75], mluw: [4.57, 0.66], intell: [93, 5] },
  { minMonths: 78, maxMonths: 83, label: '6;6–6;11', mlum: [5.22, 0.71], mluw: [4.7, 0.66], intell: [93, 7] },
  { minMonths: 84, maxMonths: 89, label: '7;0–7;5', mlum: [5.22, 0.91], mluw: [4.72, 0.83], intell: [94, 4] },
  { minMonths: 90, maxMonths: 95, label: '7;6–7;11', mlum: [5.45, 1.13], mluw: [4.92, 1.03], intell: [93, 6] },
  { minMonths: 96, maxMonths: 101, label: '8;0–8;5', mlum: [5.67, 0.97], mluw: [5.08, 0.84], intell: [95, 4] },
  { minMonths: 102, maxMonths: 107, label: '8;6–8;11', mlum: [5.51, 0.79], mluw: [4.99, 0.71], intell: [93, 6] },
];

interface SugarRow extends AgeBand {
  tnw: [number, number];
  cps: [number, number];
}

/** Pavelko & Owens (2017) SUGAR norms, 50 conversational utterances. */
export const SUGAR_2017: readonly SugarRow[] = [
  { minMonths: 36, maxMonths: 41, label: '3;0–3;5', tnw: [192.3, 61.22], cps: [1.09, 0.13] },
  { minMonths: 42, maxMonths: 47, label: '3;6–3;11', tnw: [244.05, 58.07], cps: [1.15, 0.11] },
  { minMonths: 48, maxMonths: 53, label: '4;0–4;5', tnw: [261.4, 69.98], cps: [1.19, 0.13] },
  { minMonths: 54, maxMonths: 59, label: '4;6–4;11', tnw: [278.71, 60.14], cps: [1.21, 0.11] },
  { minMonths: 60, maxMonths: 71, label: '5;0–5;11', tnw: [299.81, 61.46], cps: [1.29, 0.13] },
  { minMonths: 72, maxMonths: 83, label: '6;0–6;11', tnw: [337.73, 72.5], cps: [1.36, 0.14] },
  { minMonths: 84, maxMonths: 95, label: '7;0–7;11', tnw: [364.52, 54.24], cps: [1.39, 0.14] },
];

/** Miller & Chapman (1981) regression: predicted MLUm and SD from age in months (18–60). */
export function millerChapmanMlum(ageMonths: number): { mean: number; sd: number } {
  return {
    mean: -0.548 + 0.103 * ageMonths,
    sd: -0.0446 + 0.0205 * ageMonths,
  };
}

interface CdBand {
  minMonths: number;
  maxMonths: number;
  low: number;
  high: number;
  label: string;
}

/** Approximate clausal density bands by genre when no SD norm applies (reference only). */
const CD_GENRE_BANDS: Record<NormContext, readonly CdBand[]> = {
  conversation: [
    { minMonths: 96, maxMonths: 155, low: 1.3, high: 1.5, label: '8;0–12;11' },
    { minMonths: 156, maxMonths: 1200, low: 1.5, high: 1.6, label: '13+' },
  ],
  narrative: [
    { minMonths: 48, maxMonths: 59, low: 1.1, high: 1.2, label: '4;0–4;11' },
    { minMonths: 60, maxMonths: 95, low: 1.2, high: 1.4, label: '5;0–7;11' },
    { minMonths: 96, maxMonths: 155, low: 1.4, high: 1.6, label: '8;0–12;11' },
    { minMonths: 156, maxMonths: 1200, low: 1.6, high: 1.8, label: '13+' },
  ],
  expository: [
    { minMonths: 60, maxMonths: 95, low: 1.2, high: 1.4, label: '5;0–7;11' },
    { minMonths: 96, maxMonths: 155, low: 1.5, high: 1.7, label: '8;0–12;11' },
    { minMonths: 156, maxMonths: 1200, low: 1.6, high: 2.0, label: '13+' },
  ],
};

function findBand<T extends { minMonths: number; maxMonths: number }>(
  rows: readonly T[],
  ageMonths: number
): T | undefined {
  return rows.find((r) => ageMonths >= r.minMonths && ageMonths <= r.maxMonths);
}

/** Formats a signed z-score for display (e.g. "+0.42", "-1.80", or "—"). */
export function formatZScore(z: number | null): string {
  if (z === null) return '—';
  const sign = z > 0 ? '+' : '';
  return `${sign}${z.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function zScore(value: number, mean: number, sd: number): number {
  if (!(sd > 0)) return 0;
  return (value - mean) / sd;
}

/** SALT-style interpretation: ±1 SD WNL, -1 to -1.5 SD borderline, ≤ -1.5 SD significant. */
export function statusFromZ(z: number, lowerIsBetter = false): NormStatus {
  const favourable = lowerIsBetter ? -z : z;
  if (favourable <= -1.5) return 'significant';
  if (favourable < -1) return 'borderline';
  if (favourable > 1) return 'above';
  return 'wnl';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sdComparison(
  base: Omit<NormComparison, 'z' | 'status' | 'mean' | 'sd' | 'rangeLabel'>,
  mean: number,
  sd: number,
  digits = 2
): NormComparison {
  const z = round2(zScore(base.value, mean, sd));
  return {
    ...base,
    mean,
    sd,
    rangeLabel: `${mean.toFixed(digits)} ± ${sd.toFixed(digits)}`,
    z,
    status: statusFromZ(z, base.lowerIsBetter),
  };
}

export function compareToNorms(
  stats: SpeakerMetrics,
  info: Pick<ClientInfo, 'age' | 'dateOfBirth' | 'dateOfSample' | 'samplingContext'>
): NormsReport {
  const ageMonths = resolveAgeMonths(info);
  const { context, assumed } = classifySamplingContext(info.samplingContext ?? '');
  const sampleUtterances = stats.completeIntelligibleUtterances;

  const report: NormsReport = {
    ageMonths,
    ageLabel: ageMonths !== null ? formatAgeMonths(ageMonths) : null,
    context,
    contextAssumed: assumed,
    contextLabel: CONTEXT_LABELS[context],
    sampleUtterances,
    smallSample: sampleUtterances < MIN_RELIABLE_UTTERANCES,
    comparisons: [],
  };

  if (ageMonths === null) {
    report.unavailableReason =
      "Add the child's age (e.g. 4;6) or Date of Birth + Date of Sample in Client Info to compare against age norms.";
    return report;
  }
  if (sampleUtterances === 0) {
    report.unavailableReason = 'No complete & intelligible utterances yet — transcribe or label the child first.';
    return report;
  }

  const isConversation = context === 'conversation';
  const convNote = isConversation
    ? undefined
    : 'Norm collected in conversation/play; narrative and expository samples typically yield higher values.';

  // --- MLUm / MLUw --------------------------------------------------------
  const rice = findBand(RICE_2010_TD, ageMonths);
  if (rice) {
    report.comparisons.push(
      sdComparison(
        {
          key: 'mluMorphemes',
          label: 'MLUm',
          value: stats.mluMorphemes,
          valueLabel: stats.mluMorphemes.toFixed(2),
          contextMatch: isConversation,
          source: `Rice et al., 2010 · ${rice.label}`,
          note: convNote,
        },
        rice.mlum[0],
        rice.mlum[1]
      ),
      sdComparison(
        {
          key: 'mluWords',
          label: 'MLUw',
          value: stats.mluWords,
          valueLabel: stats.mluWords.toFixed(2),
          contextMatch: isConversation,
          source: `Rice et al., 2010 · ${rice.label}`,
          note: convNote,
        },
        rice.mluw[0],
        rice.mluw[1]
      )
    );
  } else if (ageMonths >= 18 && ageMonths < 30) {
    const mc = millerChapmanMlum(ageMonths);
    report.comparisons.push(
      sdComparison(
        {
          key: 'mluMorphemes',
          label: 'MLUm',
          value: stats.mluMorphemes,
          valueLabel: stats.mluMorphemes.toFixed(2),
          contextMatch: isConversation,
          source: `Miller & Chapman, 1981 · ${formatAgeMonths(ageMonths)}`,
          note: convNote,
        },
        round2(mc.mean),
        round2(mc.sd)
      )
    );
  }

  // --- Clausal density ----------------------------------------------------
  if (stats.clausalDensity !== null) {
    const cd = stats.clausalDensity;
    const sugarCd = isConversation ? findBand(SUGAR_2017, ageMonths) : undefined;
    if (sugarCd) {
      report.comparisons.push(
        sdComparison(
          {
            key: 'clausalDensity',
            label: 'Clausal Density',
            value: cd,
            valueLabel: cd.toFixed(2),
            contextMatch: true,
            source: `SUGAR (Pavelko & Owens, 2017) · ${sugarCd.label}`,
            note: 'SUGAR clauses-per-sentence counts only sentences containing a verb; SALT SI may run slightly lower.',
          },
          sugarCd.cps[0],
          sugarCd.cps[1]
        )
      );
    } else {
      const band = findBand(CD_GENRE_BANDS[context], ageMonths);
      if (band) {
        const status: NormStatus =
          cd < band.low ? 'borderline' : cd > band.high ? 'above' : 'wnl';
        report.comparisons.push({
          key: 'clausalDensity',
          label: 'Clausal Density',
          value: cd,
          valueLabel: cd.toFixed(2),
          mean: round2((band.low + band.high) / 2),
          sd: null,
          rangeLabel: `${band.low.toFixed(2)}–${band.high.toFixed(2)}`,
          z: null,
          status,
          contextMatch: true,
          source: `Loban 1976; Nippold 2005/09; Frizelle 2018 · ${band.label}`,
          note: 'Approximate genre band (no published SD) — interpret alongside other measures.',
        });
      }
    }
  }

  // --- TNW per 50 utterances (SUGAR) -------------------------------------
  const sugar = findBand(SUGAR_2017, ageMonths);
  if (sugar && stats.totalWords > 0) {
    const tnw50 = Math.round((stats.totalWords / sampleUtterances) * 50);
    report.comparisons.push(
      sdComparison(
        {
          key: 'totalWords',
          label: 'TNW / 50 utt',
          value: tnw50,
          valueLabel: String(tnw50),
          contextMatch: isConversation,
          source: `SUGAR (Pavelko & Owens, 2017) · ${sugar.label}`,
          note:
            'Scaled to 50 C&I utterances. SUGAR excludes single-word yes/no replies, so SALT-coded samples may run slightly lower.' +
            (convNote ? ` ${convNote}` : ''),
        },
        sugar.tnw[0],
        sugar.tnw[1],
        0
      )
    );
  }

  // --- % Maze words (band) ------------------------------------------------
  if (stats.allWords + stats.mazeWords > 0 && ageMonths >= 36) {
    const maze = stats.mazeWordPercent;
    const status: NormStatus = maze > 20 ? 'significant' : maze > 15 ? 'borderline' : 'wnl';
    report.comparisons.push({
      key: 'mazeWordPercent',
      label: '% Maze Words',
      value: maze,
      valueLabel: `${maze}%`,
      mean: 11,
      sd: null,
      rangeLabel: '≈10–12% (flag >15%)',
      z: null,
      status,
      contextMatch: true,
      source: 'SALT databases (Miller et al.)',
      note: 'Approximate across ages (3+) and contexts; >15% suggests formulation or word-finding load.',
      lowerIsBetter: true,
    });
  }

  // --- Intelligibility (C&I %) -------------------------------------------
  if (rice && stats.totalUtterances > 0) {
    const pct = Math.round((stats.completeIntelligibleUtterances / stats.totalUtterances) * 100);
    report.comparisons.push(
      sdComparison(
        {
          key: 'intelligibility',
          label: 'Intelligibility',
          value: pct,
          valueLabel: `${pct}%`,
          contextMatch: true,
          source: `Rice et al., 2010 · ${rice.label}`,
          note: 'Estimated from C&I ÷ total utterances; abandoned/interrupted utterances also lower this value.',
        },
        rice.intell[0],
        rice.intell[1],
        0
      )
    );
  }

  if (report.comparisons.length === 0) {
    report.unavailableReason = `No published norms in Saltify cover age ${formatAgeMonths(ageMonths)} for ${CONTEXT_LABELS[context].toLowerCase()} samples.`;
  }

  return report;
}

export const NORM_STATUS_LABELS: Record<NormStatus, string> = {
  above: 'Above',
  wnl: 'WNL',
  borderline: 'Borderline',
  significant: 'Significant',
  reference: 'Reference',
};
