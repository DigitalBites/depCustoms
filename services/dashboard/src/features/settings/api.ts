import { apiFetch } from "@/lib/api";
import type { Entitlements } from "@/features/settings/types";

export async function fetchEntitlements(
  tenantId: string,
): Promise<Entitlements> {
  const data = (await apiFetch(`/v1/tenants/${tenantId}/entitlements`)) as {
    entitlements: Entitlements;
  };
  return data.entitlements;
}

export async function saveEntitlements(
  tenantId: string,
  payload: Entitlements,
): Promise<Entitlements> {
  const data = (await apiFetch(`/v1/tenants/${tenantId}/entitlements`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })) as { entitlements: Entitlements };
  return data.entitlements;
}
