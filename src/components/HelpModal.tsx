import { ShieldCheck, Smartphone, X } from 'lucide-react';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="help-modal-title" className="modal-title">
            Saltify Web Guide &amp; SALT Conventions Reference
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

        <div className="modal-body" style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--success-soft)',
              color: 'var(--success)',
            }}
          >
            <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>100% On-Device Privacy:</strong> Audio recordings, client info,
              transcripts, Whisper AI inference, SALT grammar coding, and Word/.slt exports
              all run locally on your device. No audio or patient text is ever transmitted
              to external servers.
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '0.94rem' }}>Clinical Workflow</h3>
            <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)' }}>
              <li>
                <strong>Record or Upload:</strong> Record directly via your microphone or
                upload WAV, MP3, M4A, MP4, or WebM audio. Drag the waveform or tap{' '}
                <code>[M:SS]</code> timestamps to scrub.
              </li>
              <li>
                <strong>Transcribe On-Device:</strong> Click <strong>Transcribe</strong>{' '}
                to run Whisper locally in a Web Worker. After its first download, the model
                works fully offline.
              </li>
              <li>
                <strong>Label Speakers &amp; Aliases:</strong> Tap any utterance&apos;s
                speaker pill to cycle <code>C</code> / <code>E</code>, or use{' '}
                <strong>Label Speakers</strong> for bulk tagging and{' '}
                <strong>Aliases</strong> to customize labels.
              </li>
              <li>
                <strong>Grammar Check, Morphemes &amp; Clauses:</strong> Run{' '}
                <strong>Grammar Check</strong> to review SALT error codes and mazes step by
                step, click <strong>Add Morphemes</strong> for bound inflectional morphemes,
                and open <strong>Mark Clauses</strong> to score SALT Subordination Index
                (<code>[SI-0]</code>–<code>[SI-4+]</code>, <code>[SI-X]</code>) or tap inline
                clause boundaries (<code>[MC]</code>, <code>[SC]</code>, <code>[RC]</code>,{' '}
                <code>[AC]</code>, <code>[NC]</code>).
              </li>
              <li>
                <strong>Analyze &amp; Export:</strong> Inspect real-time MLUm, MLUw, TNW,
                NDW, TTR, Clausal Density (SI), and Maze % per speaker, then export directly
                to <code>.docx</code>, <code>.slt</code> (SALT Software), <code>.txt</code>,{' '}
                <code>.wav</code>, or Print.
              </li>
            </ol>
          </div>

          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '0.94rem' }}>
              SALT Coding Quick Reference
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 8,
              }}
            >
              <div className="metrics-speaker-card">
                <strong>Bound Morphemes</strong>
                <div className="mono" style={{ fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                  dog/s · plural noun<br />
                  John/z · possessive &apos;s<br />
                  walk/ed · regular past<br />
                  go/3s · 3rd-person singular<br />
                  work/ing · participle (after be)<br />
                  I/&apos;m, can/&apos;t, is/n&apos;t · contractions
                </div>
              </div>
              <div className="metrics-speaker-card">
                <strong>Errors, Omissions &amp; Mazes</strong>
                <div className="mono" style={{ fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                  (I I) I · repetition maze<br />
                  (um) · filler maze<br />
                  telled[EW:told] · word error<br />
                  at[EW] · extraneous word<br />
                  walk/*3s · omitted morpheme<br />
                  *is, *to · omitted word
                </div>
              </div>
              <div className="metrics-speaker-card">
                <strong>Clauses &amp; Clausal Density (SI)</strong>
                <div className="mono" style={{ fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                  [SI-0] · 0 clauses (no finite verb)<br />
                  [SI-1] · 1 clause (simple)<br />
                  [SI-2] · 2 clauses (complex)<br />
                  [SI-X] · excluded (abandoned/ellip.)<br />
                  [MC] [SC] [RC] [AC] [NC] · boundaries<br />
                  CD = Total Clauses ÷ Scored Utt
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '0.94rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Smartphone size={15} />
              <span>Installing as a Standalone Offline App</span>
            </h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)' }}>
              <li>
                <strong>iPad (iPadOS Safari):</strong> Tap the <strong>Share</strong> icon
                in Safari&apos;s toolbar → <strong>Add to Home Screen</strong>. Use{' '}
                <em>Whisper Tiny (.en)</em> or <em>Base (.en)</em> for best memory
                stability.
              </li>
              <li>
                <strong>Android (Chrome / Edge):</strong> Tap{' '}
                <strong>Install Saltify App</strong> in the sidebar or browser menu →{' '}
                <strong>Install app</strong>.
              </li>
              <li>
                <strong>Windows (Edge / Chrome):</strong> Click the install icon in the
                address bar (or <strong>Install Saltify App</strong> in the sidebar).
                Windows laptops can comfortably run <em>Whisper Small (.en)</em> for
                desktop-grade accuracy.
              </li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
