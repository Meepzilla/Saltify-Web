import { useMemo, useState } from 'react';
import { ArrowLeftRight, Sparkles, Users, X } from 'lucide-react';
import type { SpeakerAliases } from '../types/session';
import {
  applySpeakerLabelsToLines,
  parseTranscriptLines,
  swapSpeakersInText,
} from '../lib/salt/speakers';
import { decodeAudioBlob, prepareWhisperAudio } from '../lib/audio/wavEncoder';
import { autoAssignSpeakersInTranscript } from '../lib/audio/speakerDiarizer';

interface LabelSpeakersModalProps {
  transcriptText: string;
  aliases: SpeakerAliases;
  audioBlob?: Blob | null;
  onApply: (updatedTranscript: string) => void;
  onClose: () => void;
}

export function LabelSpeakersModal({
  transcriptText,
  aliases,
  audioBlob,
  onApply,
  onClose,
}: LabelSpeakersModalProps) {
  const [workingText, setWorkingText] = useState(transcriptText);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const lines = useMemo(
    () => parseTranscriptLines(workingText, aliases).filter((l) => l.raw.trim()),
    [workingText, aliases]
  );

  const toggleIndex = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectUnlabeled = () => {
    const next = new Set<number>();
    for (const line of lines) {
      if (line.speakerRole === 'none') next.add(line.index);
    }
    setSelected(next);
  };

  const applyRole = (role: 'speaker1' | 'speaker2' | 'none') => {
    if (selected.size === 0) return;
    const updated = applySpeakerLabelsToLines(workingText, selected, role, aliases);
    setWorkingText(updated);
    onApply(updated);
    setSelected(new Set());
    setStatusMessage(null);
  };

  const handleAutoAssign = async () => {
    if (lines.length === 0 || isAutoAssigning) return;
    setIsAutoAssigning(true);
    setStatusMessage(null);

    try {
      let audio16k: Float32Array | null = null;
      if (audioBlob) {
        try {
          const decoded = await decodeAudioBlob(audioBlob);
          audio16k = await prepareWhisperAudio(decoded);
        } catch {
          // Fall back cleanly to conversational/clinical cues if audio decode fails
          audio16k = null;
        }
      }

      const result = autoAssignSpeakersInTranscript(workingText, aliases, audio16k);
      setWorkingText(result.transcript);
      onApply(result.transcript);
      setSelected(new Set());

      const methodLabel =
        result.method === 'acoustic'
          ? 'voice & conversational analysis'
          : 'conversational & clinical cues';
      setStatusMessage(
        result.speakerCount === 2
          ? `Auto-assigned 2 speakers (${aliases.speaker1 || 'C'} / ${aliases.speaker2 || 'E'}) using ${methodLabel}.`
          : `Detected 1 primary speaker (${aliases.speaker1 || 'C'}) using ${methodLabel}.`
      );
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleSwapSpeakers = () => {
    const swapped = swapSpeakersInText(workingText, aliases);
    setWorkingText(swapped);
    onApply(swapped);
    setStatusMessage(
      `Swapped ${aliases.speaker1 || 'C'} ↔ ${aliases.speaker2 || 'E'} across all labeled lines.`
    );
  };

  const hasLabeledLines = lines.some((l) => l.speakerRole !== 'none');

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-label-speakers-title">
      <div className="modal-dialog is-wide">
        <div className="modal-header">
          <h2 id="modal-label-speakers-title" className="modal-title">
            <Users size={18} aria-hidden="true" />
            Label Speakers
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                id="btn-auto-assign-speakers"
                type="button"
                className="btn btn-sm btn-primary"
                disabled={lines.length === 0 || isAutoAssigning}
                onClick={handleAutoAssign}
                title="Automatically assign Child and Examiner speakers using on-device voice analysis and conversational cues"
              >
                <Sparkles size={13} aria-hidden="true" />
                {isAutoAssigning ? 'Analyzing...' : 'Auto-Assign Speakers'}
              </button>
              <button
                id="btn-swap-speakers"
                type="button"
                className="btn btn-sm"
                disabled={!hasLabeledLines || isAutoAssigning}
                onClick={handleSwapSpeakers}
                title={`Swap ${aliases.speaker1 || 'C'} and ${aliases.speaker2 || 'E'} across all labeled utterances`}
              >
                <ArrowLeftRight size={13} aria-hidden="true" />
                Swap {aliases.speaker1 || 'C'} ↔ {aliases.speaker2 || 'E'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={selectUnlabeled}>
                Select Unlabeled
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelected(new Set(lines.map((l) => l.index)))}
              >
                Select All
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          </div>

          <span style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
            {statusMessage ??
              `Select utterance lines below to refine speaker labels manually (${selected.size} selected).`}
          </span>

          <div className="speaker-list">
            {lines.map((line) => {
              const isSelected = selected.has(line.index);
              const roleClass =
                line.speakerRole === 'speaker1'
                  ? 'is-speaker1'
                  : line.speakerRole === 'speaker2'
                    ? 'is-speaker2'
                    : '';
              return (
                <label
                  key={line.index}
                  className={`speaker-check-row ${isSelected ? 'is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleIndex(line.index)}
                  />
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    {line.timestampLabel && <span className="ts-chip">{line.timestampLabel}</span>}
                    {line.speakerLabel && (
                      <span className={`speaker-tag ${roleClass}`}>{line.speakerLabel}</span>
                    )}
                    <span>{line.content}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-speaker1"
              disabled={selected.size === 0}
              onClick={() => applyRole('speaker1')}
            >
              Label as {aliases.speaker1 || 'C'}
            </button>
            <button
              type="button"
              className="btn btn-speaker2"
              disabled={selected.size === 0}
              onClick={() => applyRole('speaker2')}
            >
              Label as {aliases.speaker2 || 'E'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={selected.size === 0}
              onClick={() => applyRole('none')}
            >
              Remove Label
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
