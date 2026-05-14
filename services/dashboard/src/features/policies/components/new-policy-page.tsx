"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CREATABLE_POLICY_STATUSES,
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_SCOPES,
  POLICY_STATUS,
} from "@customs/shared-constants";
import type {
  CreatablePolicyStatus,
  EnforcementMode,
  PolicyScope,
} from "@customs/shared-constants";
import { useDashboard } from "@/components/dashboard-provider";
import { useTenantProjects } from "@/features/projects/hooks";
import { useCreatePolicy } from "@/features/policies/hooks";

export function NewPolicyPage() {
  const { tenantId } = useDashboard();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<PolicyScope>(POLICY_SCOPE.GLOBAL);
  const [projectId, setProjectId] = useState("");
  const [enforcementMode, setEnforcementMode] = useState<EnforcementMode>(
    ENFORCEMENT_MODE.ENFORCING,
  );
  const [priority, setPriority] = useState(100);
  const [status, setStatus] = useState<CreatablePolicyStatus>(
    POLICY_STATUS.ACTIVE,
  );
  const { projects, loading: loadingProjects } = useTenantProjects({
    enabled: scope === POLICY_SCOPE.PROJECT,
    suppressErrors: true,
  });
  const { saving, error, setError, create } = useCreatePolicy(tenantId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (scope === POLICY_SCOPE.PROJECT && !projectId) {
      setError("Please select a project for project-scoped policies.");
      return;
    }

    const result = await create({
      scope,
      projectId,
      name,
      description,
      category,
      enforcementMode,
      priority,
      status,
    });

    if (!result) {
      return;
    }

    router.push(`/policy-engine/${result.policy.id}`);
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link
          href="/policy-engine"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Policies
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          New Policy
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Security Baseline"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description of this policy's purpose"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Scope <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-3">
            {POLICY_SCOPES.map((nextScope) => (
              <label
                key={nextScope}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="scope"
                  value={nextScope}
                  checked={scope === nextScope}
                  onChange={() => {
                    setScope(nextScope);
                    setProjectId("");
                  }}
                  className="text-primary"
                />
                <span className="text-sm">
                  {nextScope === POLICY_SCOPE.GLOBAL
                    ? "Global — applies to projects through policy bindings"
                    : "Project-scoped — applies to one project only"}
                </span>
              </label>
            ))}
          </div>
        </div>

        {scope === POLICY_SCOPE.PROJECT ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Project <span className="text-destructive">*</span>
            </label>
            {loadingProjects ? (
              <p className="text-sm text-muted-foreground">Loading projects…</p>
            ) : (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— select a project —</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}

        {scope === POLICY_SCOPE.GLOBAL ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— none —</option>
              <option value="vulnerability-management">
                Vulnerability Management
              </option>
              <option value="supply-chain">Supply Chain</option>
              <option value="compliance">Compliance</option>
            </select>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Enforcement mode
          </label>
          <select
            value={enforcementMode}
            onChange={(e) =>
              setEnforcementMode(e.target.value as typeof enforcementMode)
            }
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={ENFORCEMENT_MODE.ENFORCING}>
              Enforcing — violations cause blocks
            </option>
            <option value={ENFORCEMENT_MODE.ADVISORY}>
              Advisory — violations are recorded but do not block
            </option>
            <option value={ENFORCEMENT_MODE.DISABLED}>
              Disabled — policy is inactive
            </option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Priority
            <span className="ml-1 text-xs text-muted-foreground">
              (lower = evaluated first)
            </span>
          </label>
          <input
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(Number.parseInt(e.target.value, 10))}
            className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {scope === POLICY_SCOPE.GLOBAL ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Initial status
            </label>
            <div className="flex gap-3">
              {CREATABLE_POLICY_STATUSES.map((nextStatus) => (
                <label
                  key={nextStatus}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="radio"
                    name="status"
                    value={nextStatus}
                    checked={status === nextStatus}
                    onChange={() => setStatus(nextStatus)}
                    className="text-primary"
                  />
                  <span className="text-sm capitalize">{nextStatus}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={
              saving ||
              !name.trim() ||
              (scope === POLICY_SCOPE.PROJECT && !projectId)
            }
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create policy"}
          </button>
          <Link
            href="/policy-engine"
            className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
