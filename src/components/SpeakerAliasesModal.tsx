import { useState, type FormEvent } from 'react';
import { Tag, X } from 'lucide-react';
import type { SpeakerAliases } from '../types/session';

interface SpeakerAliasesModalProps {
  aliases: SpeakerAliases;
  onSave: (nextAliases: SpeakerAliases) => void;
  onClose: () => void;
}

export function SpeakerAliasesModal({ aliases, onSave, onClose }: SpeakerAliasesModalProps) {
  const [speaker1, setSpeaker1] = useState(aliases.speaker1);
  const [speaker2, setSpeaker2] = useState(aliases.speaker2);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      speaker1: speaker1.trim() || 'C',
      speaker2: speaker2.trim() || 'E',
    });
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-aliases-title">
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 id="modal-aliases-title" className="modal-title">
            <Tag size={18} aria-hidden="true" />
            Customize Speaker Aliases
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)' }}>
              Standard SALT software expects <strong>C</strong> (Child) and <strong>E</strong> (Examiner). Changing aliases updates all labeled utterances in this session.
            </p>

            <div className="form-field">
              <label htmlFor="input-alias-1" className="form-label" style={{ color: 'var(--speaker1-color)' }}>
                Speaker 1 Alias (Child)
              </label>
              <input
                id="input-alias-1"
                type="text"
                className="text-input"
                value={speaker1}
                onChange={(e) => setSpeaker1(e.target.value)}
                placeholder="C"
              />
            </div>

            <div className="form-field">
              <label htmlFor="input-alias-2" className="form-label" style={{ color: 'var(--speaker2-color)' }}>
                Speaker 2 Alias (Examiner / Adult)
              </label>
              <input
                id="input-alias-2"
                type="text"
                className="text-input"
                value={speaker2}
                onChange={(e) => setSpeaker2(e.target.value)}
                placeholder="E"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSpeaker1('C');
                setSpeaker2('E');
              }}
            >
              Reset to C / E
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Apply Aliases
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
