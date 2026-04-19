import { redirect } from "next/navigation";
import { requireDashboardCapability } from "@/lib/dashboard-auth";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ project_id: string }>;
}) {
  const { project_id } = await params;

  if (!project_id) {
    redirect("/projects");
  }

  await requireDashboardCapability("projects.read", { projectId: project_id });
  return children;
}
