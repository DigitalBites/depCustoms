"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  KeyRound,
  Package,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useDashboard } from "@/components/dashboard-provider";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { ActionIconButton } from "@/components/ui/action-icon-button";
import {
  useProjectMutations,
  useTenantProjects,
} from "@/features/projects/hooks";
import type { ProjectSummary } from "@/features/projects/types";
import { canPerform } from "@/lib/dashboard-capabilities";
import { buildProjectDetailHref } from "@/lib/project-navigation";

export function ProjectsPage() {
  const { tenantId, role } = useDashboard();
  const canCreateProjects = canPerform(role, "projects.create");
  const canDeleteProjects = canPerform(role, "projects.delete");
  const { projects, loading, error, setError, reload } = useTenantProjects();
  const [pageError, setPageError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const { creating, deletingId, handleCreate, handleDelete } =
    useProjectMutations({
      tenantId,
      onError: setPageError,
    });

  useEffect(() => {
    setPageError(error);
  }, [error]);

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      return;
    }

    const created = await handleCreate(newName.trim());
    if (!created) {
      return;
    }

    setNewName("");
    setShowForm(false);
    setError(null);
    await reload();
  }

  return (
    <div className="w-full max-w-none">
      <PageHeader
        title="Projects"
        actions={
          <button
            type="button"
            onClick={() => {
              if (canCreateProjects) {
                setShowForm((value) => !value);
              }
            }}
            disabled={!canCreateProjects}
            title={
              canCreateProjects ? undefined : "Your role cannot create projects"
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showForm && canCreateProjects ? "Cancel" : "New Project"}
          </button>
        }
      />

      {showForm && canCreateProjects ? (
        <form
          onSubmit={handleCreateProject}
          className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-card p-4"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            required
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      ) : null}

      <InlineError message={pageError} className="mb-4" />

      {loading ? (
        <PageLoading />
      ) : projects.length === 0 ? (
        <EmptyState message="No projects yet. Create your first project above." />
      ) : (
        <ProjectsTable
          projects={projects}
          canDeleteProjects={canDeleteProjects}
          deletingId={deletingId}
          onDelete={async (projectId, projectName) => {
            const deleted = await handleDelete(projectId, projectName);
            if (!deleted) {
              return;
            }

            setError(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ProjectsTable({
  projects,
  canDeleteProjects,
  deletingId,
  onDelete,
}: {
  projects: ProjectSummary[];
  canDeleteProjects: boolean;
  deletingId: string | null;
  onDelete: (projectId: string, projectName: string) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="w-[32%] px-4 py-3 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Project ID
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Created
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project, idx) => (
            <tr
              key={project.id}
              className={`${idx < projects.length - 1 ? "border-b border-border" : ""} transition-colors hover:bg-muted/30`}
            >
              <td className="px-4 py-3 font-medium text-foreground">
                {project.name}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span>{project.id.slice(0, 8)}...</span>
                  <CopyProjectIdButton projectId={project.id} />
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {project.created_at
                  ? new Date(project.created_at).toLocaleDateString()
                  : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={buildProjectDetailHref(
                      `/projects/${project.id}/tokens`,
                      "/projects",
                    )}
                    aria-label={`View tokens for ${project.name}`}
                  >
                    <ActionIconButton label="Tokens">
                      <KeyRound className="h-4 w-4" />
                    </ActionIconButton>
                  </Link>
                  <Link
                    href={buildProjectDetailHref(
                      `/projects/${project.id}/packages`,
                      "/projects",
                    )}
                    aria-label={`View packages for ${project.name}`}
                  >
                    <ActionIconButton label="Packages">
                      <Package className="h-4 w-4" />
                    </ActionIconButton>
                  </Link>
                  <Link
                    href={buildProjectDetailHref(
                      `/projects/${project.id}/security`,
                      "/projects",
                    )}
                    aria-label={`View security for ${project.name}`}
                  >
                    <ActionIconButton label="Security">
                      <ShieldCheck className="h-4 w-4" />
                    </ActionIconButton>
                  </Link>
                  {canDeleteProjects ? (
                    <ActionIconButton
                      label="Delete project"
                      onClick={() => void onDelete(project.id, project.name)}
                      disabled={deletingId === project.id}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </ActionIconButton>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyProjectIdButton({ projectId }: { projectId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(projectId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={copied ? "Copied" : "Copy project ID"}
      aria-label={copied ? "Copied project ID" : "Copy project ID"}
      className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span aria-live="polite" className="text-[11px]">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
