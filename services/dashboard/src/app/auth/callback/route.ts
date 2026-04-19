/**
 * OAuth callback route — exchanges the PKCE authorization code for a session.
 *
 * After the session is established, multi-tenant users (those belonging to
 * more than one tenant) are redirected to /auth/select-tenant so they can
 * choose which tenant to activate for the session. Single-tenant users go
 * to setup so bootstrap gating can continue.
 */

import { NextResponse } from "next/server";
import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";
import { getSafeRedirectPath } from "@/lib/redirect";
import { createServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeRedirectPath(url.searchParams.get("next"), "/setup");

  if (code) {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL("/login?error=auth_failed", url.origin),
      );
    }

    // Check if this is a multi-tenant user — redirect to picker if so.
    // The tenant list is embedded in the JWT by the custom access token hook.
    if (data.session) {
      const metadata = parseAccessTokenMetadata(data.session.access_token);
      if (metadata && metadata.tenants.length > 1) {
        return NextResponse.redirect(
          new URL("/auth/select-tenant", url.origin),
        );
      }
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
