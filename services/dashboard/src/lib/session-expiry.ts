export function redirectToLogin(reason = "session_expired") {
  if (typeof window === "undefined") {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (currentUrl.pathname === "/login") {
    return;
  }

  const loginUrl = new URL("/login", window.location.origin);
  loginUrl.searchParams.set("reason", reason);

  const next = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  if (next && next !== "/login") {
    loginUrl.searchParams.set("next", next);
  }

  window.location.replace(loginUrl.toString());
}
