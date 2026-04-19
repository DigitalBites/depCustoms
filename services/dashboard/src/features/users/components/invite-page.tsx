"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/components/dashboard-provider";
import { InlineError } from "@/components/feedback/inline-error";
import { PageHeader } from "@/components/layout/page-header";
import { useTenantProjects } from "@/features/projects/hooks";
import { useSendInvite } from "@/features/users/hooks";
import type { InviteRole, TenantInviteRequest } from "@/features/users/types";
import {
  canPerform,
  getInvitableDashboardRoles,
} from "@/lib/dashboard-capabilities";
import {
  getAssignableDashboardRoleDescription,
  isAssignableDashboardRole,
} from "@/lib/dashboard-roles";

export function InvitePage() {
  const { tenantId, role } = useDashboard();
  const { projects } = useTenantProjects({ suppressErrors: true });
  const { sending, sendInvite } = useSendInvite(tenantId);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [projectId, setProjectId] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableRoles: InviteRole[] = [...getInvitableDashboardRoles(role)];
  const requiresProject = !canPerform(role, "members.invite_unscoped");
  const selectedRoleHasImplicitProjectAccess = canPerform(
    inviteRole,
    "projects.read_all",
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const inviteRequest: TenantInviteRequest = {
      email,
      role: inviteRole,
      project_id:
        !selectedRoleHasImplicitProjectAccess && projectId
          ? projectId
          : undefined,
    };
    const result = await sendInvite(inviteRequest);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const successByOutcome: Record<
      NonNullable<typeof result.outcome>,
      string
    > = {
      invite_sent: `Invite sent to ${email}.`,
      tenant_access_added: `${email} was added to this tenant.`,
      tenant_and_project_access_added: `${email} was added to this tenant and project.`,
      project_access_added: `${email} was added to the selected project.`,
      already_had_project_access: `${email} already had access to the selected project.`,
      already_in_tenant: `${email} is already a member of this tenant.`,
    };

    if (result.outcome) {
      setSuccessMessage(successByOutcome[result.outcome]);
    }
    setEmail("");
    setProjectId("");
    setInviteRole("member");
  }

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <Link
          href="/users/members"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Members
        </Link>
        <PageHeader
          title="Grant Access"
          description="Grant tenant or project access. Existing users are added directly; brand-new users receive an invite email."
          className="mb-0 mt-2"
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Email address <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Role <span className="text-destructive">*</span>
          </label>
          <select
            value={inviteRole}
            onChange={(e) => {
              if (!isAssignableDashboardRole(e.target.value)) {
                return;
              }

              const nextRole = e.target.value;
              setInviteRole(nextRole);
              if (canPerform(nextRole, "projects.read_all")) {
                setProjectId("");
              }
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {availableRoles.map((value) => (
              <option key={value} value={value} className="capitalize">
                {value}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {getAssignableDashboardRoleDescription(inviteRole)}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Project
            {requiresProject ? (
              <span className="text-destructive"> *</span>
            ) : null}
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required={requiresProject && !selectedRoleHasImplicitProjectAccess}
            disabled={selectedRoleHasImplicitProjectAccess}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">
              {requiresProject
                ? "Select a project"
                : "All projects (no project restriction)"}
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedRoleHasImplicitProjectAccess
              ? "This role has tenant-wide access, so project restriction does not apply."
              : requiresProject
                ? "Your current access level requires invites to be scoped to a specific project."
                : "Optionally restrict access to a single project. Leave blank for tenant-wide access."}
          </p>
        </div>

        <InlineError message={error} />
        {successMessage ? (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            {successMessage}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sending ? "Saving…" : "Grant Access"}
        </button>
      </form>
    </div>
  );
}
