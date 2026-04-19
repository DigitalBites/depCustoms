function getAllowedConnectOrigins(
  origins: Array<string | undefined>,
): string[] {
  const allowed = new Set<string>(["'self'"]);

  for (const origin of origins) {
    if (!origin) continue;

    try {
      const url = new URL(origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        allowed.add(url.origin);
      }
    } catch {
      // Ignore malformed env values; the app should not broaden CSP because of them.
    }
  }

  return [...allowed];
}

export function buildContentSecurityPolicy(
  isProduction: boolean,
  options: {
    apiUrl?: string;
    authUrl?: string;
  } = {},
): string {
  const connectSrc = isProduction
    ? getAllowedConnectOrigins([options.apiUrl, options.authUrl]).join(" ")
    : "'self' http: https:";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' blob: 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
  ].join("; ");
}
