import { HelpCircle, ShieldCheck, Smartphone, X } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-help-title">
      <div className="modal-dialog is-wide">
        <div className="modal-header">
          <h2 id="modal-help-title" className="modal-title">
            <HelpCircle size={18} aria-hidden="true" />
            Saltify Web — Clinical Workflow &amp; SALT Guide
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="alert-banner is-success">
            <div className="alert-left">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <strong>100% On-Device Privacy:</strong> Audio, transcripts, and client info never leave your device. After the first Whisper model download, transcription works completely offline.
              </span>
            </div>
          </div>

          <div className="help-section">
            <h3>Recommended Clinical Workflow</h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li><strong>Record or Upload Audio</strong> (supports WAV, MP3, iPad Voice Memos M4A, WebM, OGG).</li>
              <li>Click <strong>Transcribe Audio</strong> (choose <em>Whisper Tiny</em> on iPads/Android phones for fastest performance, or <em>Base/Small</em> on Windows).</li>
              <li>Click any <strong>[m:ss]</strong> timestamp in the Transcription Box to jump playback and verify child speech errors. Unlock the box to edit manually.</li>
              <li>Use <strong>Label Speakers</strong> to assign utterances to <strong>C</strong> (Child) and <strong>E</strong> (Examiner).</li>
              <li>Run <strong>Grammar Check</strong> to step through flagged utterances and approve/edit SALT error coding.</li>
              <li>Click <strong>Add Morphemes</strong> to tag bound inflectional morphemes while preserving all SALT error codes.</li>
              <li>Click <strong>Export</strong> to download <strong>.slt</strong> (SALT Software), <strong>.docx</strong> (Word), <strong>.wav</strong> audio, or Print/PDF.</li>
            </ol>
          </div>

          <div className="help-section">
            <h3>SALT Coding Quick Reference</h3>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Convention</th>
                  <th>Code</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Plural noun</td>
                  <td><span className="help-code">/s</span></td>
                  <td><span className="help-code">dog/s</span>, <span className="help-code">cookie/s</span></td>
                </tr>
                <tr>
                  <td>Possessive</td>
                  <td><span className="help-code">/z</span></td>
                  <td><span className="help-code">John/z dog/s</span></td>
                </tr>
                <tr>
                  <td>Regular past tense</td>
                  <td><span className="help-code">/ed</span></td>
                  <td><span className="help-code">walk/ed</span>, <span className="help-code">like/ed</span></td>
                </tr>
                <tr>
                  <td>3rd-person singular</td>
                  <td><span className="help-code">/3s</span></td>
                  <td><span className="help-code">go/3s</span>, <span className="help-code">like/3s</span></td>
                </tr>
                <tr>
                  <td>Present progressive</td>
                  <td><span className="help-code">/ing</span></td>
                  <td><span className="help-code">was go/ing</span></td>
                </tr>
                <tr>
                  <td>Contractions</td>
                  <td><span className="help-code">/'m, /'s, /'t</span></td>
                  <td><span className="help-code">I/'m</span>, <span className="help-code">can/'t</span>, <span className="help-code">it/'s</span></td>
                </tr>
                <tr>
                  <td>Word-level error</td>
                  <td><span className="help-code">[EW:target]</span></td>
                  <td><span className="help-code">telled[EW:told]</span></td>
                </tr>
                <tr>
                  <td>Pronoun / Overgeneralization</td>
                  <td><span className="help-code">[EP:] / [EO:]</span></td>
                  <td><span className="help-code">Me[EP:I]</span>, <span className="help-code">his[EP:her]</span></td>
                </tr>
                <tr>
                  <td>Omitted 3s / Omitted word</td>
                  <td><span className="help-code">/*3s</span> / <span className="help-code">*</span></td>
                  <td><span className="help-code">He walk/*3s</span>, <span className="help-code">He is* running</span></td>
                </tr>
                <tr>
                  <td>Mazes / Repetitions</td>
                  <td><span className="help-code">( ... )</span></td>
                  <td><span className="help-code">(I I) I went home.</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="help-section">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Smartphone size={15} aria-hidden="true" />
              Installing as an Offline App (iPad, Android, Windows)
            </h3>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li><strong>iPad / iPhone (Safari):</strong> Tap the <em>Share</em> button (square with arrow) → <em>Add to Home Screen</em>.</li>
              <li><strong>Android (Chrome):</strong> Tap the menu (⋮) → <em>Install app</em> or <em>Add to Home screen</em>.</li>
              <li><strong>Windows (Edge / Chrome):</strong> Click the <em>Install</em> icon in the address bar (or the <em>Install App</em> button in the top bar).</li>
            </ul>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>
            Based on <strong>Saltify</strong> (<code>oss-slu/SpeechTranscription</code>) by Open Source with SLU, licensed under GNU GPLv3.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}
