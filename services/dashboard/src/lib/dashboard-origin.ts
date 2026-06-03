import { config } from "@/config";
import { resolveExpectedDashboardOrigin } from "@/lib/request-origin";

export function getDashboardOrigin(
  request: Request,
  publicOrigin = config.publicOrigin,
): string {
  return resolveExpectedDashboardOrigin(
    request.url,
    publicOrigin,
    request.headers,
  );
}

export function buildDashboardUrl(
  request: Request,
  path: string,
  publicOrigin = config.publicOrigin,
): URL {
  return new URL(path, getDashboardOrigin(request, publicOrigin));
}
