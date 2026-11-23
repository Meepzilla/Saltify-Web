import { useState } from 'react';
import {
  Download,
  FileCode2,
  FileText,
  Printer,
  Share2,
  Volume2,
  X,
} from 'lucide-react';
import type { ClientInfo, SpeakerAliases } from '../types/session';
import {
  buildSaltFileContent,
  buildWordDocxBlob,
  canUseNativeFileShare,
  getDefaultExportFilename,
  shareOrDownloadFile,
  triggerBlobDownload,
} from '../lib/export/exporters';

interface ExportMenuModalProps {
  sessionName: string;
  fileName: string;
  exportText: string;
  exportSourceLabel: 'SALT Convention Box' | 'Transcription Box';
  clientInfo: ClientInfo;
  aliases: SpeakerAliases;
  audioBlob: Blob | null;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function ExportMenuModal({
  sessionName,
  fileName,
  exportText,
  exportSourceLabel,
  clientInfo,
  aliases,
  audioBlob,
  onClose,
  onNotify,
}: ExportMenuModalProps) {
  const [busy, setBusy] = useState(false);
  const canShare = canUseNativeFileShare();
  const hasText = exportText.trim().length > 0;

  const handleExportWord = async (preferShare = false) => {
    if (!hasText) return;
    setBusy(true);
    try {
      const blob = await buildWordDocxBlob(exportText, clientInfo, sessionName);
      const outName = getDefaultExportFilename('docx', fileName);
      if (preferShare) {
        await shareOrDownloadFile(blob, outName, sessionName);
      } else {
        triggerBlobDownload(blob, outName);
      }
      onNotify(`Exported Word document (${outName})`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleExportSalt = async (preferShare = false) => {
    if (!hasText) return;
    const content = buildSaltFileContent(exportText, clientInfo, aliases);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const outName = getDefaultExportFilename('slt', fileName);
    if (preferShare) {
      await shareOrDownloadFile(blob, outName, sessionName);
    } else {
      triggerBlobDownload(blob, outName);
    }
    onNotify(`Exported SALT file (${outName})`);
    onClose();
  };

  const handleDownloadAudio = () => {
    if (!audioBlob) return;
    const outName = getDefaultExportFilename('wav', fileName || 'recording');
    triggerBlobDownload(audioBlob, outName);
    onNotify(`Downloaded audio (${outName})`);
    onClose();
  };

  const handlePrint = () => {
    onClose();
    setTimeout(() => window.print(), 120);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-export-title">
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 id="modal-export-title" className="modal-title">
            <Download size={18} aria-hidden="true" />
            Export &amp; Print Session
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-secondary)' }}>
            Text exports use your <strong>{exportSourceLabel}</strong> with timestamps automatically stripped for SALT &amp; Word compatibility.
          </p>

          <div className="export-option-grid">
            <button
              id="btn-export-docx"
              type="button"
              className="export-option-card"
              disabled={!hasText || busy}
              onClick={() => handleExportWord(false)}
            >
              <span className="export-option-title">
                <FileText size={16} aria-hidden="true" />
                Export to Word (.docx)
              </span>
              <span className="export-option-desc">
                Formatted Word report with Client Info header and transcript lines.
              </span>
            </button>

            <button
              id="btn-export-slt"
              type="button"
              className="export-option-card"
              disabled={!hasText || busy}
              onClick={() => handleExportSalt(false)}
            >
              <span className="export-option-title">
                <FileCode2 size={16} aria-hidden="true" />
                Export for SALT (.slt)
              </span>
              <span className="export-option-desc">
                SALT Software transcript format ($ header, + metadata, - 0:00 timing).
              </span>
            </button>

            <button
              id="btn-export-audio"
              type="button"
              className="export-option-card"
              disabled={!audioBlob || busy}
              onClick={handleDownloadAudio}
            >
              <span className="export-option-title">
                <Volume2 size={16} aria-hidden="true" />
                Download Audio (.wav)
              </span>
              <span className="export-option-desc">
                Save the recorded or uploaded session audio locally as PCM WAV.
              </span>
            </button>

            <button
              id="btn-export-print"
              type="button"
              className="export-option-card"
              disabled={!hasText || busy}
              onClick={handlePrint}
            >
              <span className="export-option-title">
                <Printer size={16} aria-hidden="true" />
                Print / Save as PDF
              </span>
              <span className="export-option-desc">
                Clean print layout for iPad AirPrint, Android Print, or Windows PDF.
              </span>
            </button>
          </div>

          {canShare && hasText && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => handleExportSalt(true)}
              >
                <Share2 size={14} aria-hidden="true" />
                Share .slt via Device Sheet
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => handleExportWord(true)}
              >
                <Share2 size={14} aria-hidden="true" />
                Share .docx via Device Sheet
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
