export async function syncServerSession(
  session:
    | {
        access_token: string;
        refresh_token: string;
      }
    | null
    | undefined,
): Promise<void> {
  if (!session) return;

  const response = await fetch("/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Customs-Session-Sync": "1",
    },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to sync server session");
  }
}
