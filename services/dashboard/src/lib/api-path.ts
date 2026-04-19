export function assertRelativeApiPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error("apiFetch only accepts relative API paths");
  }
}

export function buildApiUrl(baseUrl: string, path: string): string {
  assertRelativeApiPath(path);
  return `${baseUrl}${path}`;
}
