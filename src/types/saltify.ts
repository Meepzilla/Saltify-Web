export type ThemeMode = 'system' | 'light' | 'dark';

export type WhisperModelId =
  | 'onnx-community/whisper-tiny.en'
  | 'onnx-community/whisper-base.en'
  | 'onnx-community/whisper-small.en';

export type ComputeDevice = 'auto' | 'webgpu' | 'wasm';

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
    sizeLabel: '~42 MB',
    sizeMb: 42,
    recommendedFor: 'iPad, Android phones & quick offline sessions',
    description: 'Fastest on-device transcription with minimal RAM usage. Safe for iPadOS Safari and mobile devices.',
  },
  {
    id: 'onnx-community/whisper-base.en',
    label: 'Whisper Base (English)',
    shortLabel: 'Base .en',
    sizeLabel: '~78 MB',
    sizeMb: 78,
    recommendedFor: 'iPad Pro, modern Android tablets & laptops',
    description: 'Balanced accuracy and speed for clinical child-examiner conversations.',
  },
  {
    id: 'onnx-community/whisper-small.en',
    label: 'Whisper Small (English)',
    shortLabel: 'Small .en',
    sizeLabel: '~245 MB',
    sizeMb: 245,
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
}

export interface TranscriptMetrics {
  overall: SpeakerMetrics;
  speaker1: SpeakerMetrics;
  speaker2: SpeakerMetrics;
  unlabeledUtterances: number;
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

export interface AppSettings {
  theme: ThemeMode;
  modelId: WhisperModelId;
  device: ComputeDevice;
  codeFillerMazes: boolean;
  useOverregularizationTag: boolean;
  includeSaltHeadersOnExport: boolean;
  stripTimestampsOnExport: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  modelId: 'onnx-community/whisper-tiny.en',
  device: 'auto',
  codeFillerMazes: true,
  useOverregularizationTag: false,
  includeSaltHeadersOnExport: true,
  stripTimestampsOnExport: true,
};

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
}
