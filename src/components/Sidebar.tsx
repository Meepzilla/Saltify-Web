import { useState, type KeyboardEvent } from 'react';
import {
  Check,
  HelpCircle,
  Monitor,
  Moon,
  Pencil,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type { SessionRecord, ThemePreference } from '../types/session';
import { formatTimestamp } from '../lib/salt/speakers';

interface SidebarProps {
  sessions: SessionRecord[];
  activeSessionId: string;
  isOpen: boolean;
  theme: ThemePreference;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, nextName: string) => void;
  onDeleteSession: (id: string) => void;
  onChangeTheme: (theme: ThemePreference) => void;
  onOpenClientInfo: () => void;
  onOpenHelp: () => void;
  onClearAllData: () => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  isOpen,
  theme,
  onClose,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onChangeTheme,
  onOpenClientInfo,
  onOpenHelp,
  onClearAllData,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const beginRename = (session: SessionRecord) => {
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

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>, session: SessionRecord) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(session);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
    }
  };

  return (
    <>
      <div
        className={`sidebar-backdrop ${isOpen ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${isOpen ? 'is-open' : ''}`} aria-label="Audio sessions and settings">
        <div className="sidebar-header">
          <div className="brand-block">
            <img src="./favicon.svg" alt="" className="brand-icon" />
            <div>
              <p className="brand-title">Saltify Web</p>
              <span className="brand-subtitle">
                <ShieldCheck size={12} aria-hidden="true" />
                100% On-Device
              </span>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close-btn"
            onClick={onClose}
            aria-label="Close sessions drawer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            id="btn-new-session"
            type="button"
            className="btn btn-primary btn-full"
            onClick={() => {
              onCreateSession();
              onClose();
            }}
          >
            <Plus size={16} aria-hidden="true" />
            New Session
          </button>
        </div>

        <div className="sessions-list" role="list">
          <div className="sessions-section-label">Sessions ({sessions.length})</div>
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = editingId === session.id;
            const utteranceCount = session.transcriptionText
              ? session.transcriptionText.split('\n').filter((l) => l.trim()).length
              : 0;

            return (
              <div
                key={session.id}
                role="listitem"
                className={`session-item ${isActive ? 'is-active' : ''}`}
              >
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      className="session-rename-input"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, session)}
                      onBlur={() => commitRename(session)}
                      aria-label="Rename session"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitRename(session)}
                      aria-label="Save session name"
                    >
                      <Check size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="session-select-btn"
                      onClick={() => {
                        onSelectSession(session.id);
                        onClose();
                      }}
                      onDoubleClick={() => beginRename(session)}
                      title="Click to open, double-click to rename"
                    >
                      <span className="session-name">{session.name}</span>
                      <span className="session-meta">
                        <span>{session.hasAudio ? formatTimestamp(session.audioDuration) : 'No audio'}</span>
                        {utteranceCount > 0 && <span>{utteranceCount} lines</span>}
                      </span>
                    </button>
                    <div className="session-item-controls">
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => beginRename(session)}
                        aria-label={`Rename ${session.name}`}
                        title="Rename session"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => onDeleteSession(session.id)}
                        aria-label={`Delete ${session.name}`}
                        title="Delete session"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <div className="theme-segmented" role="radiogroup" aria-label="Color theme">
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              className={`theme-seg-btn ${theme === 'light' ? 'is-active' : ''}`}
              onClick={() => onChangeTheme('light')}
            >
              <Sun size={13} aria-hidden="true" />
              Light
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              className={`theme-seg-btn ${theme === 'dark' ? 'is-active' : ''}`}
              onClick={() => onChangeTheme('dark')}
            >
              <Moon size={13} aria-hidden="true" />
              Dark
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'system'}
              className={`theme-seg-btn ${theme === 'system' ? 'is-active' : ''}`}
              onClick={() => onChangeTheme('system')}
            >
              <Monitor size={13} aria-hidden="true" />
              Auto
            </button>
          </div>

          <div className="sidebar-footer-links">
            <button
              id="btn-sidebar-client-info"
              type="button"
              className="btn btn-sm btn-full"
              onClick={() => {
                onOpenClientInfo();
                onClose();
              }}
            >
              <UserRound size={14} aria-hidden="true" />
              Client Info
            </button>
            <button
              id="btn-sidebar-help"
              type="button"
              className="btn btn-sm btn-full"
              onClick={() => {
                onOpenHelp();
                onClose();
              }}
            >
              <HelpCircle size={14} aria-hidden="true" />
              Help
            </button>
          </div>

          <button
            id="btn-clear-local-data"
            type="button"
            className="btn btn-sm btn-ghost btn-full"
            onClick={onClearAllData}
            title="Erase all saved sessions and audio blobs from this browser"
          >
            <Trash2 size={13} aria-hidden="true" />
            Clear All Local Data
          </button>
        </div>
      </aside>
    </>
  );
}
