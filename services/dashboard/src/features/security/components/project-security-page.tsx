"use client";

import { useParams } from "next/navigation";
import { ProjectBackLink } from "@/components/navigation/project-back-link";
import { SecurityHub } from "@/features/security/components/security-hub";
import { useProjectName } from "@/hooks/useProjectName";
import { getValidUuidParam } from "@/lib/route-params";

export function ProjectSecurityPage({ initialTab }: { initialTab?: string }) {
  const { project_id: rawProjectId } = useParams<{ project_id: string }>();
  const projectId = getValidUuidParam(rawProjectId);
  const projectName = useProjectName(projectId ?? "");

  if (!projectId) {
    return (
      <div className="max-w-6xl py-8">
        <p className="text-sm text-destructive">Invalid project identifier.</p>
        <div className="mt-2">
          <ProjectBackLink className="inline-block text-sm text-primary hover:underline" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProjectBackLink />
      <SecurityHub
        scope={{ kind: "project", projectId }}
        projectName={projectName}
        initialTab={initialTab}
      />
    </div>
  );
}
