import type { SecurityTab } from "@/features/security/types";
import { SecurityHub } from "@/features/security/components/security-hub";

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

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  return (
    <SecurityHub
      scope={{ kind: "tenant" }}
      initialTab={getInitialTab(query.tab)}
    />
  );
}
