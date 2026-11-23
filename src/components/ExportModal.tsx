import {
  Check,
  Copy,
  Download,
  FileAudio,
  FileCode2,
  FileJson,
  FileText,
  Printer,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  buildExportText,
  downloadSessionAudio,
  exportSessionBackupJson,
  exportSessionToDocx,
  exportSessionToSaltSlt,
  exportSessionToTxt,
  printSessionTranscript,
} from '../engine/exporter';
import type { SessionRecord } from '../types/saltify';

interface ExportModalProps {
  open: boolean;
  session: SessionRecord;
  audioBlob: Blob | null;
  includeSaltHeaders: boolean;
  stripTimestamps: boolean;
  onUpdateExportPrefs: (prefs: {
    includeSaltHeaders: boolean;
    stripTimestamps: boolean;
  }) => void;
  onNotify: (title: string, description?: string) => void;
  onClose: () => void;
}

export function ExportModal({
  open,
  session,
  audioBlob,
  includeSaltHeaders,
  stripTimestamps,
  onUpdateExportPrefs,
  onNotify,
  onClose,
}: ExportModalProps) {
  const hasConventions = session.conventionText.trim().length > 0;
  const hasTranscript = session.transcriptionText.trim().length > 0;
  const [useConventionText, setUseConventionText] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busyDocx, setBusyDocx] = useState(false);

  if (!open) return null;

  const hasAnyText = hasConventions || hasTranscript;
  const effectiveUseConvention = useConventionText && hasConventions;

  const exportOpts = {
    useConventionText: effectiveUseConvention,
    stripTimestamps,
    includeSaltHeaders,
  };

  const handleDocx = async () => {
    setBusyDocx(true);
    try {
      const file = await exportSessionToDocx(session, exportOpts);
      onNotify('Word document exported', `Saved ${file} locally.`);
    } finally {
      setBusyDocx(false);
    }
  };

  const handleSlt = () => {
    const file = exportSessionToSaltSlt(session, exportOpts);
    onNotify('SALT (.slt) file exported', `Ready to import ${file} into SALT Software.`);
  };

  const handleTxt = () => {
    const file = exportSessionToTxt(session, exportOpts);
    onNotify('Plain text exported', `Saved ${file} locally.`);
  };

  const handleCopy = async () => {
    const text = buildExportText(session, exportOpts);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    onNotify('Copied to clipboard');
  };

  const handleAudio = () => {
    if (!audioBlob) return;
    const file = downloadSessionAudio(
      audioBlob,
      session.audioMeta?.fileName || session.name
    );
    onNotify('Audio exported', `Saved ${file} (16-bit WAV).`);
  };

  const handleJsonBackup = () => {
    const file = exportSessionBackupJson(session);
    onNotify('Session backup saved', `Saved ${file} to move across devices.`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="export-modal-title" className="modal-title">
            Export &amp; Print Session
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hasConventions && hasTranscript && (
              <div className="form-field">
                <span className="form-label">Export Source</span>
                <div className="theme-segmented" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <button
                    type="button"
                    className={useConventionText ? 'active' : ''}
                    onClick={() => setUseConventionText(true)}
                  >
                    SALT Conventions
                  </button>
                  <button
                    type="button"
                    className={!useConventionText ? 'active' : ''}
                    onClick={() => setUseConventionText(false)}
                  >
                    Raw Transcript
                  </button>
                </div>
              </div>
            )}

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeSaltHeaders}
                onChange={(e) =>
                  onUpdateExportPrefs({
                    includeSaltHeaders: e.target.checked,
                    stripTimestamps,
                  })
                }
              />
              <span>Include Client Info / SALT Header lines</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={stripTimestamps}
                onChange={(e) =>
                  onUpdateExportPrefs({
                    includeSaltHeaders,
                    stripTimestamps: e.target.checked,
                  })
                }
              />
              <span>Strip [M:SS] timestamps (recommended for SALT Software &amp; Word)</span>
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            <button
              id="export-docx-btn"
              type="button"
              className="btn btn-primary"
              disabled={!hasAnyText || busyDocx}
              onClick={() => void handleDocx()}
            >
              <FileText size={16} />
              <span>{busyDocx ? 'Generating...' : 'Export Word (.docx)'}</span>
            </button>

            <button
              id="export-slt-btn"
              type="button"
              className="btn btn-primary"
              disabled={!hasAnyText}
              onClick={handleSlt}
            >
              <FileCode2 size={16} />
              <span>Export SALT (.slt)</span>
            </button>

            <button
              id="export-txt-btn"
              type="button"
              className="btn btn-secondary"
              disabled={!hasAnyText}
              onClick={handleTxt}
            >
              <Download size={16} />
              <span>Plain Text (.txt)</span>
            </button>

            <button
              id="export-copy-btn"
              type="button"
              className="btn btn-secondary"
              disabled={!hasAnyText}
              onClick={() => void handleCopy()}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>

            <button
              id="export-print-btn"
              type="button"
              className="btn btn-secondary"
              disabled={!hasAnyText}
              onClick={() => printSessionTranscript(session, exportOpts)}
            >
              <Printer size={16} />
              <span>Print Transcript</span>
            </button>

            <button
              id="export-wav-btn"
              type="button"
              className="btn btn-secondary"
              disabled={!audioBlob}
              onClick={handleAudio}
            >
              <FileAudio size={16} />
              <span>Download WAV</span>
            </button>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Transfer this session between iPad, Android, and Windows locally:
            </span>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={handleJsonBackup}
            >
              <FileJson size={14} />
              <span>Save .saltify.json</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
