import {
  createServerClient as _createServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { config } from "@/config";

type CreateServerClientOptions = {
  authUrl?: string;
};

export async function createServerClient(
  options: CreateServerClientOptions = {},
) {
  const cookieStore = await cookies();
  const authUrl = options.authUrl ?? config.authUrl;

  return _createServerClient(authUrl, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll is called from a Server Component — cookies can only be
          // set in middleware or route handlers. This error is safe to ignore
          // when reading session data.
        }
      },
    },
  });
}
