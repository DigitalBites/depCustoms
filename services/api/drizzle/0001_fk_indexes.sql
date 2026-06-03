DROP INDEX "package_version_relationships_unique_idx";--> statement-breakpoint
ALTER TABLE "package_version_relationships" ADD CONSTRAINT "pvr_pk" PRIMARY KEY("parent_package_version_id","child_package_version_id","relationship_type");--> statement-breakpoint
CREATE INDEX "cs_tenant_id_idx" ON "connector_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "prb_tenant_id_idx" ON "policy_rule_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pep_tenant_id_idx" ON "policy_evaluation_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pep_ppb_id_idx" ON "policy_evaluation_policies" USING btree ("policy_project_binding_id");--> statement-breakpoint
CREATE INDEX "per_tenant_id_idx" ON "policy_evaluation_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "per_project_id_idx" ON "policy_evaluation_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "per_policy_id_idx" ON "policy_evaluation_rules" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "per_ppb_id_idx" ON "policy_evaluation_rules" USING btree ("policy_project_binding_id");--> statement-breakpoint
CREATE INDEX "vf_tenant_id_idx" ON "violation_findings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vf_project_id_idx" ON "violation_findings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "violations_prb_id_idx" ON "violations" USING btree ("policy_rule_binding_id");--> statement-breakpoint
CREATE INDEX "violations_ppb_id_idx" ON "violations" USING btree ("policy_project_binding_id");