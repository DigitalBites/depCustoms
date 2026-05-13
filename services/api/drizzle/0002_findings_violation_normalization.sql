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
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz NOT NULL,
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
	"effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz NOT NULL,
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
ALTER TABLE "policy_assignments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "policy_assignments" CASCADE;--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_policy_id_policies_id_fk";
--> statement-breakpoint
ALTER TABLE "violation_suppressions" DROP CONSTRAINT "violation_suppressions_rule_id_rules_id_fk";
--> statement-breakpoint
DROP INDEX "rules_policy_id_idx";--> statement-breakpoint
DROP INDEX "rules_policy_order_idx";--> statement-breakpoint
DROP INDEX "pf_project_connector_package_finding_idx";--> statement-breakpoint
DROP INDEX "pf_project_status_severity_idx";--> statement-breakpoint
DROP INDEX "pf_project_package_connector_idx";--> statement-breakpoint
DROP INDEX "violations_active_package_idx";--> statement-breakpoint
DROP INDEX "violations_project_package_idx";--> statement-breakpoint
DROP INDEX "vs_project_package_rule_idx";--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "policy_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "rule_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "effective_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD COLUMN "project_token_id" uuid;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD COLUMN "status_at_occurrence" text NOT NULL;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD COLUMN "suppression_id" uuid;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD COLUMN "occurred_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "policy_rule_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "policy_project_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "policy_rule_binding_id_key" uuid GENERATED ALWAYS AS (COALESCE(policy_rule_binding_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "policy_project_binding_id_key" uuid GENERATED ALWAYS AS (COALESCE(policy_project_binding_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "status_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "status_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_findings" ADD COLUMN "finding_key" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_findings" ADD COLUMN "current_finding_version_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_findings" ADD COLUMN "observed_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_findings" ADD COLUMN "observed_to" timestamp with time zone DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz NOT NULL;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD COLUMN "rule_key" uuid;--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "policy_project_bindings" ADD CONSTRAINT "policy_project_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_project_bindings" ADD CONSTRAINT "policy_project_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_bindings" ADD CONSTRAINT "policy_rule_bindings_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_evaluation_id_policy_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."policy_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_policies" ADD CONSTRAINT "policy_evaluation_policies_policy_project_binding_id_policy_project_bindings_id_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_evaluation_id_policy_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."policy_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_policy_rule_binding_id_policy_rule_bindings_id_fk" FOREIGN KEY ("policy_rule_binding_id") REFERENCES "public"."policy_rule_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluation_rules" ADD CONSTRAINT "policy_evaluation_rules_policy_project_binding_id_policy_project_bindings_id_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_violation_id_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_project_finding_id_project_findings_id_fk" FOREIGN KEY ("project_finding_id") REFERENCES "public"."project_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_finding_version_id_finding_versions_id_fk" FOREIGN KEY ("finding_version_id") REFERENCES "public"."finding_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_findings" ADD CONSTRAINT "violation_findings_connector_cache_id_connector_cache_id_fk" FOREIGN KEY ("connector_cache_id") REFERENCES "public"."connector_cache"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_versions" ADD CONSTRAINT "finding_versions_finding_key_findings_finding_key_fk" FOREIGN KEY ("finding_key") REFERENCES "public"."findings"("finding_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_versions" ADD CONSTRAINT "finding_versions_connector_cache_id_connector_cache_id_fk" FOREIGN KEY ("connector_cache_id") REFERENCES "public"."connector_cache"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_key_version_idx" ON "policy_project_bindings" USING btree ("binding_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_current_key_idx" ON "policy_project_bindings" USING btree ("binding_key") WHERE "policy_project_bindings"."effective_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_bindings_current_policy_project_idx" ON "policy_project_bindings" USING btree ("tenant_id","project_id","policy_key") WHERE "policy_project_bindings"."effective_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE INDEX "policy_project_bindings_policy_project_idx" ON "policy_project_bindings" USING btree ("policy_key","project_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_tenant_id_idx" ON "policy_project_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_project_id_idx" ON "policy_project_bindings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "policy_project_bindings_policy_key_idx" ON "policy_project_bindings" USING btree ("policy_key");--> statement-breakpoint
CREATE INDEX "policy_rule_bindings_policy_id_idx" ON "policy_rule_bindings" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_rule_bindings_rule_id_idx" ON "policy_rule_bindings" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_bindings_policy_rule_idx" ON "policy_rule_bindings" USING btree ("policy_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_bindings_policy_order_idx" ON "policy_rule_bindings" USING btree ("policy_id","order_index");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_eval_idx" ON "policy_evaluation_policies" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_policy_idx" ON "policy_evaluation_policies" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_policies_project_idx" ON "policy_evaluation_policies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_eval_idx" ON "policy_evaluation_rules" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_rule_idx" ON "policy_evaluation_rules" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "policy_evaluation_rules_binding_idx" ON "policy_evaluation_rules" USING btree ("policy_rule_binding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "violation_findings_unique_idx" ON "violation_findings" USING btree ("violation_id","project_finding_id","finding_version_id");--> statement-breakpoint
CREATE INDEX "violation_findings_violation_idx" ON "violation_findings" USING btree ("violation_id");--> statement-breakpoint
CREATE INDEX "violation_findings_project_finding_idx" ON "violation_findings" USING btree ("project_finding_id");--> statement-breakpoint
CREATE INDEX "violation_findings_finding_version_idx" ON "violation_findings" USING btree ("finding_version_id");--> statement-breakpoint
CREATE INDEX "violation_findings_connector_cache_idx" ON "violation_findings" USING btree ("connector_cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_versions_key_version_idx" ON "finding_versions" USING btree ("finding_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_versions_current_key_idx" ON "finding_versions" USING btree ("finding_key") WHERE "finding_versions"."effective_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE INDEX "finding_versions_finding_key_idx" ON "finding_versions" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX "finding_versions_connector_cache_idx" ON "finding_versions" USING btree ("connector_cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_connector_external_idx" ON "findings" USING btree ("connector_key","external_finding_id");--> statement-breakpoint
CREATE INDEX "findings_connector_idx" ON "findings" USING btree ("connector_key");--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_project_token_id_project_tokens_id_fk" FOREIGN KEY ("project_token_id") REFERENCES "public"."project_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violation_occurrences" ADD CONSTRAINT "violation_occurrences_suppression_id_violation_suppressions_id_fk" FOREIGN KEY ("suppression_id") REFERENCES "public"."violation_suppressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_policy_rule_binding_id_policy_rule_bindings_id_fk" FOREIGN KEY ("policy_rule_binding_id") REFERENCES "public"."policy_rule_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_policy_project_binding_id_policy_project_bindings_id_fk" FOREIGN KEY ("policy_project_binding_id") REFERENCES "public"."policy_project_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_finding_key_findings_finding_key_fk" FOREIGN KEY ("finding_key") REFERENCES "public"."findings"("finding_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_current_finding_version_id_finding_versions_id_fk" FOREIGN KEY ("current_finding_version_id") REFERENCES "public"."finding_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policies_policy_key_idx" ON "policies" USING btree ("policy_key");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_current_policy_key_idx" ON "policies" USING btree ("policy_key") WHERE "policies"."effective_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE UNIQUE INDEX "policies_policy_key_version_idx" ON "policies" USING btree ("policy_key","version");--> statement-breakpoint
CREATE INDEX "rules_rule_key_idx" ON "rules" USING btree ("rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_current_rule_key_idx" ON "rules" USING btree ("rule_key") WHERE "rules"."effective_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_rule_key_version_idx" ON "rules" USING btree ("rule_key","version");--> statement-breakpoint
CREATE INDEX "violation_occurrences_project_token_idx" ON "violation_occurrences" USING btree ("project_token_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_source_event_idx" ON "violation_occurrences" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "violation_occurrences_suppression_idx" ON "violation_occurrences" USING btree ("suppression_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pf_project_package_finding_observed_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id","finding_key","observed_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pf_current_project_package_finding_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id","finding_key") WHERE "project_findings"."observed_to" = '9999-12-31 23:59:59.999+00'::timestamptz;--> statement-breakpoint
CREATE INDEX "pf_project_package_idx" ON "project_findings" USING btree ("project_id","package_id","package_version_id");--> statement-breakpoint
CREATE INDEX "pf_finding_key_idx" ON "project_findings" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX "pf_current_finding_version_idx" ON "project_findings" USING btree ("current_finding_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "violations_active_package_idx" ON "violations" USING btree ("tenant_id","project_id","entity_type","package_id_key","package_version_id_key","policy_id_key","rule_id_key","policy_rule_binding_id_key","policy_project_binding_id_key","enforcement_mode","code") WHERE (status = ANY (ARRAY['open'::text, 'suppressed'::text]));--> statement-breakpoint
CREATE INDEX "violations_project_package_idx" ON "violations" USING btree ("tenant_id","project_id","entity_type","package_id","package_version_id","policy_id","rule_id","policy_rule_binding_id","policy_project_binding_id","enforcement_mode","code");--> statement-breakpoint
CREATE INDEX "vs_project_package_rule_idx" ON "violation_suppressions" USING btree ("project_id","package_id","package_version_id","rule_key");--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "policy_id";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "order_index";--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "rule_name";--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "policy_name";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "connector_key";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "finding_id";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "status_note";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "status_updated_by";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "status_updated_at";--> statement-breakpoint
ALTER TABLE "project_findings" DROP COLUMN "first_seen_at";--> statement-breakpoint
ALTER TABLE "violation_suppressions" DROP COLUMN "rule_id";--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_valid_window" CHECK ("policies"."effective_from" < "policies"."effective_to");--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_valid_window" CHECK ("rules"."effective_from" < "rules"."effective_to");--> statement-breakpoint
ALTER TABLE "project_findings" ADD CONSTRAINT "project_findings_valid_observation_window" CHECK ("project_findings"."observed_from" < "project_findings"."observed_to");--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "violation_suppressions_package_scope" CHECK ("violation_suppressions"."package_id" IS NOT NULL OR "violation_suppressions"."package_version_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "violation_suppressions" ADD CONSTRAINT "violation_suppressions_valid_expiry" CHECK ("violation_suppressions"."expires_at" IS NULL OR "violation_suppressions"."expires_at" > "violation_suppressions"."created_at");