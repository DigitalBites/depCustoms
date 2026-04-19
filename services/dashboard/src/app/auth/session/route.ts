import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import {
  getSameOriginDebugInfo,
  isSameOriginRequest,
} from "@/lib/request-origin";

type SessionPayload = {
  access_token?: string;
  refresh_token?: string;
};

type ResponseCookie = {
  name: string;
  value: string;
  options: Parameters<NextResponse["cookies"]["set"]>[2];
};

function isJsonRequest(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().startsWith("application/json");
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        service: "dashboard",
        msg: "session_sync_origin_rejected",
        ...getSameOriginDebugInfo(req),
      }),
    );
    return NextResponse.json(
      {
        error: {
          code: "invalid_origin",
          message: "Cross-origin session sync denied",
          detail: null,
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    req.headers.get("x-customs-session-sync") !== "1" ||
    !isJsonRequest(req)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_session_sync_request",
          message: "Session sync requires a same-origin JSON request",
          detail: null,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await req.json().catch(() => null)) as SessionPayload | null;
  const accessToken = body?.access_token?.trim();
  const refreshToken = body?.refresh_token?.trim();

  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_session",
          message: "Missing session tokens",
          detail: null,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  const supabase = createSsrServerClient(config.authUrl, config.anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: ResponseCookie[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "session_sync_failed",
          message: error.message,
          detail: null,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return response;
}
