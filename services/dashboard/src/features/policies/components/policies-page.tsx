"use client";

import { useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/components/dashboard-provider";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { canPerform } from "@/lib/dashboard-capabilities";
import {
  StatusBadge,
  EnforcementBadge,
  ScopeBadge,
} from "@/components/policy/policy-badge";
import { TabBar } from "@/components/ui/tab-bar";
import {
  usePolicies,
  usePolicyMutations,
  usePolicyProjectNames,
} from "@/features/policies/hooks";
import type { Policy, ScopeFilter } from "@/features/policies/types";

const SCOPE_FILTER_TABS = [
  { value: "all", label: "All" },
  { value: "global", label: "Global" },
  { value: "project", label: "Project-scoped" },
] as const;

export function PoliciesPage() {
  const { tenantId, role } = useDashboard();
  const canCreatePolicy =
    canPerform(role, "policy.write_tenant") ||
    canPerform(role, "policy.write_project");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { policies, loading, error, setError, reload } = usePolicies({
    tenantId,
    scopeFilter,
  });
  const projectNames = usePolicyProjectNames(tenantId);
  const { deletingId, handleDelete, handleArchive } = usePolicyMutations({
    onSuccess: reload,
    onError: setError,
  });

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Policies"
        description="Manage tenant-level and project-level policies. Policies group rules that evaluate connector data and produce decisions on package requests."
        actions={
          <Link
            href={canCreatePolicy ? "/policy-engine/new" : "#"}
            aria-disabled={!canCreatePolicy}
            onClick={(event) => {
              if (!canCreatePolicy) event.preventDefault();
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
              canCreatePolicy
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground opacity-70"
            }`}
          >
            + New policy
          </Link>
        }
      />

      <TabBar
        items={SCOPE_FILTER_TABS}
        value={scopeFilter}
        onChange={setScopeFilter}
        className="mb-4 flex gap-1 border-b border-border"
      />

      <InlineError
        message={error}
        className="mb-4 border border-destructive/30 bg-destructive/10 px-4 py-2"
      />

      {loading ? (
        <PageLoading className="py-8 text-center" />
      ) : policies.length === 0 ? (
        <EmptyState
          message="No policies found."
          action={
            canCreatePolicy ? (
              <Link
                href="/policy-engine/new"
                className="inline-block text-sm text-primary hover:underline"
              >
                Create your first policy →
              </Link>
            ) : null
          }
        />
      ) : (
        <PoliciesTable
          policies={policies}
          role={role}
          projectNames={projectNames}
          deletingId={deletingId}
          confirmDelete={confirmDelete}
          onConfirmDelete={setConfirmDelete}
          onDelete={async (id) => {
            await handleDelete(id);
            setConfirmDelete(null);
          }}
          onArchive={handleArchive}
        />
      )}
    </div>
  );
}

function PoliciesTable({
  policies,
  role,
  projectNames,
  deletingId,
  confirmDelete,
  onConfirmDelete,
  onDelete,
  onArchive,
}: {
  policies: Policy[];
  role: ReturnType<typeof useDashboard>["role"];
  projectNames: Record<string, string>;
  deletingId: string | null;
  confirmDelete: string | null;
  onConfirmDelete: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}) {
  const canManageAnyPolicy = policies.some((policy) =>
    canPerform(
      role,
      policy.scope === "project"
        ? "policy.write_project"
        : "policy.write_tenant",
    ),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Scope
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Enforcement
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
              Priority
            </th>
            {canManageAnyPolicy ? <th className="px-4 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {policies.map((policy) => (
            <tr key={policy.id} className="transition-colors hover:bg-muted/20">
              <td className="px-4 py-3">
                <Link
                  href={`/policy-engine/${policy.id}`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {policy.name}
                </Link>
                {policy.description ? (
                  <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                    {policy.description}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <ScopeBadge scope={policy.scope} />
                {policy.scope === "project" && policy.project_id ? (
                  <p className="mt-0.5 max-w-[160px] truncate text-xs text-muted-foreground">
                    {projectNames[policy.project_id] ??
                      `${policy.project_id.slice(0, 8)}…`}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <EnforcementBadge mode={policy.enforcement_mode} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={policy.status} />
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {policy.priority}
              </td>
              {canPerform(
                role,
                policy.scope === "project"
                  ? "policy.write_project"
                  : "policy.write_tenant",
              ) ? (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/policy-engine/${policy.id}`}
                      className="rounded border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      Edit
                    </Link>
                    {policy.status !== "archived" ? (
                      <button
                        type="button"
                        onClick={() => void onArchive(policy.id)}
                        className="rounded border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                      >
                        Archive
                      </button>
                    ) : null}
                    {policy.status === "draft" ? (
                      confirmDelete === policy.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void onDelete(policy.id)}
                            disabled={deletingId === policy.id}
                            className="rounded bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {deletingId === policy.id ? "Deleting…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onConfirmDelete(null)}
                            className="rounded border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onConfirmDelete(policy.id)}
                          className="rounded border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                        >
                          Delete
                        </button>
                      )
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
