CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"allowed_ecosystems" text[],
	"serve_mode" text DEFAULT 'SERVE_MODE_REDIRECT' NOT NULL,
	"cache_ttl_seconds" integer DEFAULT 300 NOT NULL,
	"mcp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_key" text NOT NULL,
	"field_key" text NOT NULL,
	"canonical_ref" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"data_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"operators" text[] NOT NULL,
	"enum_values" jsonb,
	"deprecated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"fields" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enforcement_mode" text DEFAULT 'enforcing' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00' NOT NULL,
	"superseded_by_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_project_consistency" CHECK (("policies"."scope" = 'global' AND "policies"."project_id" IS NULL) OR ("policies"."scope" = 'project' AND "policies"."project_id" IS NOT NULL)),
	CONSTRAINT "policies_valid_window" CHECK ("policies"."effective_from" < "policies"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "policy_project_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"inheritance_mode" text DEFAULT 'inherited' NOT NULL,
	"severity_override" text,
	"threshold_overrides" jsonb,
	"rule_overrides" jsonb,
	"enforcement_mode_override" text,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00' NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_project_bindings_valid_window" CHECK ("policy_project_bindings"."effective_from" < "policy_project_bindings"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "policy_rule_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_entity" text NOT NULL,
	"condition" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00' NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_valid_window" CHECK ("rules"."effective_from" < "rules"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"proxy_id" uuid NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"decision" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"decision_cache" boolean,
	"trace_id" text,
	"span_id" text,
	"request_id" text,
	"serve_mode" text,
	"bytes_transferred" bigint,
	"project_token_id" uuid,
	"client_ip" text,
	"proxy_ip" text,
	"duration_ms" integer,
	"decision_path" text,
	"raw_identity" jsonb,
	"requested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_decision_chk" CHECK (decision IN ('allow', 'block')),
	CONSTRAINT "events_source_chk" CHECK (source IN ('proxy', 'policy_engine')),
	CONSTRAINT "events_type_chk" CHECK (event_type IN ('metadata', 'artifact', 'upstream_error', 'proxy_request')),
	CONSTRAINT "events_serve_mode_chk" CHECK (serve_mode IS NULL OR serve_mode IN ('SERVE_MODE_REDIRECT', 'SERVE_MODE_PULL')),
	CONSTRAINT "events_decision_path_chk" CHECK (decision_path IS NULL OR decision_path IN ('cache_hit', 'check', 'control_plane_unavailable', 'bypass'))
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"client_name" text,
	"session_id" text,
	"method_name" text NOT NULL,
	"target" jsonb,
	"outcome" text NOT NULL,
	"trace_id" text,
	"request_id" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_evaluation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_project_binding_id" uuid,
	"effective_enforcement_mode" text NOT NULL,
	"result" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_evaluation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_rule_binding_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"policy_project_binding_id" uuid,
	"matched" boolean DEFAULT false NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"decision" text NOT NULL,
	"policies_evaluated" integer NOT NULL,
	"rules_evaluated" integer NOT NULL,
	"rules_matched" integer NOT NULL,
	"connector_snapshot_meta" jsonb NOT NULL,
	"field_values_at_evaluation" jsonb NOT NULL,
	"duration_ms" integer,
	"event_id" uuid,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_metadata_cache_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proxy_id" uuid NOT NULL,
	"ecosystem" text NOT NULL,
	"hits" bigint DEFAULT 0 NOT NULL,
	"misses" bigint DEFAULT 0 NOT NULL,
	"stale_hits" bigint DEFAULT 0 NOT NULL,
	"refreshes" bigint DEFAULT 0 NOT NULL,
	"parse_failures" bigint DEFAULT 0 NOT NULL,
	"store_failures" bigint DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proxy_id" uuid NOT NULL,
	"proxy_ip" text,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_status_events_type_chk" CHECK (event_type IN ('proxy_service_running', 'proxy_service_stopped', 'control_plane_unavailable', 'control_plane_available', 'token_exchange_attempt', 'token_issued', 'token_exchange_failed', 'proxy_disabled', 'proxy_enabled', 'secret_rotated', 'proxy_revoked'))
);
--> statement-breakpoint
CREATE TABLE "violation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"violation_id" uuid NOT NULL,
	"project_finding_id" uuid NOT NULL,
	"finding_version_id" uuid NOT NULL,
	"connector_cache_id" uuid,
	"relationship_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violation_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"violation_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"project_token_id" uuid,
	"source_event_id" uuid,
	"status_at_occurrence" text NOT NULL,
	"suppression_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" uuid,
	"policy_id" uuid,
	"policy_rule_binding_id" uuid,
	"policy_project_binding_id" uuid,
	"recommended_remediation" text,
	"entity_type" text NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"package_id_key" uuid GENERATED ALWAYS AS (COALESCE(package_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"package_version_id_key" uuid GENERATED ALWAYS AS (COALESCE(package_version_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"policy_id_key" uuid GENERATED ALWAYS AS (COALESCE(policy_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"rule_id_key" uuid GENERATED ALWAYS AS (COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"policy_rule_binding_id_key" uuid GENERATED ALWAYS AS (COALESCE(policy_rule_binding_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"policy_project_binding_id_key" uuid GENERATED ALWAYS AS (COALESCE(policy_project_binding_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"enforcement_mode" text NOT NULL,
	"blocked" boolean NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_note" text,
	"status_updated_by_user_id" uuid,
	"status_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proxy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_prev_hash" text,
	"secret_prev_expires_at" timestamp with time zone,
	"secret_prefix" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"secret_rotated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributor_package_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"fingerprint" text,
	"history_complete" boolean DEFAULT false NOT NULL,
	"oldest_included_published_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributor_release_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"source_kind" text,
	"source_payload_version" text,
	"source_payload" jsonb,
	"source_observed_at" timestamp with time zone,
	"publish_actor" text,
	"publish_actor_kind" text,
	"publisher_username" text,
	"publisher_display_name" text,
	"publisher_email" text,
	"publisher_id" text,
	"publisher_source" text,
	"has_trusted_publisher" boolean,
	"trusted_publisher_provider" text,
	"trusted_publisher_oidc_config_id" text,
	"maintainer_count" integer,
	"maintainers" text[],
	"maintainer_identities" jsonb,
	"maintainer_source" text,
	"has_install_scripts" boolean,
	"has_provenance" boolean,
	"publisher_seen_before_package" boolean,
	"publisher_seen_count_before" integer,
	"publisher_matches_prior_version" boolean,
	"prior_package_version_id" uuid,
	"prior_version_publish_actor" text,
	"maintainer_set_changed" boolean,
	"maintainers_added" text[],
	"maintainers_removed" text[],
	"new_maintainer_count" integer,
	"removed_maintainer_count" integer,
	"release_velocity_7d_at_publish" integer,
	"release_velocity_30d_at_publish" integer,
	"first_published_at_for_package" timestamp with time zone,
	"package_release_index" integer,
	"publisher_identity_confidence" numeric(5, 2),
	"history_complete" boolean,
	"contributor_slice_fingerprint" text,
	"contributor_slice_observed_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"version" text NOT NULL,
	"published_at" timestamp with time zone,
	"last_metadata_seen_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_versions_version_canonical_chk" CHECK ("package_versions"."version" = btrim("package_versions"."version") AND "package_versions"."version" <> '')
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecosystem" text NOT NULL,
	"package" text NOT NULL,
	"latest_package_version_id" uuid,
	"last_metadata_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_ecosystem_canonical_chk" CHECK ("packages"."ecosystem" = lower(btrim("packages"."ecosystem")) AND "packages"."ecosystem" <> ''),
	CONSTRAINT "packages_package_canonical_chk" CHECK ("packages"."package" = lower(btrim("packages"."package")) AND "packages"."package" <> '')
);
--> statement-breakpoint
CREATE TABLE "project_package_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"allow_count" integer DEFAULT 0 NOT NULL,
	"block_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"connector_key" text,
	"min_severity" text DEFAULT 'HIGH' NOT NULL,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" text NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"risk_tier" text NOT NULL,
	"risk_score" integer,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"remediation_available" boolean DEFAULT false NOT NULL,
	"best_remediation" text,
	"data" jsonb,
	"ttl_seconds" integer,
	"queried_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_key" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"connector_cache_id" uuid,
	"severity" text NOT NULL,
	"title" text,
	"description" text,
	"aliases" jsonb,
	"affected_ranges" jsonb,
	"fixed_versions" jsonb,
	"raw_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00' NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_versions_valid_window" CHECK ("finding_versions"."effective_from" < "finding_versions"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"finding_key" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_key" text NOT NULL,
	"external_finding_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_connector_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"synced_count" integer,
	"new_findings" integer,
	"reopened_count" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "project_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"package_id" uuid,
	"package_version_id" uuid,
	"finding_key" uuid NOT NULL,
	"current_finding_version_id" uuid NOT NULL,
	"observed_from" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00' NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_findings_valid_observation_window" CHECK ("project_findings"."observed_from" < "project_findings"."observed_to")
);
--> statement-breakpoint
CREATE TABLE "violation_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"package_id" uuid,
	"package_version_id" uuid,
	"rule_key" uuid,
	"created_by_user_id" uuid,
	"suppressed_by_user_id" uuid,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "violation_suppressions_package_scope" CHECK ("violation_suppressions"."package_id" IS NOT NULL OR "violation_suppressions"."package_version_id" IS NOT NULL),
	CONSTRAINT "violation_suppressions_valid_expiry" CHECK ("violation_suppressions"."expires_at" IS NULL OR "violation_suppressions"."expires_at" > "violation_suppressions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tokens" ADD CONSTRAINT "project_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tokens" ADD CONSTRAINT "project_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_snapshots" ADD CONSTRAINT "connector_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_snapshots" ADD CONSTRAINT "connector_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_snapshots" ADD CONSTRAINT "connector_snapshots_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_snapshots" ADD CONSTRAINT "connector_snapshots_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_project_bindings" ADD CONSTRAINT "policy_project_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_project_bindings" ADD CONSTRAINT "policy_project_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_token_id_project_tokens_id_fk" FOREIGN KEY ("project_token_id") REFERENCES "public"."project_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "pep_eval_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."policy_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "pep_ppb_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "per_eval_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."policy_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "per_prb_fk" FOREIGN KEY ("policy_rule_binding_id") REFERENCES "public"."policy_rule_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "per_ppb_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_metadata_cache_stats" ADD CONSTRAINT "proxy_metadata_cache_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_status_events" ADD CONSTRAINT "proxy_status_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_violation_id_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_project_finding_id_project_findings_id_fk" FOREIGN KEY ("project_finding_id") REFERENCES "public"."project_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_finding_version_id_finding_versions_id_fk" FOREIGN KEY ("finding_version_id") REFERENCES "public"."finding_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_connector_cache_id_connector_cache_id_fk" FOREIGN KEY ("connector_cache_id") REFERENCES "public"."connector_cache"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_violation_id_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_evaluation_id_policy_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."policy_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_project_token_id_project_tokens_id_fk" FOREIGN KEY ("project_token_id") REFERENCES "public"."project_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "vo_supp_fk" FOREIGN KEY ("suppression_id") REFERENCES "public"."violation_suppressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_prb_fk" FOREIGN KEY ("policy_rule_binding_id") REFERENCES "public"."policy_rule_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_ppb_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_package_facts" ADD CONSTRAINT "contributor_package_facts_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_release_facts" ADD CONSTRAINT "crf_pkg_ver_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_release_facts" ADD CONSTRAINT "crf_prior_pkg_ver_fk" FOREIGN KEY ("prior_package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_package_usage" ADD CONSTRAINT "project_package_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_package_usage" ADD CONSTRAINT "project_package_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_package_usage" ADD CONSTRAINT "project_package_usage_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_configs" ADD CONSTRAINT "alert_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_configs" ADD CONSTRAINT "alert_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_cache" ADD CONSTRAINT "connector_cache_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_cache" ADD CONSTRAINT "connector_cache_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_versions" ADD CONSTRAINT "finding_versions_finding_key_findings_finding_key_fk" FOREIGN KEY ("finding_key") REFERENCES "public"."findings"("finding_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_versions" ADD CONSTRAINT "finding_versions_connector_cache_id_connector_cache_id_fk" FOREIGN KEY ("connector_cache_id") REFERENCES "public"."connector_cache"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_connector_syncs" ADD CONSTRAINT "project_connector_syncs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_finding_key_findings_finding_key_fk" FOREIGN KEY ("finding_key") REFERENCES "public"."findings"("finding_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "pf_current_fv_fk" FOREIGN KEY ("current_finding_version_id") REFERENCES "public"."finding_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "violation_suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "violation_suppressions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "violation_suppressions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "vs_pkg_ver_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_tenant_id_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_idx" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_tenant_id_idx" ON "project_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "project_members_project_id_idx" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_tokens_project_id_idx" ON "project_tokens" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tokens_tenant_id_idx" ON "project_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "project_tokens_project_owner_idx" ON "project_tokens" USING btree ("project_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_tokens_token_hash_idx" ON "project_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "projects_tenant_id_idx" ON "projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_idx" ON "tenant_entitlements" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_fields_connector_field_idx" ON "connector_fields" USING btree ("connector_key","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_fields_canonical_ref_idx" ON "connector_fields" USING btree ("canonical_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_snapshots_key_idx" ON "connector_snapshots" USING btree ("project_id","connector_key","entity_type","package_id","package_version_id");--> statement-breakpoint
CREATE INDEX "connector_snapshots_project_package_idx" ON "connector_snapshots" USING btree ("project_id","entity_type","package_id","package_version_id");--> statement-breakpoint
CREATE INDEX "connector_snapshots_observed_idx" ON "connector_snapshots" USING btree ("project_id","connector_key","observed_at");--> statement-breakpoint
CREATE INDEX "connector_snapshots_package_id_idx" ON "connector_snapshots" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "connector_snapshots_package_version_id_idx" ON "connector_snapshots" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "policies_tenant_id_idx" ON "policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policies_policy_key_idx" ON "policies" USING btree ("policy_key");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_current_policy_key_idx" ON "policies" USING btree ("policy_key") WHERE "policies"."effective_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE UNIQUE INDEX "policies_policy_key_version_idx" ON "policies" USING btree ("policy_key","version");--> statement-breakpoint
CREATE INDEX "policies_project_id_idx" ON "policies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "policies_tenant_scope_status_idx" ON "policies" USING btree ("tenant_id","scope","status");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_key_version_idx" ON "policy_project_bindings" USING btree ("binding_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_current_key_idx" ON "policy_project_bindings" USING btree ("binding_key") WHERE "policy_project_bindings"."effective_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_current_policy_project_idx" ON "policy_project_bindings" USING btree ("tenant_id","project_id","policy_key") WHERE "policy_project_bindings"."effective_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE INDEX "policy_project_bindings_policy_project_idx" ON "policy_project_bindings" USING btree ("policy_key","project_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_tenant_id_idx" ON "policy_project_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_project_id_idx" ON "policy_project_bindings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_policy_key_idx" ON "policy_project_bindings" USING btree ("policy_key");--> statement-breakpoint
CREATE INDEX "policy_rule_bindings_policy_id_idx" ON "policy_rule_bindings" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_rule_bindings_rule_id_idx" ON "policy_rule_bindings" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_bindings_policy_rule_idx" ON "policy_rule_bindings" USING btree ("policy_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_bindings_policy_order_idx" ON "policy_rule_bindings" USING btree ("policy_id","order_index");--> statement-breakpoint
CREATE INDEX "rules_rule_key_idx" ON "rules" USING btree ("rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_current_rule_key_idx" ON "rules" USING btree ("rule_key") WHERE "rules"."effective_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE UNIQUE INDEX "rules_rule_key_version_idx" ON "rules" USING btree ("rule_key","version");--> statement-breakpoint
CREATE INDEX "rules_tenant_id_idx" ON "rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "events_project_id_idx" ON "events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "events_requested_at_idx" ON "events" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "events_package_id_idx" ON "events" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "events_package_version_id_idx" ON "events" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "events_decision_idx" ON "events" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "events_project_token_id_idx" ON "events" USING btree ("project_token_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_tenant_id_idx" ON "mcp_audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_project_id_idx" ON "mcp_audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_user_id_idx" ON "mcp_audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_method_name_idx" ON "mcp_audit_events" USING btree ("method_name");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_created_at_idx" ON "mcp_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_eval_idx" ON "policy_evaluation_policies" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_policy_idx" ON "policy_evaluation_policies" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_project_idx" ON "policy_evaluation_policies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_eval_idx" ON "policy_evaluation_rules" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_rule_idx" ON "policy_evaluation_rules" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_binding_idx" ON "policy_evaluation_rules" USING btree ("policy_rule_binding_id");--> statement-breakpoint
CREATE INDEX "policy_evaluations_project_idx" ON "policy_evaluations" USING btree ("project_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "policy_evaluations_package_id_idx" ON "policy_evaluations" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "policy_evaluations_package_version_id_idx" ON "policy_evaluations" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "policy_evaluations_event_id_idx" ON "policy_evaluations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "policy_evaluations_tenant_id_idx" ON "policy_evaluations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pmcs_tenant_id_idx" ON "proxy_metadata_cache_stats" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pmcs_proxy_id_idx" ON "proxy_metadata_cache_stats" USING btree ("proxy_id");--> statement-breakpoint
CREATE INDEX "pmcs_tenant_window_idx" ON "proxy_metadata_cache_stats" USING btree ("tenant_id","window_ended_at");--> statement-breakpoint
CREATE INDEX "proxy_status_events_tenant_id_idx" ON "proxy_status_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proxy_status_events_proxy_id_idx" ON "proxy_status_events" USING btree ("proxy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "violation_findings_unique_idx" ON "violation_findings" USING btree ("violation_id","project_finding_id","finding_version_id");--> statement-breakpoint
CREATE INDEX "violation_findings_violation_idx" ON "violation_findings" USING btree ("violation_id");--> statement-breakpoint
CREATE INDEX "violation_findings_project_finding_idx" ON "violation_findings" USING btree ("project_finding_id");--> statement-breakpoint
CREATE INDEX "violation_findings_finding_version_idx" ON "violation_findings" USING btree ("finding_version_id");--> statement-breakpoint
CREATE INDEX "violation_findings_connector_cache_idx" ON "violation_findings" USING btree ("connector_cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "violation_occurrences_violation_evaluation_idx" ON "violation_occurrences" USING btree ("violation_id","evaluation_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_violation_idx" ON "violation_occurrences" USING btree ("violation_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_evaluation_idx" ON "violation_occurrences" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_project_idx" ON "violation_occurrences" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_tenant_idx" ON "violation_occurrences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_project_token_idx" ON "violation_occurrences" USING btree ("project_token_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_source_event_idx" ON "violation_occurrences" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_suppression_idx" ON "violation_occurrences" USING btree ("suppression_id");--> statement-breakpoint
CREATE UNIQUE INDEX "violations_active_package_idx" ON "violations" USING btree ("tenant_id","project_id","entity_type","package_id_key","package_version_id_key","policy_id_key","rule_id_key","policy_rule_binding_id_key","policy_project_binding_id_key","enforcement_mode","code") WHERE (status = ANY (ARRAY['open'::text, 'suppressed'::text]));--> statement-breakpoint
CREATE INDEX "violations_project_package_idx" ON "violations" USING btree ("tenant_id","project_id","entity_type","package_id","package_version_id","policy_id","rule_id","policy_rule_binding_id","policy_project_binding_id","enforcement_mode","code");--> statement-breakpoint
CREATE INDEX "violations_project_status_idx" ON "violations" USING btree ("project_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "violations_package_id_idx" ON "violations" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "violations_package_version_id_idx" ON "violations" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "violations_rule_idx" ON "violations" USING btree ("rule_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "violations_tenant_id_idx" ON "violations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "violations_policy_id_idx" ON "violations" USING btree ("policy_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "proxies_tenant_id_idx" ON "proxies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proxies_proxy_id_idx" ON "proxies" USING btree ("proxy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cpf_package_id_idx" ON "contributor_package_facts" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "cpf_observed_at_idx" ON "contributor_package_facts" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crf_package_version_id_idx" ON "contributor_release_facts" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "crf_prior_package_version_id_idx" ON "contributor_release_facts" USING btree ("prior_package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_versions_pkg_ver_idx" ON "package_versions" USING btree ("package_id","version");--> statement-breakpoint
CREATE INDEX "package_versions_package_id_idx" ON "package_versions" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_versions_version_idx" ON "package_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "packages_eco_pkg_idx" ON "packages" USING btree ("ecosystem","package");--> statement-breakpoint
CREATE INDEX "packages_ecosystem_idx" ON "packages" USING btree ("ecosystem");--> statement-breakpoint
CREATE INDEX "packages_latest_package_version_id_idx" ON "packages" USING btree ("latest_package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppu_project_package_version_idx" ON "project_package_usage" USING btree ("project_id","package_version_id");--> statement-breakpoint
CREATE INDEX "ppu_tenant_id_idx" ON "project_package_usage" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppu_package_version_id_idx" ON "project_package_usage" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "ac_tenant_id_idx" ON "alert_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ac_project_id_idx" ON "alert_configs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_cache_connector_package_version_idx" ON "connector_cache" USING btree ("connector_id","package_version_id") WHERE "connector_cache"."package_version_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_cache_connector_package_scope_idx" ON "connector_cache" USING btree ("connector_id","package_id") WHERE "connector_cache"."package_id" IS NOT NULL AND "connector_cache"."package_version_id" IS NULL;--> statement-breakpoint
CREATE INDEX "connector_cache_queried_idx" ON "connector_cache" USING btree ("connector_id","queried_at");--> statement-breakpoint
CREATE INDEX "connector_cache_package_id_idx" ON "connector_cache" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "connector_cache_package_version_id_idx" ON "connector_cache" USING btree ("package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_versions_key_version_idx" ON "finding_versions" USING btree ("finding_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_versions_current_key_idx" ON "finding_versions" USING btree ("finding_key") WHERE "finding_versions"."effective_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE INDEX "finding_versions_finding_key_idx" ON "finding_versions" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX "finding_versions_connector_cache_idx" ON "finding_versions" USING btree ("connector_cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_connector_external_idx" ON "findings" USING btree ("connector_key","external_finding_id");--> statement-breakpoint
CREATE INDEX "findings_connector_idx" ON "findings" USING btree ("connector_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pcs_project_connector_idx" ON "project_connector_syncs" USING btree ("project_id","connector_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pf_project_package_finding_observed_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id","finding_key","observed_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pf_current_project_package_finding_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id","finding_key") WHERE "project_findings"."observed_to" = '9999-12-31 23:59:59.999+00';--> statement-breakpoint
CREATE INDEX "pf_project_package_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id");--> statement-breakpoint
CREATE INDEX "pf_finding_key_idx" ON "project_findings" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX "pf_current_finding_version_idx" ON "project_findings" USING btree ("current_finding_version_id");--> statement-breakpoint
CREATE INDEX "pf_package_id_idx" ON "project_findings" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "pf_package_version_id_idx" ON "project_findings" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "pf_tenant_id_idx" ON "project_findings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vs_project_package_rule_idx" ON "violation_suppressions" USING btree ("project_id","package_id","package_version_id","rule_key");--> statement-breakpoint
CREATE INDEX "vs_package_id_idx" ON "violation_suppressions" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "vs_package_version_id_idx" ON "violation_suppressions" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "vs_tenant_id_idx" ON "violation_suppressions" USING btree ("tenant_id");
