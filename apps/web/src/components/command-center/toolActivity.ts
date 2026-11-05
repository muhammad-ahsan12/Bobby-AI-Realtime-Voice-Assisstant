import type { ActivityItem } from '../../lib/api';

function activityTime(value: ActivityItem['ts']): number {
  const parsed = typeof value === 'number'
    ? (value < 10_000_000_000 ? value * 1000 : value)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isToolRunning(event: ActivityItem | undefined): boolean {
  if (!event || event.type !== 'tool_call') return false;
  return String(event.data?.status ?? 'running').toLowerCase() === 'running';
}

export function latestToolEvents(events: ActivityItem[]): Map<string, ActivityItem> {
  const latest = new Map<string, ActivityItem>();
  const active = new Map<string, Map<string, ActivityItem>>();
  const chronological = [...events].sort((left, right) => activityTime(left.ts) - activityTime(right.ts));

  for (const event of chronological) {
    if (!event.tool || !['tool_call', 'tool_result', 'error'].includes(event.type)) continue;
    const tool = normalizeToolName(event.tool);
    const callId = typeof event.data?.call_id === 'string' ? event.data.call_id : tool;
    if (isToolRunning(event)) {
      const calls = active.get(tool) ?? new Map<string, ActivityItem>();
      calls.set(callId, event);
      active.set(tool, calls);
    } else {
      active.get(tool)?.delete(callId);
      latest.set(tool, event);
    }
  }

  for (const [tool, calls] of active) {
    const runningCall = [...calls.values()].at(-1);
    if (runningCall) latest.set(tool, runningCall);
  }
  return latest;
}

export function latestRunningTool(events: ActivityItem[]): ActivityItem | undefined {
  const runningEvents = [...latestToolEvents(events).values()].filter(isToolRunning);
  return runningEvents.sort((left, right) => activityTime(left.ts) - activityTime(right.ts)).at(-1);
}

export function findToolEvent(
  tool: { name: string; aliases?: string[] },
  events: Map<string, ActivityItem>,
): ActivityItem | undefined {
  for (const name of [tool.name, ...(tool.aliases ?? [])]) {
    const event = events.get(normalizeToolName(name));
    if (event) return event;
  }
  return undefined;
}
