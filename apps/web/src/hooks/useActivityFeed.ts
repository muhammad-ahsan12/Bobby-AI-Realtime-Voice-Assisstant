import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityItem,
  getActivityHistory,
  getWsBaseUrl,
  parseActivityItem,
} from '../lib/api';

export type FeedConnection = 'offline' | 'connecting' | 'connected' | 'reconnecting';

function timestampValue(item: ActivityItem): number {
  return typeof item.ts === 'number' ? item.ts : new Date(item.ts).getTime();
}

export function useActivityFeed(enabled = true) {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [connection, setConnection] = useState<FeedConnection>(
    enabled ? 'connecting' : 'offline',
  );
  const [error, setError] = useState<string | null>(null);
  const eventIds = useRef(new Set<string>());

  const addEvents = useCallback((incoming: ActivityItem[]) => {
    if (incoming.length === 0) return;
    setEvents((previous) => {
      const merged = new Map(previous.map((event) => [event.id, event]));
      for (const event of incoming) {
        merged.set(event.id, event);
        eventIds.current.add(event.id);
      }
      return [...merged.values()]
        .sort((left, right) => timestampValue(right) - timestampValue(left))
        .slice(0, 100);
    });
  }, []);

  const clearEvents = useCallback(() => {
    eventIds.current.clear();
    setEvents([]);
  }, []);
  const dismissError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      eventIds.current.clear();
      setConnection('offline');
      setError(null);
      return;
    }

    let active = true;
    let pageIsClosing = false;
    let retryDelay = 1000;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const abortController = new AbortController();

    const loadHistory = async () => {
      try {
        const history = await getActivityHistory(abortController.signal);
        if (active) addEvents(history);
      } catch (loadError: unknown) {
        if (!active || (loadError instanceof Error && loadError.name === 'AbortError')) return;
        const message =
          loadError instanceof Error ? loadError.message : 'Activity history could not be loaded.';
        setError(message);
        console.warn('Could not load Bobby activity history:', message);
      }
    };

    const scheduleReconnect = () => {
      if (!active || pageIsClosing || reconnectTimer !== null) return;
      setConnection('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        retryDelay = Math.min(retryDelay * 2, 8000);
        connect();
      }, retryDelay);
    };

    const connect = () => {
      if (
        !active ||
        pageIsClosing ||
        (socket &&
          (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
      ) {
        return;
      }

      setConnection(retryDelay === 1000 ? 'connecting' : 'reconnecting');
      try {
        socket = new WebSocket(`${getWsBaseUrl()}/ws/activity`);
        const currentSocket = socket;
        currentSocket.onopen = () => {
          if (!active || socket !== currentSocket) return;
          retryDelay = 1000;
          setConnection('connected');
        };
        currentSocket.onmessage = (message) => {
          if (!active || socket !== currentSocket) return;
          try {
            const event = parseActivityItem(JSON.parse(message.data) as unknown);
            if (event) addEvents([event]);
            else console.warn('Ignoring an unsupported Bobby activity event.');
          } catch (parseError: unknown) {
            console.warn('Could not parse a Bobby activity event:', parseError);
          }
        };
        currentSocket.onerror = () => {
          if (active && socket === currentSocket) setConnection('reconnecting');
        };
        currentSocket.onclose = () => {
          if (socket === currentSocket) socket = null;
          if (active && !pageIsClosing) scheduleReconnect();
        };
      } catch (connectError: unknown) {
        const message =
          connectError instanceof Error ? connectError.message : 'Activity stream could not open.';
        setError(message);
        console.error('Could not open Bobby activity WebSocket:', message);
        scheduleReconnect();
      }
    };

    const handlePageHide = () => {
      pageIsClosing = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close();
      socket = null;
    };

    void loadHistory();
    connect();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      active = false;
      abortController.abort();
      window.removeEventListener('pagehide', handlePageHide);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    };
  }, [addEvents, enabled]);

  return { events, connection, error, addEvents, clearEvents, dismissError };
}
