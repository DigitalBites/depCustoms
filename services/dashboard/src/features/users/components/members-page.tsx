"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useDashboard } from "@/components/dashboard-provider";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { ActionIconButton } from "@/components/ui/action-icon-button";
import {
  getPasswordConfirmationError,
  PasswordConfirmationFields,
} from "@/components/ui/password-confirmation-fields";
import { useTenantProjects } from "@/features/projects/hooks";
import {
  useCreateTenantMember,
  useResetMemberPassword,
  useTenantMembers,
  useUpdateMemberRole,
} from "@/features/users/hooks";
import type { ResetPasswordTarget, TenantMember } from "@/features/users/types";
import {
  canPerform,
  getDirectCreatableDashboardRoles,
} from "@/lib/dashboard-capabilities";
import {
  canEditDashboardRole,
  type DashboardRole,
  getEditableDashboardRoles,
  getDashboardRoleBadgeClassName,
  getDashboardRoleDescription,
  getDirectCreatableDashboardRoleDescription,
  isDirectCreatableDashboardRole,
  normalizeDashboardRole,
} from "@/lib/dashboard-roles";

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${getDashboardRoleBadgeClassName(
        role,
      )}`}
    >
      {role}
    </span>
  );
}

function ProviderChip({ provider }: { provider: string | null }) {
  const label = !provider || provider === "email" ? "Internal" : provider;
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

export function MembersPage() {
  const { tenantId, role } = useDashboard();
  const canInviteMembers = canPerform(role, "members.invite");
  const canWriteRoles = canPerform(role, "members.write_roles");
  const canCreatePasswordUser = canPerform(
    role,
    "members.create_password_user",
  );
  const canResetMemberPassword = canPerform(role, "members.reset_password");
  const { members, loading, error, reload } = useTenantMembers(tenantId);
  const { projects } = useTenantProjects({ suppressErrors: true });
  const directCreateRoles = getDirectCreatableDashboardRoles(role);
  const defaultDirectCreateRole = directCreateRoles[0] ?? "member";
  const editableRoles = getEditableDashboardRoles();
  const { saving: creatingMember, createMember } =
    useCreateTenantMember(tenantId);
  const { saving, resetPassword } = useResetMemberPassword(tenantId);
  const { saving: savingRole, updateRole } = useUpdateMemberRole(tenantId);

  const [resetTarget, setResetTarget] = useState<ResetPasswordTarget | null>(
    null,
  );
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirmValue, setResetPasswordConfirmValue] =
    useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPasswordValue, setCreatePasswordValue] = useState("");
  const [createPasswordConfirmValue, setCreatePasswordConfirmValue] =
    useState("");
  const [createRole, setCreateRole] = useState(defaultDirectCreateRole);
  const [createProjectId, setCreateProjectId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [roleTarget, setRoleTarget] = useState<TenantMember | null>(null);
  const [nextRole, setNextRole] = useState<DashboardRole>("member");
  const [roleError, setRoleError] = useState<string | null>(null);

  function openResetDialog(member: TenantMember) {
    setResetTarget({ userId: member.user_id, email: member.email });
    setResetPasswordValue("");
    setResetPasswordConfirmValue("");
    setResetError(null);
    setResetSuccess(false);
  }

  function closeResetDialog() {
    setResetTarget(null);
    setResetPasswordValue("");
    setResetPasswordConfirmValue("");
    setResetError(null);
    setResetSuccess(false);
  }

  function openCreateDialog() {
    setCreateOpen(true);
    setCreateEmail("");
    setCreatePasswordValue("");
    setCreatePasswordConfirmValue("");
    setCreateRole(defaultDirectCreateRole);
    setCreateProjectId("");
    setCreateError(null);
    setCreateSuccess(false);
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    setCreateEmail("");
    setCreatePasswordValue("");
    setCreatePasswordConfirmValue("");
    setCreateRole(defaultDirectCreateRole);
    setCreateProjectId("");
    setCreateError(null);
    setCreateSuccess(false);
  }

  function openRoleDialog(member: TenantMember) {
    setRoleTarget(member);
    setNextRole(member.role);
    setRoleError(null);
  }

  function closeRoleDialog() {
    setRoleTarget(null);
    setNextRole("member");
    setRoleError(null);
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;

    setResetError(null);
    const mismatchError = getPasswordConfirmationError(
      resetPasswordValue,
      resetPasswordConfirmValue,
    );
    if (mismatchError) {
      setResetError(mismatchError);
      return;
    }
    const result = await resetPassword(resetTarget.userId, resetPasswordValue);
    if (!result.ok) {
      setResetError(result.error);
      return;
    }

    setResetSuccess(true);
    setTimeout(closeResetDialog, 1500);
  }

  async function handleCreateMember(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const mismatchError = getPasswordConfirmationError(
      createPasswordValue,
      createPasswordConfirmValue,
    );
    if (mismatchError) {
      setCreateError(mismatchError);
      return;
    }
    const selectedRoleHasImplicitProjectAccess = canPerform(
      createRole,
      "projects.read_all",
    );

    const result = await createMember({
      email: createEmail,
      password: createPasswordValue,
      role: createRole,
      project_id:
        !selectedRoleHasImplicitProjectAccess && createProjectId
          ? createProjectId
          : undefined,
    });

    if (!result.ok) {
      setCreateError(result.error);
      return;
    }

    setCreateSuccess(true);
    await reload();
    setTimeout(closeCreateDialog, 1200);
  }

  async function handleUpdateRole(e: FormEvent) {
    e.preventDefault();
    if (!roleTarget) return;

    setRoleError(null);
    const result = await updateRole(roleTarget.user_id, nextRole);
    if (!result.ok) {
      setRoleError(result.error);
      return;
    }

    await reload();
    closeRoleDialog();
  }

  return (
    <div className="w-full max-w-none">
      <PageHeader
        title="Members"
        description="All users with access to this tenant."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreateDialog}
              disabled={!canCreatePasswordUser}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
                canCreatePasswordUser
                  ? "bg-secondary text-secondary-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-secondary text-secondary-foreground opacity-50"
              }`}
              title={
                canCreatePasswordUser
                  ? undefined
                  : "Your role cannot create tenant accounts directly"
              }
            >
              + Create Account
            </button>
            <Link
              href="/users/add"
              aria-disabled={!canInviteMembers}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
                canInviteMembers
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "pointer-events-none bg-primary text-primary-foreground opacity-50"
              }`}
              title={
                canInviteMembers ? undefined : "Your role cannot add users"
              }
            >
              + Grant Access
            </Link>
          </div>
        }
      />

      {loading ? (
        <PageLoading />
      ) : error ? (
        <InlineError message={error} />
      ) : members.length === 0 ? (
        <EmptyState message="No members found." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  User
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Joined
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Last login
                </th>
                {canResetMemberPassword || canWriteRoles ? (
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => {
                const isInternal =
                  !member.provider || member.provider === "email";
                const provider = member.provider ?? "email";
                return (
                  <tr
                    key={member.user_id}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {member.email ? (
                          <span className="text-foreground">
                            {member.email}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {member.user_id.slice(0, 8)}…
                          </span>
                        )}
                        <ProviderChip provider={member.provider} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {canWriteRoles && canEditDashboardRole(member.role) ? (
                        <button
                          type="button"
                          onClick={() => openRoleDialog(member)}
                          className="transition-opacity hover:opacity-80"
                        >
                          <RoleBadge role={member.role} />
                        </button>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(member.joined_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {member.last_sign_in_at ? (
                        new Date(member.last_sign_in_at).toLocaleString()
                      ) : (
                        <span className="italic">never</span>
                      )}
                    </td>
                    {canResetMemberPassword || canWriteRoles ? (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {canResetMemberPassword ? (
                            isInternal ? (
                              <ActionIconButton
                                label="Reset password"
                                onClick={() => openResetDialog(member)}
                              >
                                <KeyRound className="h-4 w-4" />
                              </ActionIconButton>
                            ) : (
                              <ActionIconButton
                                label={`Password is managed by ${provider}`}
                                disabled
                              >
                                <KeyRound className="h-4 w-4" />
                              </ActionIconButton>
                            )
                          ) : null}
                          {canWriteRoles &&
                          canEditDashboardRole(member.role) ? (
                            <ActionIconButton
                              label="Change role"
                              onClick={() => openRoleDialog(member)}
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </ActionIconButton>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resetTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeResetDialog();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              Reset password
            </h2>
            <p className="mb-4 truncate text-xs text-muted-foreground">
              {resetTarget.email ?? resetTarget.userId}
            </p>

            {resetSuccess ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Password updated successfully.
              </p>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-3">
                <PasswordConfirmationFields
                  passwordLabel="New password"
                  password={resetPasswordValue}
                  confirmPassword={resetPasswordConfirmValue}
                  onPasswordChange={setResetPasswordValue}
                  onConfirmPasswordChange={setResetPasswordConfirmValue}
                  autoFocus
                />

                {resetError ? (
                  <p className="text-xs text-destructive">{resetError}</p>
                ) : null}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Reset password"}
                  </button>
                  <button
                    type="button"
                    onClick={closeResetDialog}
                    className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {roleTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeRoleDialog();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              Change role
            </h2>
            <p className="mb-4 truncate text-xs text-muted-foreground">
              {roleTarget.email ?? roleTarget.user_id}
            </p>

            <form onSubmit={handleUpdateRole} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Role
                </label>
                <select
                  value={nextRole}
                  onChange={(e) => {
                    const role = normalizeDashboardRole(e.target.value);
                    if (role && canEditDashboardRole(role)) {
                      setNextRole(role);
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {editableRoles.map((value) => (
                    <option key={value} value={value} className="capitalize">
                      {value}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getDashboardRoleDescription(
                    nextRole as (typeof editableRoles)[number],
                  )}
                </p>
              </div>

              {roleError ? (
                <p className="text-xs text-destructive">{roleError}</p>
              ) : null}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingRole}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {savingRole ? "Saving…" : "Save role"}
                </button>
                <button
                  type="button"
                  onClick={closeRoleDialog}
                  className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeCreateDialog();
            }
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              Create Account
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Create a password-based account directly and add it to this
              tenant.
            </p>

            {createSuccess ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Account created successfully.
              </p>
            ) : (
              <form onSubmit={handleCreateMember} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                    autoFocus
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <PasswordConfirmationFields
                  password={createPasswordValue}
                  confirmPassword={createPasswordConfirmValue}
                  onPasswordChange={setCreatePasswordValue}
                  onConfirmPasswordChange={setCreatePasswordConfirmValue}
                />

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Role
                  </label>
                  <select
                    value={createRole}
                    onChange={(e) => {
                      if (!isDirectCreatableDashboardRole(e.target.value)) {
                        return;
                      }

                      const nextRole = e.target.value;
                      setCreateRole(nextRole);
                      if (canPerform(nextRole, "projects.read_all")) {
                        setCreateProjectId("");
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {directCreateRoles.map((value) => (
                      <option key={value} value={value} className="capitalize">
                        {value}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getDirectCreatableDashboardRoleDescription(createRole)}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Project
                  </label>
                  <select
                    value={createProjectId}
                    onChange={(e) => setCreateProjectId(e.target.value)}
                    disabled={canPerform(createRole, "projects.read_all")}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">No project restriction</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {canPerform(createRole, "projects.read_all")
                      ? "This role has tenant-wide access, so project restriction does not apply."
                      : "Optionally restrict access to a single project."}
                  </p>
                </div>

                {createError ? (
                  <p className="text-xs text-destructive">{createError}</p>
                ) : null}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={creatingMember}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {creatingMember ? "Creating…" : "Create Account"}
                  </button>
                  <button
                    type="button"
                    onClick={closeCreateDialog}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
