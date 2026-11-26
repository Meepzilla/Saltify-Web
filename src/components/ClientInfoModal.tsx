import { X } from 'lucide-react';
import { useState } from 'react';
import { buildSaltHeader } from '../engine/transcriptFormat';
import type { ClientInfo, SpeakerAliases } from '../types/saltify';

interface ClientInfoModalProps {
  open: boolean;
  clientInfo: ClientInfo;
  aliases: SpeakerAliases;
  /** Session vocabulary used as a Whisper hint (names, story words). */
  vocabulary?: string;
  onSave: (info: ClientInfo, vocabulary: string) => void;
  onClose: () => void;
}

const CONTEXT_PRESETS = [
  'Conversation',
  'Narrative Retell',
  'Play',
  'Expository',
  'Persuasion',
  'Picture Description',
];

export function ClientInfoModal({
  open,
  clientInfo,
  aliases,
  vocabulary = '',
  onSave,
  onClose,
}: ClientInfoModalProps) {
  const [draft, setDraft] = useState<ClientInfo>(clientInfo);
  const [vocab, setVocab] = useState(vocabulary);

  if (!open) return null;

  const update = (key: keyof ClientInfo, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draft, vocab.trim());
    onClose();
  };

  const previewHeader = buildSaltHeader(draft, aliases);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-info-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <h2 id="client-info-title" className="modal-title">
            Client &amp; Sample Info (SALT Header)
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
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Stored strictly on this device in local browser storage. For clinical
            de-identification, you may enter a Client ID instead of a full name.
          </p>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="ci-name" className="form-label">
                Name / Client ID
              </label>
              <input
                id="ci-name"
                type="text"
                className="field-input"
                value={draft.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Client_042"
              />
            </div>

            <div className="form-field">
              <label htmlFor="ci-age" className="form-label">
                Age (CA, e.g. 4;6)
              </label>
              <input
                id="ci-age"
                type="text"
                className="field-input"
                value={draft.age}
                onChange={(e) => update('age', e.target.value)}
                placeholder="e.g. 4;6"
              />
            </div>

            <div className="form-field">
              <label htmlFor="ci-gender" className="form-label">
                Gender
              </label>
              <input
                id="ci-gender"
                type="text"
                className="field-input"
                value={draft.gender}
                onChange={(e) => update('gender', e.target.value)}
                placeholder="e.g. F, M, Non-binary"
              />
            </div>

            <div className="form-field">
              <label htmlFor="ci-examiner" className="form-label">
                Examiner Name
              </label>
              <input
                id="ci-examiner"
                type="text"
                className="field-input"
                value={draft.examinerName}
                onChange={(e) => update('examinerName', e.target.value)}
                placeholder="SLP Name"
              />
            </div>

            <div className="form-field">
              <label htmlFor="ci-dob" className="form-label">
                Date of Birth
              </label>
              <input
                id="ci-dob"
                type="date"
                className="field-input"
                value={draft.dateOfBirth}
                onChange={(e) => update('dateOfBirth', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="ci-sample-date" className="form-label">
                Date of Sample
              </label>
              <input
                id="ci-sample-date"
                type="date"
                className="field-input"
                value={draft.dateOfSample}
                onChange={(e) => update('dateOfSample', e.target.value)}
              />
            </div>

            <div className="form-field full">
              <label htmlFor="ci-context" className="form-label">
                Sampling Context
              </label>
              <input
                id="ci-context"
                type="text"
                className="field-input"
                list="sampling-context-presets"
                value={draft.samplingContext}
                onChange={(e) => update('samplingContext', e.target.value)}
                placeholder="e.g. Narrative Retell, Conversation, Play"
              />
              <datalist id="sampling-context-presets">
                {CONTEXT_PRESETS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="ci-vocabulary" className="form-label">
              Expected words (helps transcription)
            </label>
            <textarea
              id="ci-vocabulary"
              className="field-input vocabulary-input"
              rows={2}
              value={vocab}
              onChange={(e) => setVocab(e.target.value)}
              placeholder="e.g. Maya, Grandma Rosa, frog, jar, gopher, beehive, owl"
            />
            <span className="field-help">
              Names and story words you expect in this sample, separated by commas. Whisper is
              more likely to spell them correctly. Leave empty if unsure: unrelated words can
              make noisy recordings worse. Used the next time you transcribe.
            </span>
          </div>

          <div className="form-field">
            <span className="form-label">SALT Header Preview</span>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.78rem',
                whiteSpace: 'pre-wrap',
                color: 'var(--text-secondary)',
              }}
            >
              {previewHeader}
            </pre>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            Save Client Info
          </button>
        </div>
      </form>
    </div>
  );
}
