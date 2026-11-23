import { useState, type FormEvent } from 'react';
import { UserRound, X } from 'lucide-react';
import type { ClientInfo } from '../types/session';

interface ClientInfoModalProps {
  clientInfo: ClientInfo;
  onSave: (info: ClientInfo) => void;
  onClose: () => void;
}

const CONTEXT_PRESETS = [
  'Conversation',
  'Narration',
  'Play',
  'Expository',
  'Persuasion',
  'Story Retell',
];

export function ClientInfoModal({ clientInfo, onSave, onClose }: ClientInfoModalProps) {
  const [form, setForm] = useState<ClientInfo>(clientInfo);

  const update = (key: keyof ClientInfo, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-client-title">
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 id="modal-client-title" className="modal-title">
            <UserRound size={18} aria-hidden="true" />
            Client &amp; Sample Information
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-secondary)' }}>
              Stored exclusively in this browser (never uploaded). Included as header fields when exporting to <strong>.slt</strong> (SALT Software) and <strong>.docx</strong> (Word).
            </p>

            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="client-name" className="form-label">Client Name / ID</label>
                <input
                  id="client-name"
                  type="text"
                  className="text-input"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="e.g. Student A or initials"
                />
              </div>

              <div className="form-field">
                <label htmlFor="client-age" className="form-label">Chronological Age (CA)</label>
                <input
                  id="client-age"
                  type="text"
                  className="text-input"
                  value={form.age}
                  onChange={(e) => update('age', e.target.value)}
                  placeholder="e.g. 5;4"
                />
              </div>

              <div className="form-field">
                <label htmlFor="client-gender" className="form-label">Gender</label>
                <input
                  id="client-gender"
                  type="text"
                  className="text-input"
                  value={form.gender}
                  onChange={(e) => update('gender', e.target.value)}
                  placeholder="e.g. F / M / Non-binary"
                />
              </div>

              <div className="form-field">
                <label htmlFor="client-dob" className="form-label">Date of Birth (DOB)</label>
                <input
                  id="client-dob"
                  type="date"
                  className="text-input"
                  value={form.dateOfBirth}
                  onChange={(e) => update('dateOfBirth', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="client-dos" className="form-label">Date of Sample (DOE)</label>
                <input
                  id="client-dos"
                  type="date"
                  className="text-input"
                  value={form.dateOfSample}
                  onChange={(e) => update('dateOfSample', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="client-examiner" className="form-label">Examiner Name</label>
                <input
                  id="client-examiner"
                  type="text"
                  className="text-input"
                  value={form.examinerName}
                  onChange={(e) => update('examinerName', e.target.value)}
                  placeholder="SLP / Clinician name"
                />
              </div>

              <div className="form-field is-full">
                <label htmlFor="client-context" className="form-label">Sampling Context</label>
                <select
                  id="client-context"
                  className="select-input"
                  value={form.samplingContext}
                  onChange={(e) => update('samplingContext', e.target.value)}
                >
                  {CONTEXT_PRESETS.map((ctx) => (
                    <option key={ctx} value={ctx}>
                      {ctx}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Client Info
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
