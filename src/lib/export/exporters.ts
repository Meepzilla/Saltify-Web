import type { ClientInfo, SpeakerAliases } from '../../types/session';
import { stripTimestamps } from '../salt/speakers';

export function getDefaultExportFilename(ext: 'docx' | 'slt' | 'txt' | 'wav', base?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const safeBase = base?.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.[^.]+$/, '');
  const prefix = safeBase || `${today}_SALT_Transcription`;
  return `${prefix}.${ext}`;
}

export function formatClientHeaderLines(clientInfo: ClientInfo): string[] {
  const fields: Array<[string, string]> = [
    ['Name', clientInfo.name],
    ['Age', clientInfo.age],
    ['Gender', clientInfo.gender],
    ['Date of Birth', clientInfo.dateOfBirth],
    ['Date of Sample', clientInfo.dateOfSample],
    ['Examiner Name', clientInfo.examinerName],
    ['Sampling Context', clientInfo.samplingContext],
  ];
  return fields
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => `${label}: ${value.trim()}`);
}

/**
 * Generate a SALT Software-compatible `.slt` plain-text transcript file.
 */
export function buildSaltFileContent(
  transcriptText: string,
  clientInfo: ClientInfo,
  aliases: SpeakerAliases
): string {
  const lines: string[] = [];
  lines.push(`$ ${aliases.speaker1 || 'Child'}, ${aliases.speaker2 || 'Examiner'}`);

  if (clientInfo.name.trim()) lines.push(`+ Name: ${clientInfo.name.trim()}`);
  if (clientInfo.gender.trim()) lines.push(`+ Gender: ${clientInfo.gender.trim()}`);
  if (clientInfo.age.trim()) lines.push(`+ CA: ${clientInfo.age.trim()}`);
  if (clientInfo.dateOfBirth.trim()) lines.push(`+ DOB: ${clientInfo.dateOfBirth.trim()}`);
  if (clientInfo.dateOfSample.trim()) lines.push(`+ DOE: ${clientInfo.dateOfSample.trim()}`);
  if (clientInfo.examinerName.trim()) lines.push(`+ Examiner: ${clientInfo.examinerName.trim()}`);
  if (clientInfo.samplingContext.trim()) lines.push(`+ Context: ${clientInfo.samplingContext.trim()}`);
  lines.push('- 0:00');
  lines.push('');

  const cleanedBody = stripTimestamps(transcriptText)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  lines.push(...cleanedBody);
  return `${lines.join('\n')}\n`;
}

/**
 * Build a client-side Word (.docx) Blob matching upstream Saltify export behavior,
 * with timestamps stripped and optional client metadata header.
 */
export async function buildWordDocxBlob(
  transcriptText: string,
  clientInfo: ClientInfo,
  sessionTitle: string
): Promise<Blob> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const headerLines = formatClientHeaderLines(clientInfo);
  const bodyLines = stripTimestamps(transcriptText)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  const children = [
    new Paragraph({
      text: sessionTitle || 'SALT Speech Transcription',
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 160 },
    }),
  ];

  if (headerLines.length > 0) {
    for (const line of headerLines) {
      const [label, ...rest] = line.split(':');
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${label}: `, bold: true, font: 'Calibri', size: 22 }),
            new TextRun({ text: rest.join(':').trim(), font: 'Calibri', size: 22 }),
          ],
        })
      );
    }
    children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  }

  for (const line of bodyLines) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: line,
            font: 'Consolas',
            size: 22,
          }),
        ],
      })
    );
  }

  const doc = new Document({
    creator: 'Saltify Web',
    title: sessionTitle || 'SALT Transcription',
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canUseNativeFileShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareOrDownloadFile(
  blob: Blob,
  filename: string,
  title: string
): Promise<'shared' | 'downloaded'> {
  if (canUseNativeFileShare()) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return 'shared';
      }
    } catch (err) {
      // User cancelled share sheet or browser refused file share -> fallback to direct download
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'shared';
      }
    }
  }
  triggerBlobDownload(blob, filename);
  return 'downloaded';
}
