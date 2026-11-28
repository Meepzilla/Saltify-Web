import { CloudUpload } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings } from '../types/saltify';
import { encodeWavBlob } from '../engine/audioProcessing';

const CLOUD_MODEL_ID: AppSettings['modelId'] = 'cloudflare/whisper-large-v3-turbo';

/**
 * Settings card for optional cloud transcription on this site's Cloudflare Worker
 * (Workers AI, Whisper Large v3 Turbo). Off by default: audio leaves the device when used.
 */
export function CloudTranscriptionCard({
  settings,
  onUpdateSettings,
}: {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setResult(null);
    try {
      const status = await fetch('/api/transcribe/status', { cache: 'no-store' });
      if (!status.ok || !(status.headers.get('content-type') ?? '').includes('json')) {
        setResult({ ok: false, text: 'This server does not have the cloud endpoint (deploy the Saltify Worker with Workers AI).' });
        return;
      }
      const info = (await status.json()) as { enabled?: boolean };
      if (!info.enabled) {
        setResult({ ok: false, text: 'The server is not set up yet: add the CLOUD_TRANSCRIBE_KEY secret to the Worker in the Cloudflare dashboard.' });
        return;
      }
      // One second of silence: checks the key and the model without sending real audio
      const bytes = new Uint8Array(await encodeWavBlob(new Float32Array(16000), 16000).arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-saltify-key': settings.cloudAccessKey.trim() },
        body: JSON.stringify({ audio: btoa(bin) }),
      });
      if (res.status === 401) setResult({ ok: false, text: 'The access key does not match the server.' });
      else if (res.ok) setResult({ ok: true, text: 'Connected: the cloud model is ready.' });
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setResult({ ok: false, text: body.error ?? `The server answered ${res.status}.` });
      }
    } catch (err) {
      setResult({ ok: false, text: `Could not reach the server: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <h3 className="settings-card-title">Cloud Transcription (Optional)</h3>
      </div>
      <p className="settings-card-desc">
        Uses <strong>Whisper Large v3 Turbo</strong> on your Cloudflare account instead of this device: a much
        larger model that usually finishes a 10-minute sample in under a minute. <strong>Audio leaves the
        device</strong> when the cloud model is used (sent to Cloudflare Workers AI, which does not keep it).
        Only turn this on if your district has approved sending student audio to Cloudflare.
      </p>
      <label className="settings-toggle-row" htmlFor="setting-cloud-enabled">
        <div className="settings-row-info">
          <div className="settings-row-title">Allow cloud transcription</div>
          <div className="settings-row-desc">
            Adds “Whisper Large v3 Turbo (Cloudflare cloud)” to the model list. On-device models stay available.
          </div>
        </div>
        <input
          id="setting-cloud-enabled"
          type="checkbox"
          className="settings-toggle-input"
          checked={settings.cloudTranscriptionEnabled}
          onChange={(e) =>
            onUpdateSettings({
              cloudTranscriptionEnabled: e.target.checked,
              // Turning it off also leaves the cloud model, so nothing is sent by accident
              ...(!e.target.checked && settings.modelId === CLOUD_MODEL_ID
                ? { modelId: 'onnx-community/whisper-base.en' as AppSettings['modelId'] }
                : {}),
            })
          }
        />
      </label>
      {settings.cloudTranscriptionEnabled && (
        <>
          <div className="form-field">
            <label className="form-label" htmlFor="setting-cloud-key">
              Access key
            </label>
            <input
              id="setting-cloud-key"
              type="password"
              className="field-input"
              autoComplete="off"
              value={settings.cloudAccessKey}
              placeholder="The CLOUD_TRANSCRIBE_KEY secret set on the server"
              onChange={(e) => onUpdateSettings({ cloudAccessKey: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={testing} onClick={() => void testConnection()}>
              <CloudUpload size={14} />
              <span>{testing ? 'Testing…' : 'Test connection'}</span>
            </button>
            {settings.modelId !== CLOUD_MODEL_ID && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onUpdateSettings({ modelId: CLOUD_MODEL_ID })}
              >
                Use the cloud model
              </button>
            )}
          </div>
          {result && (
            <p className="settings-card-desc" role="status" style={{ marginTop: 8, color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
              {result.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
