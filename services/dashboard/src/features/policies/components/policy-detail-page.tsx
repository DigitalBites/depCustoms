"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ENFORCEMENT_MODE,
  ENFORCEMENT_MODES,
  POLICY_SCOPE,
  POLICY_STATUS,
  POLICY_STATUSES,
} from "@customs/shared-constants";
import { useDashboard } from "@/components/dashboard-provider";
import {
  EnforcementBadge,
  ScopeBadge,
  StatusBadge,
} from "@/components/policy/policy-badge";
import { useTenantProjects } from "@/features/projects/hooks";
import {
  usePolicyDetail,
  usePolicyEditor,
  usePolicyRuleMutations,
} from "@/features/policies/hooks";
import { canPerform } from "@/lib/dashboard-capabilities";
import { ViolationsPanel } from "@/features/violations/components/violations-panel";
import type { Rule } from "@/features/policies/types";
import { deletePolicy } from "@/features/policies/api";
import { getUserErrorMessage } from "@/lib/api-error";

type Tab = "rules" | "violations";

export function PolicyDetailPage({ policyId }: { policyId: string | null }) {
  const { role } = useDashboard();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("rules");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editEnforcement, setEditEnforcement] = useState("");
  const [editPriority, setEditPriority] = useState(100);
  const [editStatus, setEditStatus] = useState("");
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<string | null>(
    null,
  );
  const [violationsRuleFilter, setViolationsRuleFilter] = useState("");
  const {
    policy,
    rules,
    ruleViolationCounts,
    loading,
    error,
    setError,
    reload,
  } = usePolicyDetail(policyId);
  const { saving, saveError, save } = usePolicyEditor(policyId ?? "");
  const { deletingRuleId, togglingRuleId, removeRule, toggleRule } =
    usePolicyRuleMutations(policyId ?? "", setError);
  const { projects, loading: loadingProjects } = useTenantProjects({
    enabled: policy?.scope === POLICY_SCOPE.PROJECT,
    suppressErrors: true,
  });

  function startEdit() {
    if (!policy) return;
    setEditName(policy.name);
    setEditDescription(policy.description ?? "");
    setEditEnforcement(policy.enforcement_mode);
    setEditPriority(policy.priority);
    setEditStatus(policy.status);
    setEditing(true);
  }

  async function handleSavePolicy(e: FormEvent) {
    e.preventDefault();
    if (!policy) return;

    const updatedPolicy = await save({
      name: editName,
      description: editDescription,
      enforcementMode: editEnforcement,
      priority: editPriority,
      status: editStatus,
    });

    if (updatedPolicy) {
      setEditing(false);
      if (updatedPolicy.id !== policy.id) {
        router.replace(`/policy-engine/${updatedPolicy.id}`);
      } else {
        await reload();
      }
    }
  }

  async function handleDeleteRule(ruleId: string) {
    const result = await removeRule(ruleId);
    if (result.ok) {
      setConfirmDeleteRule(null);
      if (result.policyId && result.policyId !== policyId) {
        router.replace(`/policy-engine/${result.policyId}`);
      } else {
        await reload();
      }
    }
  }

  async function handleToggleRule(rule: Rule) {
    const result = await toggleRule(rule);
    if (result.ok) {
      if (result.policyId && result.policyId !== policyId) {
        router.replace(`/policy-engine/${result.policyId}`);
      } else {
        await reload();
      }
    }
  }

  async function handleDeletePolicy() {
    if (!policyId) return;
    try {
      await deletePolicy(policyId);
      router.push("/policy-engine");
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to delete policy"));
    }
  }

  if (loading)
    return <p className="py-8 text-sm text-muted-foreground">Loading…</p>;
  if (!policyId) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive">Invalid policy identifier.</p>
        <Link
          href="/policy-engine"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          ← Back to policies
        </Link>
      </div>
    );
  }
  if (error && !policy) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive">{error}</p>
        <Link
          href="/policy-engine"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          ← Back to policies
        </Link>
      </div>
    );
  }
  if (!policy) return null;

  const isArchived = policy.status === POLICY_STATUS.ARCHIVED;
  const canWritePolicy =
    policy.scope === POLICY_SCOPE.PROJECT
      ? canPerform(role, "policy.write_project")
      : canPerform(role, "policy.write_tenant");
  const canWriteRules = canPerform(role, "rules.write");
  const canAddRules = canWriteRules && !isArchived;
  const projectName = policy.project_id
    ? (projects.find((project) => project.id === policy.project_id)?.name ??
      `${policy.project_id.slice(0, 8)}…`)
    : null;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link
          href="/policy-engine"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Policies
        </Link>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-6">
        {editing ? (
          <form onSubmit={handleSavePolicy} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {policy.scope === POLICY_SCOPE.PROJECT ? (
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Project
                  </label>
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {loadingProjects
                      ? "Loading project…"
                      : (projectName ?? "Unknown project")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Project-scoped policies cannot be reassigned after creation.
                  </p>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Enforcement
                </label>
                <select
                  value={editEnforcement}
                  onChange={(e) => setEditEnforcement(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {ENFORCEMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode === ENFORCEMENT_MODE.ENFORCING
                        ? "Enforcing"
                        : mode === ENFORCEMENT_MODE.ADVISORY
                          ? "Advisory"
                          : "Disabled"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Priority
                </label>
                <input
                  type="number"
                  min={1}
                  value={editPriority}
                  onChange={(e) =>
                    setEditPriority(Number.parseInt(e.target.value, 10))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {POLICY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status === POLICY_STATUS.ARCHIVED
                        ? "Archived (permanent)"
                        : status === POLICY_STATUS.ACTIVE
                          ? "Active"
                          : "Draft"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {saveError ? (
              <p className="text-sm text-destructive">{saveError}</p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {policy.name}
                </h1>
                {policy.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {policy.description}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <ScopeBadge scope={policy.scope} />
                <EnforcementBadge mode={policy.enforcement_mode} />
                <StatusBadge status={policy.status} />
                {policy.category ? (
                  <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {policy.category}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                Priority {policy.priority} · v{policy.version} · {rules.length}{" "}
                rule{rules.length !== 1 ? "s" : ""}
              </div>
              {policy.scope === POLICY_SCOPE.PROJECT ? (
                <div className="text-xs text-muted-foreground">
                  Project ·{" "}
                  <span className="font-medium text-foreground">
                    {projectName ?? "Loading…"}
                  </span>
                </div>
              ) : null}
            </div>
            {canWritePolicy && !isArchived ? (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Edit
                </button>
                {policy.status === POLICY_STATUS.DRAFT && rules.length === 0 ? (
                  <button
                    type="button"
                    onClick={handleDeletePolicy}
                    className="rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex gap-0 border-b border-border">
        {(["rules", "violations"] as Tab[]).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "rules" ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Rules are evaluated in order. The first enforcing violation blocks
              the request.
            </p>
            <Link
              href={canAddRules ? `/policy-engine/${policyId}/rules/new` : "#"}
              aria-disabled={!canAddRules}
              onClick={(event) => {
                if (!canAddRules) event.preventDefault();
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
                canAddRules
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
              }`}
            >
              + Add rule
            </Link>
          </div>

          {rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No rules configured for this policy.
              </p>
              {canAddRules ? (
                <Link
                  href={`/policy-engine/${policyId}/rules/new`}
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Add the first rule →
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule, idx) => {
                const openViolations = ruleViolationCounts[rule.id] ?? 0;
                return (
                  <div
                    key={rule.id}
                    className={`rounded-lg border border-border bg-card p-4 ${!rule.enabled ? "opacity-60" : ""}`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {rule.name}
                            </span>
                            {!rule.enabled ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                disabled
                              </span>
                            ) : null}
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {rule.target_entity}
                            </span>
                            {rule.action.type === "violation" &&
                            rule.action.severity ? (
                              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                                {rule.action.severity}
                              </span>
                            ) : null}
                            {openViolations > 0 ? (
                              <Link
                                href={`/violations?rule_id=${rule.id}`}
                                className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 hover:underline dark:bg-red-900/20 dark:text-red-400"
                              >
                                {openViolations} open (30d)
                              </Link>
                            ) : null}
                          </div>
                          {rule.description ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {rule.description}
                            </p>
                          ) : null}
                          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            Code: {rule.action.code ?? "—"}
                          </p>
                        </div>
                      </div>

                      {canWriteRules && !isArchived ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleToggleRule(rule)}
                            disabled={togglingRuleId === rule.id}
                            className="rounded border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                          >
                            {rule.enabled ? "Disable" : "Enable"}
                          </button>
                          <Link
                            href={`/policy-engine/${policyId}/rules/${rule.id}`}
                            className="rounded border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            Edit
                          </Link>
                          {confirmDeleteRule === rule.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleDeleteRule(rule.id)}
                                disabled={deletingRuleId === rule.id}
                                className="rounded bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                {deletingRuleId === rule.id ? "…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRule(null)}
                                className="rounded border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteRule(rule.id)}
                              className="rounded border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-muted-foreground">
              Open violations from rules in this policy.
            </p>
            <select
              value={violationsRuleFilter}
              onChange={(e) => setViolationsRuleFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All rules</option>
              {rules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
          </div>

          <ViolationsPanel
            policyId={policyId}
            ruleId={violationsRuleFilter || undefined}
            showProjectColumn={true}
            showSummaryCards={false}
            emptyMessage="No open violations for this policy."
          />
        </div>
      )}
    </div>
  );
}
