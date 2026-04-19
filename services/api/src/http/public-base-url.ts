function firstForwardedValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim().replace(/^"|"$/g, "");

  return first ? first : null;
}

function readForwardedParam(
  forwarded: string | null | undefined,
  key: string,
): string | null {
  const first = firstForwardedValue(forwarded);
  if (!first) {
    return null;
  }

  for (const segment of first.split(";")) {
    const [rawName, rawValue] = segment.split("=", 2);
    if (!rawName || !rawValue) {
      continue;
    }

    if (rawName.trim().toLowerCase() !== key) {
      continue;
    }

    const value = rawValue.trim().replace(/^"|"$/g, "");
    return value || null;
  }

  return null;
}

export function resolvePublicBaseUrl(
  requestUrl: string,
  headers?: Headers,
  configuredBaseUrl?: string,
): string {
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const url = new URL(requestUrl);
  const forwardedProto =
    readForwardedParam(headers?.get("forwarded"), "proto") ??
    firstForwardedValue(headers?.get("x-forwarded-proto"));
  const forwardedHost =
    readForwardedParam(headers?.get("forwarded"), "host") ??
    firstForwardedValue(headers?.get("x-forwarded-host")) ??
    firstForwardedValue(headers?.get("host"));

  const protocol = forwardedProto
    ? forwardedProto.replace(/:$/, "")
    : url.protocol.slice(0, -1);
  const host = forwardedHost ?? url.host;

  return `${protocol}://${host}`;
}
