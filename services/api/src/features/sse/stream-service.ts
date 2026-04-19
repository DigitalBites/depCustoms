import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { subscriptionManager } from "../../sse/subscription-manager.js";
import {
  AUTH_EXPIRED_EVENT,
  CONNECTED_EVENT,
  formatSSEEvent,
  PING_EVENT,
} from "./stream-format.js";
import { replayMissedEvents, resolveAllowedProjects } from "./stream-replay.js";

export async function openEventStream(
  c: Context,
  projectFilter: string | null,
) {
  const { tenantId, role, hasTenantEventAccess, allowedProjects } =
    await resolveAllowedProjects(c);

  const lastEventId =
    c.req.header("Last-Event-ID") ?? c.req.query("last_event_id") ?? null;
  const jwtExpiry = parseJwtExpiry(c);
  const clientId = randomUUID();

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  let closed = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let authTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeFn: (() => void) | null = null;

  function doCleanup() {
    if (closed) return;
    closed = true;
    if (pingInterval) clearInterval(pingInterval);
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (authTimer) clearTimeout(authTimer);
    if (unsubscribeFn) unsubscribeFn();
  }

  return c.body(
    new ReadableStream({
      async start(controller) {
        const encode = (value: string) => new TextEncoder().encode(value);

        function write(chunk: string) {
          if (closed) return;
          try {
            controller.enqueue(encode(chunk));
          } catch {
            doCleanup();
          }
        }

        write(CONNECTED_EVENT);
        await replayMissedEvents({
          tenantId,
          role,
          hasTenantEventAccess,
          projectFilter,
          allowedProjects,
          lastEventId,
          write,
        });

        unsubscribeFn = subscriptionManager.subscribe({
          id: clientId,
          tenantId,
          role,
          hasTenantEventAccess,
          allowedProjects,
          projectFilter,
          send: (event) => write(formatSSEEvent(event)),
          close: () => {
            doCleanup();
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
        });

        pingInterval = setInterval(() => write(PING_EVENT), 30_000);

        if (jwtExpiry) {
          const msUntilExpiry = jwtExpiry.getTime() - Date.now();
          if (msUntilExpiry > 0) {
            authTimer = setTimeout(() => {
              write(AUTH_EXPIRED_EVENT);
              doCleanup();
              try {
                controller.close();
              } catch {
                // already closed
              }
            }, msUntilExpiry);
          }
        }

        cleanupTimer = setInterval(() => {
          if (closed) {
            clearInterval(cleanupTimer!);
            cleanupTimer = null;
          }
        }, 1_000);
      },

      cancel() {
        doCleanup();
      },
    }),
  );
}

function parseJwtExpiry(c: Context): Date | null {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : (c.req.query("token") ?? "");

  if (!token) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}
