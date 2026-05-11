import { redirect } from "next/navigation";
import { getValidUuidParam } from "@/lib/route-params";
import { getProjectReturnPath } from "@/lib/project-navigation";

export default async function OsvRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ project_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project_id } = await params;
  const query = await searchParams;
  const validProjectId = getValidUuidParam(project_id);
  const fromParam = Array.isArray(query.from) ? query.from[0] : query.from;
  const from = getProjectReturnPath(fromParam);

  if (!validProjectId) {
    redirect(from);
  }

  const target = new URLSearchParams({ from });

  redirect(`/projects/${validProjectId}/security?${target.toString()}`);
}
