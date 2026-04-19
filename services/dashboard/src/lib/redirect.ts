export function getSafeRedirectPath(
  next: string | null | undefined,
  fallback = "/projects",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}
