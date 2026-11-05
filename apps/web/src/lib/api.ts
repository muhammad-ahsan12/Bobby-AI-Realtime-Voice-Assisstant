export type ActivityType =
  | 'tool_call'
  | 'tool_result'
  | 'approval'
  | 'error'
  | 'info'
  | 'agent_state'
  | 'transcript'
  | 'toolset_status'
  | 'session';

export interface ActivityData {
  call_id?: string;
  group?: string;
  status?: string;
  duration_ms?: number;
  role?: 'user' | 'assistant';
  text?: string;
  language?: string | null;
  is_final?: boolean;
  state?: string;
  tool_count?: number;
  session_id?: string;
  [key: string]: unknown;
}

export interface ActivityItem {
  id: string;
  ts: number | string;
  type: ActivityType;
  tool?: string;
  message: string;
  data?: ActivityData;
}

interface TokenResponse {
  token?: string;
  url?: string;
  room?: string;
  identity?: string;
}

const ACTIVITY_TYPES: ActivityType[] = [
  'info',
  'tool_call',
  'tool_result',
  'approval',
  'error',
  'agent_state',
  'transcript',
  'toolset_status',
  'session',
];

export function parseActivityItem(value: unknown): ActivityItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string' || !ACTIVITY_TYPES.includes(event.type as ActivityType)) {
    return null;
  }

  const data =
    typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
      ? (event.data as ActivityData)
      : undefined;
  const ts =
    typeof event.ts === 'number' || typeof event.ts === 'string' ? event.ts : Date.now();

  return {
    id: typeof event.id === 'string' ? event.id : crypto.randomUUID(),
    ts,
    type: event.type as ActivityType,
    tool: typeof event.tool === 'string' ? event.tool : undefined,
    message: typeof event.message === 'string' ? event.message : '',
    data,
  };
}

export function getHttpBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_URL;
  return configuredUrl?.trim()
    ? configuredUrl.replace(/\/+$/, '')
    : 'http://127.0.0.1:8000';
}

export function getWsBaseUrl(): string {
  return getHttpBaseUrl().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

export async function getActivityHistory(signal?: AbortSignal): Promise<ActivityItem[]> {
  const response = await fetch(`${getHttpBaseUrl()}/api/activity`, { signal });
  if (!response.ok) {
    throw new Error(`Activity history request failed (${response.status} ${response.statusText}).`);
  }
  const result: unknown = await response.json();
  if (!Array.isArray(result)) {
    throw new Error('Backend activity history response was not a list.');
  }
  return result
    .map(parseActivityItem)
    .filter((item): item is ActivityItem => item !== null);
}

export async function getToken(): Promise<{ token: string; url: string }> {
  const baseUrl = getHttpBaseUrl();
  const endpoint = `${baseUrl}/api/token`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Token request failed (${response.status} ${response.statusText}).`);
    }

    const result: TokenResponse = await response.json();
    if (!result.token || !result.url) {
      throw new Error('Backend response did not include a LiveKit token and URL.');
    }
    return { token: result.token, url: result.url };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Backend request timed out. Check that Bobby's backend is running at ${baseUrl}.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach Bobby's backend at ${baseUrl}. Check that it is running.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
