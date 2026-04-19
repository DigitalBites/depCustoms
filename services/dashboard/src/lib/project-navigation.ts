import { getSafeRedirectPath } from "@/lib/redirect";

const DEFAULT_PROJECT_RETURN_PATH = "/projects";
const ALLOWED_PROJECT_RETURN_PATHS = new Set(["/projects", "/dashboard"]);

export function getProjectReturnPath(
  from: string | null | undefined,
  fallback = DEFAULT_PROJECT_RETURN_PATH,
): string {
  const safe = getSafeRedirectPath(from, fallback);
  return ALLOWED_PROJECT_RETURN_PATHS.has(safe) ? safe : fallback;
}

export function buildProjectDetailHref(path: string, from: string): string {
  const target = getProjectReturnPath(from);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}from=${encodeURIComponent(target)}`;
}
