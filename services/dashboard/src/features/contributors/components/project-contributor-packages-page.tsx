"use client";

import { useParams } from "next/navigation";
import { ContributorPackagesPage } from "@/features/contributors/components/contributor-packages-page";
import { useProjectName } from "@/hooks/useProjectName";
import { getValidUuidParam } from "@/lib/route-params";

export function ProjectContributorPackagesPage() {
  const { project_id: rawProjectId } = useParams<{ project_id: string }>();
  const projectId = getValidUuidParam(rawProjectId);
  const projectName = useProjectName(projectId ?? "");

  if (!projectId) {
    return (
      <div className="max-w-6xl py-8">
        <p className="text-sm text-destructive">Invalid project identifier.</p>
      </div>
    );
  }

  return (
    <ContributorPackagesPage
      scope={{ kind: "project", projectId, projectName }}
    />
  );
}
