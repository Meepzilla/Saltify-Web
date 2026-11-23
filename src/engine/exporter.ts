import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { SessionRecord } from '../types/saltify';
import {
  buildReadableClientHeader,
  buildSaltHeader,
  stripTimestamps,
} from './transcriptFormat';

export function getDefaultExportBaseName(session: SessionRecord): string {
  const today = new Date().toISOString().slice(0, 10);
  const safeClient = session.clientInfo.name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safeClient ? `${today}_${safeClient}_SALT_Transcription` : `${today}_SALT_Transcription`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  // Defer cleanup slightly for iPadOS Safari download reliability
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1500);
}

export interface ExportTextOptions {
  useConventionText: boolean;
  stripTimestamps: boolean;
  includeSaltHeaders: boolean;
}

export function buildExportText(
  session: SessionRecord,
  options: ExportTextOptions
): string {
  const sourceText =
    options.useConventionText && session.conventionText.trim()
      ? session.conventionText
      : session.transcriptionText;

  const body = options.stripTimestamps
    ? stripTimestamps(sourceText)
    : sourceText.trim();

  if (!options.includeSaltHeaders) {
    return body;
  }

  const header = buildSaltHeader(session.clientInfo, session.speakerAliases);
  return header ? `${header}\n\n${body}` : body;
}

/**
 * Exports the transcript or SALT conventions to a native Microsoft Word `.docx` file
 * 100% client-side, matching oss-slu/SpeechTranscription export.py.
 */
export async function exportSessionToDocx(
  session: SessionRecord,
  options: ExportTextOptions
): Promise<string> {
  const filename = `${getDefaultExportBaseName(session)}.docx`;
  const sourceText =
    options.useConventionText && session.conventionText.trim()
      ? session.conventionText
      : session.transcriptionText;
  const cleanBody = options.stripTimestamps
    ? stripTimestamps(sourceText)
    : sourceText.trim();

  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: session.name || 'SALT Language Sample Transcription',
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 160 },
    }),
  ];

  if (options.includeSaltHeaders) {
    const readableHeader = buildReadableClientHeader(session.clientInfo);
    if (readableHeader) {
      for (const line of readableHeader.split('\n')) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                size: 20,
                color: '44546A',
                font: 'Calibri',
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }
  }

  for (const line of cleanBody.split(/\r?\n/)) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            size: 22,
            font: 'Calibri',
          }),
        ],
        spacing: { after: 100 },
      })
    );
  }

  const doc = new Document({
    creator: 'Saltify Web (100% On-Device)',
    title: session.name,
    sections: [{ children: paragraphs }],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename);
  return filename;
}

/**
 * Exports a native SALT Software `.slt` plain-text transcript file with standard headers.
 */
export function exportSessionToSaltSlt(
  session: SessionRecord,
  options: ExportTextOptions
): string {
  const filename = `${getDefaultExportBaseName(session)}.slt`;
  const content = buildExportText(session, {
    ...options,
    includeSaltHeaders: true,
    stripTimestamps: true,
  });
  const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, filename);
  return filename;
}

/**
 * Exports plain `.txt` transcript.
 */
export function exportSessionToTxt(
  session: SessionRecord,
  options: ExportTextOptions
): string {
  const filename = `${getDefaultExportBaseName(session)}.txt`;
  const content = buildExportText(session, options);
  const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, filename);
  return filename;
}

/**
 * Downloads the session's WAV audio blob locally.
 */
export function downloadSessionAudio(
  wavBlob: Blob,
  preferredName: string
): string {
  const cleanBase = (preferredName || 'saltify_recording')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const filename = `${cleanBase || 'saltify_recording'}.wav`;
  triggerDownload(wavBlob, filename);
  return filename;
}

/**
 * Exports a portable JSON backup of the session (metadata, transcript, conventions, client info)
 * so clinicians can move sessions across iPad, Android, and Windows without any cloud server.
 */
export function exportSessionBackupJson(session: SessionRecord): string {
  const filename = `${getDefaultExportBaseName(session)}.saltify.json`;
  const payload = {
    schema: 'saltify-web-session-v1',
    exportedAt: new Date().toISOString(),
    session: {
      ...session,
      hasAudioBlob: false,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, filename);
  return filename;
}

/**
 * Opens a clean print dialog for the transcript/SALT conventions (completing desktop Saltify's print TODO).
 */
export function printSessionTranscript(
  session: SessionRecord,
  options: ExportTextOptions
): void {
  const text = buildExportText(session, options);
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const title = (session.name || 'SALT Transcription')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');

  const printWin = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWin) {
    // Fallback to printing current window if popup blocked on iPad/Android
    window.print();
    return;
  }

  printWin.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; padding: 32px; line-height: 1.6; max-width: 820px; margin: 0 auto; }
    h1 { font-size: 20px; margin-bottom: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
    pre { white-space: pre-wrap; word-wrap: break-word; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <pre>${escaped}</pre>
</body>
</html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
  }, 250);
}
