"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/api-error";
import { useSSE } from "@/hooks/useSSE";
import type { EventMetrics, EventRecord } from "@/features/events/types";
import { DECISION, SERVE_MODE } from "@customs/shared-constants";

export function useEventsFeed() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseCursor, setSseCursor] = useState<string | null>(null);

  const {
    events: liveEvents,
    connected,
    connecting,
  } = useSSE<EventRecord>("/dashboard-events/stream", sseCursor);

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/events?limit=100")
      .then((data) => {
        const fetched = (data as { events: EventRecord[] }).events;
        setEvents((prev) => {
          if (prev.length === 0) return fetched;
          const fetchedIds = new Set(
            fetched.map((event) => event.id).filter(Boolean),
          );
          const sseOnly = prev.filter(
            (event) => event.id && !fetchedIds.has(event.id),
          );
          return sseOnly.length > 0 ? [...sseOnly, ...fetched] : fetched;
        });

        if (fetched.length > 0) {
          setSseCursor(fetched[0].created_at);
        }
      })
      .catch((err) => {
        setError(getUserErrorMessage(err, "Failed to load events"));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (liveEvents.length === 0) return;

    setEvents((prev) => {
      const prevIds = new Set(prev.map((event) => event.id).filter(Boolean));
      const toAdd = liveEvents.filter(
        (event) => !event.id || !prevIds.has(event.id),
      );
      if (toAdd.length === 0) return prev;
      return [...toAdd, ...prev];
    });
  }, [liveEvents]);

  const metrics = useMemo(() => computeEventMetrics(events), [events]);

  return {
    events,
    loading,
    error,
    connected,
    connecting,
    metrics,
  };
}

export function computeEventMetrics(events: EventRecord[]): EventMetrics {
  let allowed = 0;
  let blocked = 0;
  let pulls = 0;
  let redirects = 0;
  let totalBytes = 0;

  for (const event of events) {
    if (event.decision === DECISION.ALLOW) {
      allowed++;
    } else {
      blocked++;
    }

    if (event.serve_mode === SERVE_MODE.PULL) {
      pulls++;
      totalBytes += event.bytes_transferred ?? 0;
    } else if (event.serve_mode === SERVE_MODE.REDIRECT) {
      redirects++;
    }
  }

  return {
    total: events.length,
    allowed,
    blocked,
    pulls,
    redirects,
    totalBytes,
  };
}
