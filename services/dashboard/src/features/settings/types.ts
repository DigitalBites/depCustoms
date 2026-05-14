import type { ServeMode } from "@customs/shared-constants";

export interface Entitlements {
  allowed_ecosystems: string[] | null;
  serve_mode: ServeMode;
  cache_ttl_seconds: number;
  mcp_enabled: boolean;
}
