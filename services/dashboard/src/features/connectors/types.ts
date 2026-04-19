export interface ConnectorConfig {
  cacheTtlSeconds: number;
  responseTimeoutMs: number;
  backgroundTimeoutMs: number;
}

export interface Connector {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  homepage: string;
  config: ConnectorConfig;
}
