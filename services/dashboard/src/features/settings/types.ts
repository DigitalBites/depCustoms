export interface Entitlements {
  allowed_ecosystems: string[] | null;
  serve_mode: string;
  cache_ttl_seconds: number;
  mcp_enabled: boolean;
}
