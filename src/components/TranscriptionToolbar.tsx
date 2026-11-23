import { useMemo } from 'react';
import {
  CheckCircle2,
  Cpu,
  Sparkles,
  Square,
  Tag,
  Users,
  Wand2,
} from 'lucide-react';
import { WHISPER_MODELS, type ProcessingState, type WhisperModelId } from '../types/session';
import { isAppleTouchDevice, resolveSafeWhisperModel } from '../lib/storage/sessionStore';

interface TranscriptionToolbarProps {
  hasAudio: boolean;
  hasTranscript: boolean;
  hasConventions: boolean;
  isRecording: boolean;
  grammarActive: boolean;
  processing: ProcessingState;
  whisperModel: WhisperModelId;
  onChangeWhisperModel: (model: WhisperModelId) => void;
  onToggleTranscribe: () => void;
  onOpenLabelSpeakers: () => void;
  onOpenAliases: () => void;
  onToggleGrammarCheck: () => void;
  onAddMorphemes: () => void;
}

export function TranscriptionToolbar({
  hasAudio,
  hasTranscript,
  hasConventions,
  isRecording,
  grammarActive,
  processing,
  whisperModel,
  onChangeWhisperModel,
  onToggleTranscribe,
  onOpenLabelSpeakers,
  onOpenAliases,
  onToggleGrammarCheck,
  onAddMorphemes,
}: TranscriptionToolbarProps) {
  const isTranscribing = processing.kind === 'transcription';
  const isBusy = processing.kind !== null || isRecording;

  const availableModels = useMemo(() => {
    const appleTouch = isAppleTouchDevice();
    return WHISPER_MODELS.filter((m) => !(appleTouch && m.desktopOnly));
  }, []);

  const selectedModel = resolveSafeWhisperModel(whisperModel);

  return (
    <section className="card workflow-bar" aria-label="Transcription and SALT analysis tools">
      <div className="workflow-controls">
        <div className="workflow-group">
          <button
            id="btn-transcribe"
            type="button"
            className={`btn ${isTranscribing ? 'btn-danger' : 'btn-primary'}`}
            disabled={(!hasAudio && !isTranscribing) || isRecording || processing.kind === 'grammar'}
            onClick={onToggleTranscribe}
          >
            {isTranscribing ? (
              <>
                <Square size={14} aria-hidden="true" />
                Cancel Transcription
              </>
            ) : (
              <>
                <Cpu size={15} aria-hidden="true" />
                Transcribe Audio
              </>
            )}
          </button>

          <select
            id="select-whisper-model"
            className="model-picker"
            value={selectedModel}
            disabled={isBusy}
            onChange={(e) => onChangeWhisperModel(e.target.value as WhisperModelId)}
            aria-label="On-device Whisper speech model"
            title="Select on-device Whisper model (cached locally after first download)"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.sizeLabel})
              </option>
            ))}
          </select>
        </div>

        <div className="workflow-group">
          <button
            id="btn-label-speakers"
            type="button"
            className="btn"
            disabled={!hasTranscript || isBusy}
            onClick={onOpenLabelSpeakers}
            title="Assign Child / Examiner speaker labels to utterances"
          >
            <Users size={15} aria-hidden="true" />
            Label Speakers
          </button>

          <button
            id="btn-speaker-aliases"
            type="button"
            className="btn"
            disabled={isBusy}
            onClick={onOpenAliases}
            title="Customize speaker prefixes (default: C and E)"
          >
            <Tag size={15} aria-hidden="true" />
            Aliases
          </button>

          <button
            id="btn-grammar-check"
            type="button"
            className={`btn ${grammarActive ? 'btn-soft-danger' : ''}`}
            disabled={(!hasTranscript && !grammarActive) || isBusy}
            onClick={onToggleGrammarCheck}
            title="Step through child language grammar errors and generate SALT error codes"
          >
            <CheckCircle2 size={15} aria-hidden="true" />
            {grammarActive ? 'End Grammar Check' : 'Grammar Check'}
          </button>

          <button
            id="btn-add-morphemes"
            type="button"
            className="btn"
            disabled={(!hasConventions && !hasTranscript) || isBusy || grammarActive}
            onClick={onAddMorphemes}
            title="Add SALT bound inflectional morphemes (/s, /z, /ed, /3s, /ing, contractions)"
          >
            <Wand2 size={15} aria-hidden="true" />
            Add Morphemes
          </button>
        </div>
      </div>

      {processing.kind !== null && (
        <div className="progress-strip" role="status" aria-live="polite">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, Math.min(100, Math.round(processing.progress * 100)))}%` }}
            />
          </div>
          <div className="progress-meta">
            <span>
              <Sparkles size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} aria-hidden="true" />
              {processing.stage}
            </span>
            <span>{Math.round(processing.progress * 100)}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
