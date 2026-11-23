export type ThemePreference = 'light' | 'dark' | 'system';

export type WhisperModelId =
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small.en';

export interface WhisperModelInfo {
  id: WhisperModelId;
  label: string;
  sizeLabel: string;
  recommendedFor: string;
}

export const WHISPER_MODELS: readonly WhisperModelInfo[] = [
  {
    id: 'Xenova/whisper-tiny.en',
    label: 'Whisper Tiny (English)',
    sizeLabel: '~40 MB',
    recommendedFor: 'Fastest — best for iPads & Android phones',
  },
  {
    id: 'Xenova/whisper-base.en',
    label: 'Whisper Base (English)',
    sizeLabel: '~75 MB',
    recommendedFor: 'Balanced accuracy — modern iPads & laptops',
  },
  {
    id: 'Xenova/whisper-small.en',
    label: 'Whisper Small (English)',
    sizeLabel: '~240 MB',
    recommendedFor: 'Highest accuracy — matches Saltify desktop on Windows/Mac',
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

export interface SpeakerAliases {
  speaker1: string;
  speaker2: string;
}

export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  audioDuration: number;
  hasAudio: boolean;
  transcriptionText: string;
  conventionText: string;
  transcriptionLocked: boolean;
  conventionLocked: boolean;
  grammarCheckPerformed: boolean;
  morphemesAdded: boolean;
  speakerAliases: SpeakerAliases;
  clientInfo: ClientInfo;
}

export interface GrammarSessionState {
  active: boolean;
  sentences: string[];
  currentIndex: number;
  totalSentences: number;
  currentSuggestion: string;
  currentOriginal: string;
  currentReasons: string[];
}

export interface ProcessingState {
  kind: 'transcription' | 'grammar' | null;
  stage: string;
  progress: number; // 0..1
  cancellable: boolean;
}

export interface SaltMetrics {
  totalUtterances: number;
  totalWords: number;
  uniqueWords: number;
  typeTokenRatio: number;
  mluWords: number;
  mluMorphemes: number;
  totalMorphemes: number;
  mazeCount: number;
  errorCodeCount: number;
}

export function createDefaultClientInfo(): ClientInfo {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: '',
    age: '',
    gender: '',
    dateOfBirth: '',
    dateOfSample: today,
    examinerName: '',
    samplingContext: 'Conversation',
  };
}

export function createDefaultSpeakerAliases(): SpeakerAliases {
  return {
    speaker1: 'C',
    speaker2: 'E',
  };
}
