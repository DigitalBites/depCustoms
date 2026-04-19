import { randomUUID } from "node:crypto";

export class McpTransportSessionService {
  resolveOrCreate(sessionId: string | null | undefined): string {
    return sessionId?.trim() || randomUUID();
  }
}

export const mcpTransportSessionService = new McpTransportSessionService();
