import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";
import { isSameOriginRequest } from "@/lib/request-origin";
import { getValidPathSegmentParam } from "@/lib/route-params";
import type { McpOAuthConsentResult } from "@/features/mcp/types";

function getApiBaseUrl(): string {
  return config.apiInternalUrl || config.apiUrl;
}

function getDashboardBaseUrl(): string {
  return config.authUrl;
}

function buildAuthorizePath(authorizationId: string, error?: string): string {
  const params = new URLSearchParams({ authorization_id: authorizationId });
  if (error) {
    params.set("error", error);
  }
  return `/auth/oauth/authorize?${params.toString()}`;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_origin",
          message: "Cross-origin consent request denied",
          detail: null,
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const formData = await request.formData();
  const rawAuthorizationId = formData.get("authorization_id");
  const action = formData.get("action");
  const authorizationId =
    typeof rawAuthorizationId === "string"
      ? getValidPathSegmentParam(rawAuthorizationId)
      : null;

  if (!authorizationId || (action !== "approve" && action !== "deny")) {
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", getDashboardBaseUrl()),
    );
  }

  const supabase = await createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return NextResponse.redirect(
      new URL(
        `/login?next=${encodeURIComponent(buildAuthorizePath(authorizationId))}`,
        getDashboardBaseUrl(),
      ),
    );
  }

  const response = await fetch(
    buildApiUrl(
      getApiBaseUrl(),
      `/oauth/authorizations/${authorizationId}/consent`,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: `Failed to ${action} request` },
      { status: response.status || 400 },
    );
  }

  const result = (await response.json()) as McpOAuthConsentResult;
  return NextResponse.json(result, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
