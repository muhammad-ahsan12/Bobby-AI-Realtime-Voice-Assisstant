import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AppWindow,
  ChevronDown,
  Code2,
  ExternalLink,
  FileSearch,
  Folder,
  Github,
  Globe2,
  Keyboard,
  Link2,
  Mail,
  Monitor,
  MousePointer2,
  PanelsTopLeft,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { LocalVideoTrack, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { ActivityItem } from '../../lib/api';
import { findToolEvent, isToolRunning, latestToolEvents } from './toolActivity';

type ToolTab = 'tools' | 'mcps';

interface ToolDefinition {
  name: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  aliases?: string[];
}

interface ToolGroup {
  id: string;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  kind: ToolTab;
  activeByDefault: boolean;
  tools: ToolDefinition[];
  extraTools: ToolDefinition[];
  screenshot?: boolean;
}

interface ToolPanelProps {
  events: ActivityItem[];
  activityConnection: 'offline' | 'connecting' | 'connected' | 'reconnecting';
  room: Room | null;
  screenShareEnabled: boolean;
}

const GROUPS: ToolGroup[] = [
  {
    id: 'browser',
    title: 'Browser & Chrome',
    icon: Globe2,
    kind: 'tools',
    activeByDefault: true,
    tools: [
      { name: 'Search YouTube', icon: Play, aliases: ['web_search', 'search_youtube'] },
      { name: 'Open URL', icon: Link2, aliases: ['browser_open_tab', 'browser_navigate'] },
      { name: 'Manage Tabs', icon: PanelsTopLeft, aliases: ['browser_list_tabs', 'browser_switch_tab', 'browser_close_tab'] },
    ],
    extraTools: [
      { name: 'Search the web', icon: Search },
      { name: 'Click element', icon: MousePointer2 },
      { name: 'Read page', icon: FileSearch },
      { name: 'Navigate page', icon: ExternalLink },
      { name: 'Capture screenshot', icon: Monitor },
    ],
  },
  {
    id: 'windows',
    title: 'Windows Control',
    icon: AppWindow,
    kind: 'tools',
    activeByDefault: false,
    tools: [
      { name: 'Open App', icon: AppWindow, aliases: ['open_app'] },
      { name: 'Show Desktop', icon: Monitor, aliases: ['windows_command'] },
      { name: 'Minimize Window', icon: PanelsTopLeft, aliases: ['windows_command'] },
    ],
    extraTools: [{ name: 'Switch window', icon: ExternalLink }],
  },
  {
    id: 'keyboard',
    title: 'Keyboard & Input',
    icon: Keyboard,
    kind: 'tools',
    activeByDefault: false,
    tools: [
      { name: 'Press Keys', icon: Keyboard, aliases: ['press_keys'] },
      { name: 'Type Text', icon: Terminal, aliases: ['type_text'] },
      { name: 'Hotkeys', icon: Sparkles, aliases: ['press_keys'] },
    ],
    extraTools: [{ name: 'Move pointer', icon: MousePointer2 }],
  },
  {
    id: 'desktop',
    title: 'Desktop MCP',
    icon: Monitor,
    kind: 'mcps',
    activeByDefault: true,
    screenshot: true,
    tools: [
      { name: 'screenshot', icon: Monitor, aliases: ['desktop_screenshot'] },
      { name: 'desktop_state', icon: AppWindow },
      { name: 'workspace_snapshot', icon: PanelsTopLeft },
    ],
    extraTools: [{ name: 'click', icon: MousePointer2 }, { name: 'type_text', icon: Keyboard }],
  },
  {
    id: 'filesystem',
    title: 'Filesystem MCP',
    icon: Folder,
    kind: 'mcps',
    activeByDefault: true,
    tools: [
      { name: 'read_file', icon: FileSearch },
      { name: 'list_directory', icon: Folder },
      { name: 'search_files', icon: Search },
    ],
    extraTools: [
      { name: 'write_file', icon: Code2 },
      { name: 'create_directory', icon: Folder },
      { name: 'move_file', icon: ExternalLink },
      { name: 'delete_file', icon: ShieldCheck },
    ],
  },
  {
    id: 'gmail',
    title: 'Gmail MCP',
    icon: Mail,
    kind: 'mcps',
    activeByDefault: false,
    tools: [
      { name: 'search_emails', icon: Search },
      { name: 'read_email', icon: FileSearch },
      { name: 'send_email', icon: Mail },
    ],
    extraTools: [{ name: 'draft_email', icon: Code2 }, { name: 'list_email_labels', icon: PanelsTopLeft }],
  },
  {
    id: 'github',
    title: 'GitHub MCP',
    icon: Github,
    kind: 'mcps',
    activeByDefault: false,
    tools: [
      { name: 'search_repositories', icon: Search },
      { name: 'list_issues', icon: FileSearch, aliases: ['issue_read', 'get_issues'] },
      { name: 'pull_request_read', icon: Code2, aliases: ['create_pr'] },
    ],
    extraTools: [{ name: 'list_commits', icon: Terminal }, { name: 'review_pull_request', icon: ShieldCheck }],
  },
];

function statusLabel(event: ActivityItem | undefined, fallbackActive: boolean): 'Active' | 'Available' {
  if (!event) return fallbackActive ? 'Active' : 'Available';
  const status = String(event.data?.status ?? '').toLowerCase();
  return ['ready', 'active', 'connected', 'running', 'success', 'completed'].includes(status)
    ? 'Active'
    : ['disconnected', 'unavailable', 'failed', 'offline'].includes(status)
      ? 'Available'
      : fallbackActive ? 'Active' : 'Available';
}

export function ToolPanel({ events, activityConnection, room, screenShareEnabled }: ToolPanelProps) {
  const [tab, setTab] = useState<ToolTab>('tools');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['browser', 'windows', 'keyboard', 'desktop', 'filesystem', 'gmail', 'github']),
  );
  const [showAllTools, setShowAllTools] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();
  const toolEvents = useMemo(() => latestToolEvents(events), [events]);
  const statusEvents = useMemo(() => {
    const statuses = new Map<string, ActivityItem>();
    for (const event of [...events].reverse()) {
      if (event.type === 'toolset_status' && typeof event.data?.group === 'string') {
        statuses.set(event.data.group.toLowerCase(), event);
      }
    }
    return statuses;
  }, [events]);
  const groups = tab === 'tools' ? GROUPS : GROUPS.filter((group) => group.kind === tab);

  const toggleSetValue = (current: Set<string>, key: string, setValue: (next: Set<string>) => void) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setValue(next);
  };

  return (
    <section className="tools-panel glass-panel">
      <div className="tool-tabs" role="tablist" aria-label="Tool categories">
        <button
          type="button"
          className={`tool-tab ${tab === 'tools' ? 'tab-selected' : ''}`}
          role="tab"
          aria-selected={tab === 'tools'}
          onClick={() => setTab('tools')}
        >
          {tab === 'tools' && <motion.span layoutId="tool-tab-indicator" className="tool-tab-indicator" transition={{ duration: reducedMotion ? 0 : 0.26 }} />}
          <Sparkles aria-hidden="true" />
          <span>Tools</span>
        </button>
        <button
          type="button"
          className={`tool-tab ${tab === 'mcps' ? 'tab-selected' : ''}`}
          role="tab"
          aria-selected={tab === 'mcps'}
          onClick={() => setTab('mcps')}
        >
          {tab === 'mcps' && <motion.span layoutId="tool-tab-indicator" className="tool-tab-indicator" transition={{ duration: reducedMotion ? 0 : 0.26 }} />}
          <PanelsTopLeft aria-hidden="true" />
          <span>MCPs</span>
        </button>
        <span className={`feed-indicator feed-${activityConnection}`} title={`Activity feed ${activityConnection}`} />
      </div>

      <div className="tool-groups" role="tabpanel">
        <AnimatePresence mode="popLayout" initial={false}>
          {groups.map((group, index) => {
            const GroupIcon = group.icon;
            const statusEvent = statusEvents.get(group.id);
            const status = statusLabel(statusEvent, group.activeByDefault);
            const expanded = expandedGroups.has(group.id);
            const allVisible = showAllTools.has(group.id);
            const tools = allVisible ? [...group.tools, ...group.extraTools] : group.tools;
            const groupTools = [...group.tools, ...group.extraTools];
            const running = groupTools.some((tool) => isToolRunning(findToolEvent(tool, toolEvents)));

            return (
              <motion.article
                className={`tool-group ${running ? 'group-running' : ''}`}
                key={group.id}
                layout
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: reducedMotion ? 0 : 0.22, delay: reducedMotion ? 0 : index * 0.045 }}
              >
                <button
                  type="button"
                  className="tool-group-head"
                  aria-expanded={expanded}
                  onClick={() => toggleSetValue(expandedGroups, group.id, setExpandedGroups)}
                >
                  <span className={`group-icon group-icon-${group.id}`}><GroupIcon aria-hidden="true" /></span>
                  <span className="group-name">{group.title}</span>
                  <span className={`tool-status ${status === 'Active' ? 'status-active' : 'status-available'}`}>
                    <i />{running ? 'Running' : status}
                  </span>
                  {running && <span className="group-spinner" aria-label="Tool running" />}
                  <ChevronDown className={`group-chevron ${expanded ? 'chevron-open' : ''}`} aria-hidden="true" />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      className="tool-group-content"
                      initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.2 }}
                    >
                      {group.screenshot && (
                        <DesktopThumbnail room={room} screenShareEnabled={screenShareEnabled} />
                      )}
                      {tools.map((tool) => {
                        const Icon = tool.icon;
                        const event = findToolEvent(tool, toolEvents);
                        const active = isToolRunning(event);
                        return (
                          <div className={`tool-row ${active ? 'tool-row-running' : ''}`} key={tool.name}>
                            <Icon aria-hidden="true" />
                            <span>{tool.name}</span>
                            {active ? (
                              <span className="tool-progress" aria-label={`${tool.name} in progress`}>
                                <i />
                              </span>
                            ) : event && (event.type === 'error' || event.data?.status === 'failed') ? (
                              <span className="tool-row-failed">Failed</span>
                            ) : null}
                          </div>
                        );
                      })}
                      {group.extraTools.length > 0 && (
                        <button
                          className="more-tools"
                          type="button"
                          onClick={() => toggleSetValue(showAllTools, group.id, setShowAllTools)}
                        >
                          {allVisible ? 'Show less' : `+${group.extraTools.length} more`}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DesktopThumbnail({
  room,
  screenShareEnabled,
}: {
  room: Room | null;
  screenShareEnabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const track = room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    if (!screenShareEnabled || !video || !(track instanceof LocalVideoTrack)) return;
    const attachedVideo = track.attach(video);
    return () => {
      track.detach(attachedVideo);
    };
  }, [room, screenShareEnabled]);

  return (
    <div className={`desktop-thumbnail ${screenShareEnabled ? 'thumbnail-live' : ''}`} role="img" aria-label="Recent desktop screenshot preview">
      {screenShareEnabled ? (
        <video ref={videoRef} autoPlay muted playsInline />
      ) : (
        <span className="thumbnail-window">
          <i /><i /><i />
          <b />
          <span />
        </span>
      )}
      <small>LIVE DESKTOP</small>
    </div>
  );
}
