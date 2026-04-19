import { useEffect, useRef, useState, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

// Max events kept in the live buffer. Older entries are dropped to prevent
// unbounded memory growth during high-throughput periods.
const MAX_LIVE_EVENTS = 200;

interface UseSSEResult<T> {
  events: T[];
  connected: boolean;
  connecting: boolean;
}

/**
 * useSSE subscribes to a Server-Sent Events stream from the Customs API.
 *
 * Security model:
 *   - JWT is validated by the API on connection. Only events the user is
 *     permitted to see are delivered (tenant-wide or project-scoped, depending
 *     on the user's event capabilities).
 *   - SSE is a long-lived connection. When the JWT expires the server sends
 *     `event: auth_expired`. The hook refreshes the session and reconnects,
 *     sending Last-Event-ID so missed events are replayed.
 *
 * @param path            Dashboard SSE proxy path, e.g. '/dashboard-events/stream'
 * @param initialCursor   ISO timestamp of the most recent already-fetched event.
 *                        Passed as last_event_id on the first connect so the
 *                        server replays anything inserted between the REST fetch
 *                        and the SSE connection being established.
 */
export function useSSE<T>(
  path: string,
  initialCursor?: string | null,
): UseSSEResult<T> {
  const [sseEvents, setSseEvents] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);

  // Tracks the id: field of the last received event for reconnect catchup.
  // Seeded with initialCursor on first connect to close the REST-fetch/SSE gap.
  const lastEventIdRef = useRef<string | null>(initialCursor ?? null);
  // Guards against stale closures in the cleanup path.
  const abortRef = useRef<AbortController | null>(null);
  // Stable path reference — reconnect when path changes.
  const pathRef = useRef(path);
  pathRef.current = path;

  const connect = useCallback(async () => {
    // Cancel any existing connection.
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    // Confirm that a browser session exists before opening the same-origin SSE route.
    const supabase = createBrowserClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setConnected(false);
      setConnecting(false);
      return;
    }

    // EventSource cannot send custom headers, so the browser connects to a
    // same-origin dashboard route outside the public API namespace. That route
    // authenticates using the server-side session cookie and forwards
    // Authorization to the internal API.
    const sseUrl = new URL(pathRef.current, window.location.origin);
    if (lastEventIdRef.current) {
      sseUrl.searchParams.set("last_event_id", lastEventIdRef.current);
    }

    let eventSource: EventSource;
    try {
      eventSource = new EventSource(sseUrl.toString());
    } catch {
      setConnected(false);
      return;
    }

    // connected event is sent by the server immediately on stream open to flush
    // headers through intermediate proxies so we don't wait for a real event.
    eventSource.addEventListener("connected", () => {
      if (!abort.signal.aborted) {
        setConnected(true);
        setConnecting(false);
      }
    });

    eventSource.onerror = () => {
      if (abort.signal.aborted) return;
      setConnected(false);
      setConnecting(false);
      eventSource.close();
      // EventSource auto-reconnects, but we control reconnect to refresh the JWT.
      // Small delay then reconnect.
      setTimeout(() => {
        if (!abort.signal.aborted) void connect();
      }, 2_000);
    };

    // Standard event messages.
    eventSource.addEventListener("message", (e: MessageEvent) => {
      if (abort.signal.aborted) return;
      try {
        const event = JSON.parse(e.data) as T;
        if (e.lastEventId) {
          lastEventIdRef.current = e.lastEventId;
        }
        setSseEvents((prev) => [event, ...prev].slice(0, MAX_LIVE_EVENTS));
      } catch {
        // ignore malformed events
      }
    });

    // Server sends this when the JWT is about to expire.
    eventSource.addEventListener("auth_expired", () => {
      void (async () => {
        eventSource.close();
        setConnected(false);
        if (abort.signal.aborted) return;
        // Refresh the Supabase session, then reconnect.
        await supabase.auth.refreshSession();
        if (!abort.signal.aborted) void connect();
      })();
    });

    // Cleanup on unmount or path change.
    abort.signal.addEventListener("abort", () => {
      eventSource.close();
      setConnected(false);
      setConnecting(false);
    });
  }, []); // stable — uses refs for path/lastEventId

  useEffect(() => {
    // Reset events and reconnect when path or initialCursor changes.
    // Including initialCursor in deps ensures the SSE reconnects (with cursor)
    // after the REST fetch seeds the cursor — enabling catchup for any events
    // that fired before the EventSource was established or while sse_clients=0.
    setSseEvents([]);
    lastEventIdRef.current = initialCursor ?? null;
    setConnecting(true);
    const timeoutId = window.setTimeout(() => {
      void connect();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      abortRef.current?.abort();
    };
  }, [path, connect, initialCursor]);

  return { events: sseEvents, connected, connecting };
}
