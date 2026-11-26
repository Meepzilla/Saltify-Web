import {
  Download,
  FileUp,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { formatDurationPadded } from '../engine/transcriptFormat';
import type { AppView, SessionRecord } from '../types/saltify';

interface SidebarProps {
  sessions: SessionRecord[];
  activeSessionId: string;
  activeView: AppView;
  isOnline: boolean;
  canPromptInstall: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, nextName: string) => void;
  onDeleteSession: (id: string) => void;
  onImportSessionJson: (file: File) => void;
  onPromptInstall: () => void;
  onCloseMobileDrawer: () => void;
  onCollapseSidebar: () => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  activeView,
  isOnline,
  canPromptInstall,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  onImportSessionJson,
  onPromptInstall,
  onCloseMobileDrawer,
  onCollapseSidebar,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);

  const startRename = (session: SessionRecord) => {
    setEditingId(session.id);
    setDraftName(session.name);
  };

  const commitRename = (session: SessionRecord) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== session.name) {
      onRenameSession(session.id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <aside className="sidebar no-print" aria-label="Sessions and application navigation">
      <div className="sidebar-header">
        <div className="brand-lockup">
          <img src="./favicon.svg" alt="" className="brand-mark" />
          <div>
            <h1 className="brand-title">Saltify Web</h1>
            <div className="brand-subtitle">SALT Speech Studio</div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Close sidebar"
          onClick={onCollapseSidebar}
        >
          <X size={17} />
        </button>
      </div>

      {/* Privacy & Offline Status Indicator */}
      <div className={`privacy-pill ${isOnline ? '' : 'offline'}`}>
        {isOnline ? <ShieldCheck size={15} /> : <WifiOff size={15} />}
        <span>
          {isOnline
            ? '100% On-Device · Zero Cloud Upload'
            : 'Offline Mode · Working Locally'}
        </span>
      </div>

      <div className="sidebar-actions">
        <button
          id="new-session-btn"
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onNewSession();
            onCloseMobileDrawer();
          }}
        >
          <Plus size={16} />
          <span>New Session</span>
        </button>

        {canPromptInstall && (
          <button
            id="install-pwa-sidebar-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onPromptInstall}
          >
            <Download size={14} />
            <span>Install Saltify App</span>
          </button>
        )}
      </div>

      <div className="session-list-label">
        <span>Sessions ({sessions.length})</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ minHeight: 24, padding: '0 6px', fontSize: '0.72rem' }}
          title="Import .saltify.json session backup"
          onClick={() => importRef.current?.click()}
        >
          <FileUp size={13} />
          <span>Import</span>
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,.saltify.json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onImportSessionJson(file);
              e.target.value = '';
            }
          }}
        />
      </div>

      <div className="session-list" role="list">
        {sessions.map((session) => {
          const isActive =
            activeView === 'workspace' && session.id === activeSessionId;
          const isEditing = editingId === session.id;
          const lineCount = (session.conventionText || session.transcriptionText)
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0).length;

          return (
            <div
              key={session.id}
              role="listitem"
              className={`session-item ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (!isEditing) {
                  onSelectSession(session.id);
                  onCloseMobileDrawer();
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(session);
              }}
            >
              <div className="session-item-main">
                {isEditing ? (
                  <input
                    type="text"
                    className="session-rename-input"
                    value={draftName}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(session)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(session);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="session-item-name" title={session.name}>
                      {session.name}
                    </div>
                    <div className="session-item-meta">
                      {session.audioMeta ? (
                        <span className="mono">
                          {formatDurationPadded(session.audioMeta.duration)}
                        </span>
                      ) : (
                        <span>No audio</span>
                      )}
                      <span>·</span>
                      <span>{lineCount} utt</span>
                    </div>
                  </>
                )}
              </div>

              {!isEditing && (
                <div
                  className="session-item-controls"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
                    title="Rename session"
                    aria-label={`Rename ${session.name}`}
                    onClick={() => startRename(session)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{
                      width: 28,
                      height: 28,
                      minWidth: 28,
                      minHeight: 28,
                      color: 'var(--danger)',
                    }}
                    title="Delete session"
                    aria-label={`Delete ${session.name}`}
                    onClick={() => onDeleteSession(session.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </aside>
  );
}
