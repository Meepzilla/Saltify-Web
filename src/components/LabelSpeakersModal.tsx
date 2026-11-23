import { useMemo, useState } from 'react';
import { Users, X } from 'lucide-react';
import type { SpeakerAliases } from '../types/session';
import { applySpeakerLabelsToLines, parseTranscriptLines } from '../lib/salt/speakers';

interface LabelSpeakersModalProps {
  transcriptText: string;
  aliases: SpeakerAliases;
  onApply: (updatedTranscript: string) => void;
  onClose: () => void;
}

export function LabelSpeakersModal({
  transcriptText,
  aliases,
  onApply,
  onClose,
}: LabelSpeakersModalProps) {
  const [workingText, setWorkingText] = useState(transcriptText);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
  };

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
            <span style={{ fontSize: 12.5, color: 'var(--ink-secondary)' }}>
              Select utterance lines below and assign them to a speaker ({selected.size} selected).
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
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
