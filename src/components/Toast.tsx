import { AlertCircle, CheckCircle2, Info, RotateCw, X } from 'lucide-react';
import type { ToastMessage } from '../types/saltify';

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack no-print" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item ${toast.tone}`} role="status">
          <span
            style={{
              marginTop: 2,
              flexShrink: 0,
              color:
                toast.tone === 'error'
                  ? 'var(--danger)'
                  : toast.tone === 'success'
                  ? 'var(--success)'
                  : toast.tone === 'warning'
                  ? 'var(--warning)'
                  : 'var(--accent)',
            }}
          >
            {toast.tone === 'error' ? (
              <AlertCircle size={17} />
            ) : toast.tone === 'success' ? (
              <CheckCircle2 size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {toast.title}
            </div>
            {toast.description && (
              <div
                style={{
                  fontSize: '0.79rem',
                  color: 'var(--text-secondary)',
                  marginTop: 2,
                }}
              >
                {toast.description}
              </div>
            )}
            {toast.onRetry && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => {
                  onDismiss(toast.id);
                  toast.onRetry?.();
                }}
              >
                <RotateCw size={13} />
                <span>{toast.retryLabel ?? 'Retry'}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 26, height: 26, minWidth: 26, minHeight: 26 }}
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
