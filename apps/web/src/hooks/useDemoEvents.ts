import { useCallback, useEffect, useState } from 'react';
import { ActivityItem } from '../lib/api';

interface DemoStep {
  delay: number;
  type: ActivityItem['type'];
  tool?: string;
  message: string;
  data?: ActivityItem['data'];
}

const DEMO_STEPS: DemoStep[] = [
  { delay: 0, type: 'toolset_status', tool: 'browser', message: 'Browser ready.', data: { group: 'browser', status: 'ready', tool_count: 16 } },
  { delay: 0, type: 'toolset_status', tool: 'filesystem', message: 'Filesystem ready.', data: { group: 'filesystem', status: 'ready', tool_count: 15 } },
  { delay: 0, type: 'toolset_status', tool: 'desktop', message: 'Desktop ready.', data: { group: 'desktop', status: 'ready', tool_count: 14 } },
  { delay: 0, type: 'toolset_status', tool: 'github', message: 'GitHub disconnected.', data: { group: 'github', status: 'disconnected', tool_count: 0 } },
  { delay: 500, type: 'agent_state', message: 'Agent is listening.', data: { state: 'listening' } },
  {
    delay: 1300,
    type: 'transcript',
    message: 'User transcript updated.',
    data: { role: 'user', text: 'مجھے موسم کے بارے میں بتائیں۔', language: 'ur', is_final: true },
  },
  { delay: 900, type: 'agent_state', message: 'Agent is thinking.', data: { state: 'thinking' } },
  {
    delay: 700,
    type: 'tool_call',
    tool: 'web_search',
    message: 'Tool started.',
    data: { call_id: 'demo-search-1', group: 'browser', status: 'running' },
  },
  {
    delay: 1700,
    type: 'tool_result',
    tool: 'web_search',
    message: 'Tool completed.',
    data: { call_id: 'demo-search-1', group: 'browser', status: 'success', duration_ms: 642 },
  },
  { delay: 500, type: 'agent_state', message: 'Agent is speaking.', data: { state: 'speaking' } },
  {
    delay: 600,
    type: 'transcript',
    message: 'Assistant transcript updated.',
    data: { role: 'assistant', text: 'آج موسم خوشگوار ہے۔', language: 'ur', is_final: true },
  },
  { delay: 1300, type: 'agent_state', message: 'Agent is listening.', data: { state: 'listening' } },
  {
    delay: 700,
    type: 'transcript',
    message: 'User transcript updated.',
    data: { role: 'user', text: 'Can you check my files?', language: 'en', is_final: true },
  },
  { delay: 500, type: 'agent_state', message: 'Agent is thinking.', data: { state: 'thinking' } },
  {
    delay: 500,
    type: 'tool_call',
    tool: 'list_directory',
    message: 'Tool started.',
    data: { call_id: 'demo-files-1', group: 'filesystem', status: 'running' },
  },
  {
    delay: 1200,
    type: 'tool_result',
    tool: 'list_directory',
    message: 'Tool completed.',
    data: { call_id: 'demo-files-1', group: 'filesystem', status: 'success', duration_ms: 388 },
  },
  {
    delay: 500,
    type: 'transcript',
    message: 'Assistant transcript updated.',
    data: { role: 'assistant', text: 'هو، ستاسو د فایلونو لټون بشپړ شو.', language: 'ps', is_final: true },
  },
  { delay: 500, type: 'agent_state', message: 'Agent is listening.', data: { state: 'listening' } },
];

export function useDemoEvents(enabled: boolean) {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }

    let active = true;
    let timer: number | null = null;
    let index = 0;
    setEvents([]);

    const playNext = () => {
      if (!active) return;
      const step = DEMO_STEPS[index];
      setEvents((previous) => {
        const event: ActivityItem = {
          id: `demo-${Date.now()}-${index}`,
          ts: Date.now() / 1000,
          type: step.type,
          tool: step.tool,
          message: step.message,
          data: step.data,
        };
        return [event, ...previous].slice(0, 50);
      });
      index = (index + 1) % DEMO_STEPS.length;
      timer = window.setTimeout(playNext, step.delay || 300);
    };

    timer = window.setTimeout(playNext, 200);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  return { events, clearEvents };
}
