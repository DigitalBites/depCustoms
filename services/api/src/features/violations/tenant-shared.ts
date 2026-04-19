import {
  listViolations,
  loadViolationSummary,
  type ViolationListFilters,
} from "./query-service.js";

export async function loadTenantViolationSummary(
  tenantId: string,
  allowedProjectIds: string[] | null = null,
) {
  return loadViolationSummary({ tenantId, allowedProjectIds });
}

export async function listTenantViolations(
  tenantId: string,
  filters: Omit<ViolationListFilters, "until">,
) {
  return listViolations({ tenantId }, filters);
}
