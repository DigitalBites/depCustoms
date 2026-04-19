export interface ProxyRecord {
  id: string;
  proxy_id: string;
  name: string;
  status: "active" | "disabled" | "revoked";
  secret_prefix: string;
  secret_rotated_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface CreatedProxy {
  proxy_id: string;
  secret: string;
  name: string;
  status: "active";
  secret_prefix: string;
  message: string;
}

export interface RotatedProxySecret {
  proxy_id: string;
  secret: string;
  secret_prefix: string;
  secret_rotated_at: string | null;
  previous_secret_expires_at: string;
  message: string;
}

export interface ProxyStatusUpdate {
  proxy_id: string;
  status: "active" | "disabled" | "revoked";
}
