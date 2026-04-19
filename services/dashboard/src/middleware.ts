/**
 * Next.js middleware — refreshes the Supabase session on every request.
 *
 * Required by @supabase/ssr: without this, server components call
 * supabase.auth.getUser() but the session cookie set by the browser client
 * is never forwarded to the server, so every server-side auth check fails
 * and the user is redirected back to /login immediately after signing in.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { config as appConfig } from "@/config";

export async function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/auth/oauth/authorize") ||
    request.nextUrl.pathname === "/auth/session"
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(appConfig.authUrl, appConfig.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh the session — updates the cookie if the token has been rotated.
  // Do NOT use getSession() here; getUser() validates the JWT server-side.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on page requests only — NOT on /v1/* API proxy paths.
    //
    // The Next.js rewrite proxies /v1/* to the API service, which validates
    // the Supabase JWT independently via Authorization: Bearer. Running
    // getUser() here for those requests causes 5+ redundant JWT validations
    // per page load (one per proxied API call), triggers concurrent token
    // refreshes, and writes conflicting Set-Cookie headers — all of which
    // flood the Supabase browser client's auth reconciliation loop.
    //
    // The OAuth authorize + consent routes also opt out. They perform their
    // own server-side session checks, and middleware refreshes add redundant
    // /user calls during the MCP handoff.
    "/((?!_next/static|_next/image|favicon.ico|v1/|internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
