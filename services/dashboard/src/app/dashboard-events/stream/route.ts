import { type NextRequest } from "next/server";
import { config } from "@/config";
import { requireDashboardAccessToken } from "@/lib/dashboard-auth";
import { getSseProxyQuery, requireApiInternalUrl } from "@/lib/sse-proxy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accessToken = await requireDashboardAccessToken();
  const internalUrl = requireApiInternalUrl(config.apiInternalUrl);
  const query = getSseProxyQuery(req.nextUrl.searchParams);
  const url = query
    ? `${internalUrl}/v1/events/stream?${query}`
    : `${internalUrl}/v1/events/stream`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "sse_proxy_unavailable",
          message: "Event stream unavailable",
          detail: null,
        },
      },
      { status: 503 },
    );
  }
}
