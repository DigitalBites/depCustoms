import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  dialect: 'postgresql',
  schema:
    process.env.NODE_ENV === 'production'
      ? './dist/db/schema.js'
      : './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Only manage the public schema. GoTrue owns the auth schema — never touch it.
  // tablesFilter further excludes GoTrue's schema_migrations tracker in public.
  tablesFilter: [
    'tenants', 'tenant_entitlements', 'memberships', 'projects',
    'project_members', 'project_tokens', 'policies', 'policy_rules',
    'connector_fields', 'connector_snapshots', 'policy_assignments', 'rules',
    'events', 'violations', 'policy_evaluations', 'violation_occurrences',
    'proxy_status_events', 'proxy_metadata_cache_stats', 'mcp_audit_events', 'proxies',
    'package_versions', 'packages', 'project_package_usage', 'package_cves',
    'contributor_release_facts', 'violation_suppressions', 'project_findings',
    'project_connector_syncs', 'alert_configs', 'connector_cache',
    'connector_cache_vulns',
  ],
  verbose: true,
  strict: true,
});
