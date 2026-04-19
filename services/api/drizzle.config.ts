import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Only manage the public schema. GoTrue owns the auth schema — never touch it.
  // tablesFilter further excludes GoTrue's schema_migrations tracker in public.
  tablesFilter: [
    'tenants', 'tenant_entitlements', 'memberships', 'projects',
    'project_members', 'project_tokens', 'policies', 'policy_rules',
    'events', 'proxy_status_events', 'proxies',
    'package_versions', 'packages', 'project_package_usage', 'package_cves',
    'connector_cache', 'connector_cache_vulns',
  ],
  verbose: true,
  strict: true,
});
