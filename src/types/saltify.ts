export type ThemeMode = 'system' | 'light' | 'dark';

export type WhisperModelId =
  | 'onnx-community/whisper-tiny.en'
  | 'onnx-community/whisper-base.en'
  | 'onnx-community/whisper-small.en';

export type ComputeDevice = 'auto' | 'webgpu' | 'wasm';

export type ModelSource = 'auto' | 'local-only' | 'huggingface';

export interface WhisperModelInfo {
  id: WhisperModelId;
  label: string;
  shortLabel: string;
  sizeLabel: string;
  sizeMb: number;
  recommendedFor: string;
  description: string;
}

export const WHISPER_MODELS: readonly WhisperModelInfo[] = [
  {
    id: 'onnx-community/whisper-tiny.en',
    label: 'Whisper Tiny (English)',
    shortLabel: 'Tiny .en',
    sizeLabel: '~38 MB',
    sizeMb: 38,
    recommendedFor: 'iPad, Android phones & quick offline sessions',
    description: 'Fastest on-device transcription with minimal RAM usage. Safe for iPadOS Safari and mobile devices.',
  },
  {
    id: 'onnx-community/whisper-base.en',
    label: 'Whisper Base (English)',
    shortLabel: 'Base .en',
    sizeLabel: '~73 MB',
    sizeMb: 73,
    recommendedFor: 'iPad Pro, modern Android tablets & laptops',
    description: 'Balanced accuracy and speed for clinical child-examiner conversations.',
  },
  {
    id: 'onnx-community/whisper-small.en',
    label: 'Whisper Small (English)',
    shortLabel: 'Small .en',
    sizeLabel: '~237 MB',
    sizeMb: 237,
    recommendedFor: 'Windows PCs & high-RAM devices (desktop Saltify parity)',
    description: 'Highest accuracy, matching the desktop Saltify small.en model. Best on Windows laptops/desktops.',
  },
] as const;

export interface ClientInfo {
  name: string;
  age: string;
  gender: string;
  dateOfBirth: string;
  dateOfSample: string;
  examinerName: string;
  samplingContext: string;
}

export const EMPTY_CLIENT_INFO: ClientInfo = {
  name: '',
  age: '',
  gender: '',
  dateOfBirth: '',
  dateOfSample: '',
  examinerName: '',
  samplingContext: '',
};

export interface SpeakerAliases {
  speaker1: string;
  speaker2: string;
}

export const DEFAULT_SPEAKER_ALIASES: SpeakerAliases = {
  speaker1: 'C',
  speaker2: 'E',
};

export interface AudioMetadata {
  fileName: string;
  mimeType: string;
  duration: number;
  sampleRate: number;
  sizeBytes: number;
  waveformPeaks: number[];
}

export interface SessionRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  clientInfo: ClientInfo;
  speakerAliases: SpeakerAliases;
  audioMeta: AudioMetadata | null;
  hasAudioBlob: boolean;
  transcriptionText: string;
  conventionText: string;
  grammarCheckPerformed: boolean;
  morphemesApplied: boolean;
  notes: string;
}

export interface UtteranceLine {
  index: number;
  raw: string;
  timestampStr: string | null;
  timestampSec: number | null;
  speaker: string | null;
  speakerSlot: 'speaker1' | 'speaker2' | null;
  body: string;
}

export type InlineClauseTag = 'MC' | 'SC' | 'RC' | 'AC' | 'NC' | 'CL';

export interface SiDistribution {
  si0: number;
  si1: number;
  si2: number;
  si3Plus: number;
  siX: number;
}

export interface SpeakerMetrics {
  speaker: string;
  totalUtterances: number;
  completeIntelligibleUtterances: number;
  totalWords: number;
  uniqueWords: number;
  typeTokenRatio: number;
  mluWords: number;
  totalMorphemes: number;
  boundMorphemes: number;
  mluMorphemes: number;
  mazeCount: number;
  mazeWords: number;
  mazeWordPercent: number;
  errorCount: number;
  omissionCount: number;
  wordsPerMinute: number | null;
  totalClauses: number;
  clauseScoredUtterances: number;
  clauseExcludedUtterances: number;
  clausalDensity: number | null;
  complexUtterances: number;
  complexUtterancePercent: number;
  siDistribution: SiDistribution;
}

export interface TranscriptMetrics {
  overall: SpeakerMetrics;
  speaker1: SpeakerMetrics;
  speaker2: SpeakerMetrics;
  unlabeledUtterances: number;
  durationSeconds: number | null;
}

export interface GrammarCheckOptions {
  checkAllSentences: boolean;
  codeFillerMazes: boolean;
  useOverregularizationTag: boolean;
}

export interface ProcessingState {
  kind: 'transcription' | 'grammar' | 'model-download';
  stage: string;
  progress: number; // 0..1
  detail?: string;
}

export type AppView = 'workspace' | 'settings';

export type SettingsTab = 'general' | 'models' | 'salt' | 'changelog';

export interface AppSettings {
  theme: ThemeMode;
  modelId: WhisperModelId;
  device: ComputeDevice;
  modelSource: ModelSource;
  customModelBaseUrl: string;
  playbackVolume: number; // Gain multiplier: 0.0 to 4.0 (1.0 = 100%, 4.0 = 400% / +12 dB)
  codeFillerMazes: boolean;
  useOverregularizationTag: boolean;
  includeSaltHeadersOnExport: boolean;
  stripTimestampsOnExport: boolean;
  defaultSpeakerAliases: SpeakerAliases;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  modelId: 'onnx-community/whisper-tiny.en',
  device: 'auto',
  modelSource: 'auto',
  customModelBaseUrl: '',
  playbackVolume: 1.5,
  codeFillerMazes: true,
  useOverregularizationTag: false,
  includeSaltHeadersOnExport: true,
  stripTimestampsOnExport: true,
  defaultSpeakerAliases: { ...DEFAULT_SPEAKER_ALIASES },
};

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
}
