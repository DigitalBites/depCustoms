import { useEffect, useState } from "react";
import { fetchProjectPackages } from "@/features/packages/api";
import type { PackageUsage } from "@/features/packages/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function useProjectPackages(projectId: string | null) {
  const [packages, setPackages] = useState<PackageUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setError("Invalid project identifier.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchProjectPackages(projectId)
      .then(setPackages)
      .catch((err) =>
        setError(getUserErrorMessage(err, "Failed to load packages")),
      )
      .finally(() => setLoading(false));
  }, [projectId]);

  return { packages, loading, error };
}
