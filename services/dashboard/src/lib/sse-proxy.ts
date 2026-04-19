export function getSseProxyQuery(searchParams: URLSearchParams): string {
  const forwarded = new URLSearchParams();
  const lastEventId = searchParams.get("last_event_id");

  if (lastEventId) {
    forwarded.set("last_event_id", lastEventId);
  }

  return forwarded.toString();
}

export function requireApiInternalUrl(apiInternalUrl: string): string {
  if (!apiInternalUrl) {
    throw new Error(
      "API_INTERNAL_URL is required for dashboard SSE proxy routes",
    );
  }

  return apiInternalUrl;
}
