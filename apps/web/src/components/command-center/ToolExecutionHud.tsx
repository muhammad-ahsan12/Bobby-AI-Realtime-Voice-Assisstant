import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AppWindow,
  FileSearch,
  Folder,
  Github,
  Globe2,
  Keyboard,
  Mail,
  Monitor,
  Play,
  Search,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ActivityItem } from '../../lib/api';
import { latestRunningTool } from './toolActivity';

interface ToolExecutionHudProps {
  events: ActivityItem[];
}

const GROUP_LABELS: Record<string, string> = {
  browser: 'BROWSER AUTOMATION',
  windows: 'WINDOWS CONTROL',
  keyboard: 'KEYBOARD & INPUT',
  desktop: 'DESKTOP MCP',
  filesystem: 'FILESYSTEM MCP',
  gmail: 'GMAIL MCP',
  github: 'GITHUB MCP',
};

function toolGroup(event: ActivityItem): string {
  const name = event.tool?.toLowerCase() ?? '';
  if (name.startsWith('browser_') || name === 'web_search' || name === 'news_search') return 'browser';
  if (name === 'windows_command' || name === 'open_app') return 'windows';
  if (name === 'press_keys' || name === 'type_text') return 'keyboard';
  return typeof event.data?.group === 'string' ? event.data.group.toLowerCase() : 'mcp';
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    browser_play_youtube_video: 'Playing YouTube video',
    browser_search_youtube: 'Searching YouTube',
    browser_search_google: 'Searching the web',
    browser_open_tab: 'Opening browser tab',
    browser_navigate: 'Navigating browser',
    desktop_screenshot: 'Capturing desktop',
    search_repositories: 'Searching repositories',
    search_emails: 'Searching email',
    send_email: 'Sending email',
    read_file: 'Reading file',
    write_file: 'Writing file',
    list_directory: 'Listing files',
    windows_command: 'Controlling Windows',
    open_app: 'Opening application',
    press_keys: 'Pressing keys',
    type_text: 'Entering text',
  };
  return labels[name] ?? name.replace(/^(browser_|mcp_)/, '').replace(/_/g, ' ');
}

function toolIcon(group: string, name: string): LucideIcon {
  if (name.includes('youtube') || name.includes('play')) return Play;
  if (group === 'browser') return Globe2;
  if (group === 'windows') return AppWindow;
  if (group === 'keyboard') return Keyboard;
  if (group === 'desktop') return Monitor;
  if (group === 'filesystem') return name.includes('read') ? FileSearch : Folder;
  if (group === 'gmail') return Mail;
  if (group === 'github') return Github;
  if (name.includes('search')) return Search;
  return Terminal;
}

export function ToolExecutionHud({ events }: ToolExecutionHudProps) {
  const reducedMotion = useReducedMotion();
  const event = useMemo(() => latestRunningTool(events), [events]);
  const group = event ? toolGroup(event) : '';
  const Icon = event ? toolIcon(group, event.tool ?? '') : Terminal;

  return (
    <AnimatePresence>
      {event && (
        <motion.aside
          key={`${event.data?.call_id ?? event.tool}:${event.id}`}
          className="tool-execution-hud"
          data-group={group}
          aria-live="polite"
          aria-label={`${GROUP_LABELS[group] ?? 'TOOL'} running: ${toolLabel(event.tool ?? 'tool')}`}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: reducedMotion ? 0 : 0.22 }}
        >
          <div className="execution-hud-icon"><Icon aria-hidden="true" /></div>
          <div className="execution-hud-copy">
            <span className="execution-hud-group">{GROUP_LABELS[group] ?? `${group.toUpperCase()} MCP`} · LIVE</span>
            <strong>{toolLabel(event.tool ?? 'tool')}</strong>
            <span className="execution-hud-status"><i />Processing real activity</span>
          </div>
          <span className="execution-hud-spinner" aria-hidden="true" />
          <div className="execution-hud-progress" aria-hidden="true"><i /></div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
