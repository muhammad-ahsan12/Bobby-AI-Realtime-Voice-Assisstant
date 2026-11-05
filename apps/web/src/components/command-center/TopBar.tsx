import { ChevronDown, Globe2, PanelRightOpen } from 'lucide-react';

interface TopBarProps {
  connected: boolean;
  connecting: boolean;
  agentUnavailable: boolean;
  language: string;
  drawerOpen: boolean;
  onLanguageChange: (language: string) => void;
  onToggleDrawer: () => void;
}

const LANGUAGES = ['English', 'Español', 'Français', 'Deutsch', 'اردو'];

export function TopBar({
  connected,
  connecting,
  agentUnavailable,
  language,
  drawerOpen,
  onLanguageChange,
  onToggleDrawer,
}: TopBarProps) {
  return (
    <header className="top-bar glass-panel">
      <a className="brand-lockup" href="/" aria-label="Bobby AI home">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-bars"><i /><i /><i /><i /><i /></span>
        </span>
        <span className="brand-copy">
          <strong>Bobby AI</strong>
          <small>Your Intelligent Agent</small>
        </span>
      </a>

      <div className="top-bar-actions">
        <div className="agent-presence" aria-live="polite">
          <span
            className={`presence-dot ${agentUnavailable ? 'presence-unavailable' : connected ? 'presence-connected' : connecting ? 'presence-connecting' : ''}`}
          />
          <span className="presence-copy">
            <strong>
              {agentUnavailable ? 'Agent Unavailable' : connecting ? 'Connecting…' : connected ? 'Agent Online' : 'Agent Ready'}
            </strong>
            <small>
              {agentUnavailable
                ? 'Check connection and retry'
                : connected
                  ? 'Ready to help'
                  : connecting
                    ? 'Starting voice session'
                    : 'Ready when you are'}
            </small>
          </span>
        </div>
        <span className="header-divider" aria-hidden="true" />
        <label className="language-select">
          <Globe2 aria-hidden="true" />
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.currentTarget.value)}
            aria-label="Interface language"
          >
            {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <button
          type="button"
          className={`header-drawer-toggle ${drawerOpen ? 'is-selected' : ''}`}
          onClick={onToggleDrawer}
          aria-label="Open connected tools"
          aria-expanded={drawerOpen}
        >
          <PanelRightOpen aria-hidden="true" />
        </button>
        <div className="user-avatar" aria-label="Bobby assistant avatar">
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&h=120&q=85"
            alt=""
          />
        </div>
      </div>
    </header>
  );
}
