import { apiFetch } from "@/lib/api";
import type { PackageUsage } from "@/features/packages/types";

export async function fetchProjectPackages(
  projectId: string,
): Promise<PackageUsage[]> {
  const data = (await apiFetch(`/v1/projects/${projectId}/packages`)) as {
    packages: PackageUsage[];
  };
  return data.packages;
}
