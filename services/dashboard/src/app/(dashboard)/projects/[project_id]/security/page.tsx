import type { SecurityTab } from "@/features/security/types";
import { ProjectSecurityPage } from "@/features/security/components/project-security-page";

function getInitialTab(
  tab: string | string[] | undefined,
): SecurityTab | undefined {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "findings" ||
    value === "violations" ||
    value === "contributors" ||
    value === "actors"
    ? value
    : undefined;
}

export default async function SecurityHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  return <ProjectSecurityPage initialTab={getInitialTab(query.tab)} />;
}
