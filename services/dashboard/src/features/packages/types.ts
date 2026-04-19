export interface PackageUsage {
  id: string;
  package_id: string;
  ecosystem: string;
  package: string;
  version: string;
  used_version?: string;
  used_version_published_at?: string | null;
  is_latest?: boolean;
  latest_version: string | null;
  latest_version_published_at?: string | null;
  request_count: number;
  allow_count: number;
  block_count: number;
  first_seen_at: string;
  last_seen_at: string;
}
