import type { EventPayload } from "../types/event.js";

// SSEClient represents a connected dashboard client.
export interface SSEClient {
  id: string;
  tenantId: string;
  role: string;
  // hasTenantEventAccess = true means the client may receive all tenant events.
  // allowedProjects is used only for project-scoped event visibility.
  hasTenantEventAccess: boolean;
  // null = full tenant event visibility.
  // Set<string> = receives only events whose project_id is in this set.
  allowedProjects: Set<string> | null;
  // projectFilter: when non-null, the client subscribed to a specific project endpoint
  // and should only receive events for that project regardless of role.
  projectFilter: string | null;
  send: (event: EventPayload) => void;
  close: () => void;
}

// SubscriptionManager is the in-memory fan-out hub.
// One instance per API process. All SSE connections register here.
//
// Multi-pod deployments: wire in a RedisAdapter that calls publish() when
// events arrive from other pods. The RedisAdapter is the only external caller;
// all in-process paths go through publish() directly.
export class SubscriptionManager {
  // Clients indexed by tenantId for O(1) fan-out to a tenant's connections.
  private clients = new Map<string, Set<SSEClient>>();

  // subscribe registers a client and returns an unsubscribe function.
  subscribe(client: SSEClient): () => void {
    let tenantClients = this.clients.get(client.tenantId);
    if (!tenantClients) {
      tenantClients = new Set();
      this.clients.set(client.tenantId, tenantClients);
    }
    tenantClients.add(client);

    return () => {
      tenantClients.delete(client);
      if (tenantClients.size === 0) {
        this.clients.delete(client.tenantId);
      }
    };
  }

  // publish fans out an event to all eligible clients subscribed to the tenant.
  // Security is enforced here: project-scoped clients receive only events from
  // their allowed projects; project-filtered clients only receive their project.
  publish(tenantId: string, event: EventPayload): void {
    const tenantClients = this.clients.get(tenantId);
    if (!tenantClients || tenantClients.size === 0) return;

    for (const client of tenantClients) {
      if (!this.clientShouldReceive(client, event)) continue;
      try {
        client.send(event);
      } catch {
        // Client stream has closed — remove it.
        client.close();
      }
    }
  }

  private clientShouldReceive(client: SSEClient, event: EventPayload): boolean {
    // Project-scoped connection: only deliver events for the subscribed project.
    if (client.projectFilter !== null) {
      return event.project_id === client.projectFilter;
    }
    // Full tenant event visibility.
    if (client.hasTenantEventAccess || client.allowedProjects === null)
      return true;
    // Project-scoped event visibility.
    return (
      event.project_id !== null && client.allowedProjects.has(event.project_id)
    );
  }

  // clientCount returns the number of connected clients for a tenant (for monitoring).
  clientCount(tenantId: string): number {
    return this.clients.get(tenantId)?.size ?? 0;
  }
}

// Singleton instance shared across all routes and the gateway handler.
export const subscriptionManager = new SubscriptionManager();
