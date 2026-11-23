import { CheckSquare, Square, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  applySpeakerLabelsToLines,
  parseUtteranceLines,
} from '../engine/transcriptFormat';
import type { SpeakerAliases } from '../types/saltify';

interface LabelSpeakersModalProps {
  open: boolean;
  text: string;
  aliases: SpeakerAliases;
  onApplyText: (nextText: string) => void;
  onClose: () => void;
}

export function LabelSpeakersModal({
  open,
  text,
  aliases,
  onApplyText,
  onClose,
}: LabelSpeakersModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const lines = useMemo(
    () =>
      parseUtteranceLines(text, aliases).filter((l) => l.raw.trim().length > 0),
    [text, aliases]
  );

  if (!open) return null;

  const toggleIndex = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectUnlabeled = () => {
    setSelected(new Set(lines.filter((l) => l.speakerSlot === null).map((l) => l.index)));
  };

  const applyToSelected = (speaker: string | null) => {
    if (selected.size === 0) return;
    const updated = applySpeakerLabelsToLines(text, selected, speaker, aliases);
    onApplyText(updated);
    setSelected(new Set());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-speakers-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="label-speakers-title" className="modal-title">
            Label Speakers
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Select utterances below and assign them to{' '}
              <strong style={{ color: 'var(--speaker1)' }}>{aliases.speaker1}</strong> or{' '}
              <strong style={{ color: 'var(--speaker2)' }}>{aliases.speaker2}</strong>.
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                onClick={selectUnlabeled}
              >
                Select Unlabeled
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                onClick={() =>
                  setSelected(
                    selected.size === lines.length
                      ? new Set()
                      : new Set(lines.map((l) => l.index))
                  )
                }
              >
                {selected.size === lines.length ? 'Clear Selection' : 'Select All'}
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: '46dvh',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {lines.map((line) => {
              const isChecked = selected.has(line.index);
              return (
                <button
                  key={line.index}
                  type="button"
                  className={`utterance-row ${line.speakerSlot ?? ''}`}
                  style={{
                    textAlign: 'left',
                    width: '100%',
                    background: isChecked ? 'var(--accent-soft)' : undefined,
                  }}
                  onClick={() => toggleIndex(line.index)}
                >
                  <span style={{ color: isChecked ? 'var(--accent)' : 'var(--text-muted)', marginTop: 2 }}>
                    {isChecked ? <CheckSquare size={17} /> : <Square size={17} />}
                  </span>
                  {line.timestampStr && (
                    <span className="utterance-ts-btn">{line.timestampStr}</span>
                  )}
                  <span className={`speaker-pill-btn ${line.speakerSlot ?? ''}`}>
                    {line.speaker ?? '—'}
                  </span>
                  <span
                    className="utterance-text"
                    style={{
                      color:
                        line.speakerSlot === 'speaker1'
                          ? 'var(--speaker1)'
                          : line.speakerSlot === 'speaker2'
                          ? 'var(--speaker2)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {line.body}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={selected.size === 0}
              onClick={() => applyToSelected(null)}
            >
              Clear Label
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--speaker1)', color: '#ffffff' }}
              disabled={selected.size === 0}
              onClick={() => applyToSelected(aliases.speaker1)}
            >
              Label as {aliases.speaker1}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--speaker2)', color: '#ffffff' }}
              disabled={selected.size === 0}
              onClick={() => applyToSelected(aliases.speaker2)}
            >
              Label as {aliases.speaker2}
            </button>
            <button type="button" className="btn btn-subtle btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AliasesModalProps {
  open: boolean;
  aliases: SpeakerAliases;
  onSave: (nextAliases: SpeakerAliases) => void;
  onClose: () => void;
}

export function SpeakerAliasesModal({
  open,
  aliases,
  onSave,
  onClose,
}: AliasesModalProps) {
  const [speaker1, setSpeaker1] = useState(aliases.speaker1);
  const [speaker2, setSpeaker2] = useState(aliases.speaker2);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      speaker1: speaker1.trim() || 'C',
      speaker2: speaker2.trim() || 'E',
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aliases-modal-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <h2 id="aliases-modal-title" className="modal-title">
            Customize Speaker Aliases
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Standard SALT conventions use <strong>C</strong> (Child) and <strong>E</strong>{' '}
            (Examiner). Changing an alias automatically updates all existing speaker
            labels in this session.
          </p>

          <div className="form-field">
            <label
              htmlFor="speaker1-alias-input"
              className="form-label"
              style={{ color: 'var(--speaker1)' }}
            >
              Speaker 1 Alias (Child)
            </label>
            <input
              id="speaker1-alias-input"
              type="text"
              className="field-input"
              value={speaker1}
              onChange={(e) => setSpeaker1(e.target.value)}
              placeholder="C"
            />
          </div>

          <div className="form-field">
            <label
              htmlFor="speaker2-alias-input"
              className="form-label"
              style={{ color: 'var(--speaker2)' }}
            >
              Speaker 2 Alias (Examiner)
            </label>
            <input
              id="speaker2-alias-input"
              type="text"
              className="field-input"
              value={speaker2}
              onChange={(e) => setSpeaker2(e.target.value)}
              placeholder="E"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSpeaker1('C');
              setSpeaker2('E');
            }}
          >
            Reset to C / E
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            Apply Aliases
          </button>
        </div>
      </form>
    </div>
  );
}
