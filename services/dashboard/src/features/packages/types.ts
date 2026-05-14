export interface PackageUsage {
  id: string;
  package_id: string;
  package_version_id: string;
  ecosystem: string;
  name: string;
  /** Compatibility alias for older API consumers; prefer name in UI code. */
  package: string;
  version: string;
  used_version: string;
  used_version_published_at?: string | null;
  is_latest?: boolean;
  latest_package_version_id?: string | null;
  latest_version: string | null;
  latest_version_published_at?: string | null;
  request_count: number;
  allow_count: number;
  block_count: number;
  first_seen_at: string;
  last_seen_at: string;
}
