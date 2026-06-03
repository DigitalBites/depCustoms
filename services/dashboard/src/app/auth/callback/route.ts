/**
 * OAuth callback route — exchanges the PKCE authorization code for a session.
 *
 * After the session is established, multi-tenant users (those belonging to
 * more than one tenant) are redirected to /auth/select-tenant so they can
 * choose which tenant to activate for the session. Single-tenant users go
 * to setup so bootstrap gating can continue.
 */

import { NextResponse } from "next/server";
import { config } from "@/config";
import {
  buildDashboardUrl,
  getOAuthCallbackExchangeAuthUrl,
} from "@/lib/dashboard-origin";
import { errorLogFields, getErrorMessage } from "@/lib/errors";
import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";
import { getSafeRedirectPath } from "@/lib/redirect";
import { createServerClient } from "@/lib/supabase-server";

function logOAuthCallbackFailure(
  msg: "oauth_callback_exchange_failed" | "oauth_callback_session_sync_failed",
  error: unknown,
) {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      service: "dashboard",
      msg,
      error_message: getErrorMessage(error),
      ...errorLogFields(error),
    }),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeRedirectPath(url.searchParams.get("next"), "/setup");

  if (code) {
    const supabase = await createServerClient({
      authUrl: getOAuthCallbackExchangeAuthUrl(request),
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logOAuthCallbackFailure("oauth_callback_exchange_failed", error);
      return NextResponse.redirect(
        buildDashboardUrl(request, "/login?error=auth_failed"),
      );
    }

    if (data.session && config.authProxyEnabled) {
      const serverSupabase = await createServerClient();
      const { error: serverSessionError } = await serverSupabase.auth.setSession(
        {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      );
      if (serverSessionError) {
        logOAuthCallbackFailure(
          "oauth_callback_session_sync_failed",
          serverSessionError,
        );
        return NextResponse.redirect(
          buildDashboardUrl(request, "/login?error=auth_failed"),
        );
      }
    }

    // Check if this is a multi-tenant user — redirect to picker if so.
    // The tenant list is embedded in the JWT by the custom access token hook.
    if (data.session) {
      const metadata = parseAccessTokenMetadata(data.session.access_token);
      if (metadata && metadata.tenants.length > 1) {
        return NextResponse.redirect(
          buildDashboardUrl(request, "/auth/select-tenant"),
        );
      }
    }
  }

  return NextResponse.redirect(buildDashboardUrl(request, next));
}
