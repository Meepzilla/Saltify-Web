import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Server,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useWhisperModelStatus } from '../hooks/useWhisperModelStatus';
import {
  WHISPER_MODELS,
  type AppSettings,
  type ComputeDevice,
  type ModelSource,
  type ProcessingState,
  type WhisperModelId,
} from '../types/saltify';

interface ModelManagerModalProps {
  open: boolean;
  settings: AppSettings;
  processing: ProcessingState | null;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onPreloadModel: (modelId: WhisperModelId) => void;
  onNotify: (title: string, description?: string) => void;
  onOpenSettings?: () => void;
  onClose: () => void;
}

export function ModelManagerModal({
  open,
  settings,
  processing,
  onUpdateSettings,
  onPreloadModel,
  onNotify,
  onOpenSettings,
  onClose,
}: ModelManagerModalProps) {
  const { cachedModels, cacheBytes, selfHostedModels, clearCache } =
    useWhisperModelStatus(open, settings.customModelBaseUrl, processing);

  if (!open) return null;

  const handleClearCache = async () => {
    const cleared = await clearCache();
    if (cleared) {
      onNotify('Model cache cleared', 'Local browser storage has been freed.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="model-manager-title" className="modal-title">
            On-Device Speech Model &amp; Self-Hosting Settings
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
          <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
            Whisper models load directly from your self-hosted server (<code>/models/</code>
            ) when present, or from Hugging Face Hub if allowed, and stay cached locally in
            this browser for <strong>100% offline</strong> clinical transcription.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {WHISPER_MODELS.map((model) => {
              const isSelected = settings.modelId === model.id;
              const isCached = cachedModels.includes(model.id);
              const isSelfHosted = selfHostedModels.includes(model.id);
              return (
                <div
                  key={model.id}
                  className={`option-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => onUpdateSettings({ modelId: model.id })}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: '0.9rem' }}>{model.label}</strong>
                      <span className="pane-count-badge">{model.sizeLabel}</span>
                      {isSelfHosted && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            color: 'var(--accent)',
                          }}
                        >
                          <Server size={13} />
                          <span>Self-Hosted</span>
                        </span>
                      )}
                      {isCached && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            color: 'var(--success)',
                          }}
                        >
                          <CheckCircle2 size={13} />
                          <span>Cached Offline</span>
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {model.description}
                    </span>
                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      Best for: {model.recommendedFor}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={processing !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSettings({ modelId: model.id });
                      onPreloadModel(model.id);
                    }}
                  >
                    <Download size={14} />
                    <span>{isCached ? 'Verify' : 'Cache'}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="model-source-select" className="form-label">
                Model Hosting Source
              </label>
              <select
                id="model-source-select"
                className="field-select"
                value={settings.modelSource}
                onChange={(e) =>
                  onUpdateSettings({ modelSource: e.target.value as ModelSource })
                }
              >
                <option value="auto">Self-Hosted First, HF Fallback (Auto)</option>
                <option value="local-only">Self-Hosted Only (Zero External Requests)</option>
                <option value="huggingface">Hugging Face Hub Only</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="compute-device-select" className="form-label">
                On-Device Compute Engine
              </label>
              <select
                id="compute-device-select"
                className="field-select"
                value={settings.device}
                onChange={(e) =>
                  onUpdateSettings({ device: e.target.value as ComputeDevice })
                }
              >
                <option value="auto">Auto (WebGPU with WASM fallback)</option>
                <option value="wasm">Universal WASM (Safest on iPad / Mobile)</option>
                <option value="webgpu">WebGPU Acceleration (Windows / Chrome)</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="custom-model-url-input" className="form-label">
                Custom Self-Hosted Model Base URL (optional)
              </label>
              <input
                id="custom-model-url-input"
                type="text"
                className="field-input"
                value={settings.customModelBaseUrl}
                onChange={(e) =>
                  onUpdateSettings({ customModelBaseUrl: e.target.value })
                }
                placeholder="Default: ./models/ on this server"
              />
            </div>

            <div className="form-field">
              <span className="form-label">Local Browser Cache</span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface-subtle)',
                  fontSize: '0.82rem',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <HardDrive size={14} />
                  <span>
                    {cachedModels.length > 0
                      ? `${cachedModels.length} model(s) (~${Math.max(
                          1,
                          Math.round(cacheBytes / (1024 * 1024))
                        )} MB)`
                      : 'No models cached yet'}
                  </span>
                </span>
                {cachedModels.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', minHeight: 26, padding: '0 6px' }}
                    onClick={() => void handleClearCache()}
                  >
                    <Trash2 size={13} />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span
              className="form-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Cpu size={14} />
              <span>SALT Grammar Coding Preferences</span>
            </span>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.codeFillerMazes}
                onChange={(e) =>
                  onUpdateSettings({ codeFillerMazes: e.target.checked })
                }
              />
              <span>Automatically wrap verbal fillers (um, uh) in maze parentheses</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.useOverregularizationTag}
                onChange={(e) =>
                  onUpdateSettings({ useOverregularizationTag: e.target.checked })
                }
              />
              <span>
                Code irregular overregularizations as <code>[EO:target]</code> instead of{' '}
                <code>[EW:target]</code> (e.g. <code>telled[EO:told]</code>)
              </span>
            </label>
          </div>
        </div>

        <div
          className="modal-footer"
          style={{ justifyContent: onOpenSettings ? 'space-between' : 'flex-end' }}
        >
          {onOpenSettings && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <Settings size={14} />
              <span>All Settings</span>
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
