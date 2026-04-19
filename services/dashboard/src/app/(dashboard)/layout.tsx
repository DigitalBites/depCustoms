import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardProvider } from "@/components/dashboard-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { SessionExpiryHandler } from "@/components/session-expiry-handler";
import { getBootstrapStatus } from "@/lib/bootstrap";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { normalizeTheme, THEME_COOKIE_NAME } from "@/lib/theme";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bootstrap = await getBootstrapStatus();
  if (bootstrap.state !== "ready") {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const initialTheme = normalizeTheme(
    cookieStore.get(THEME_COOKIE_NAME)?.value,
  );
  const { tenantId, role, tenants, userEmail, authProvider } =
    await requireDashboardAuth();

  return (
    <DashboardProvider tenantId={tenantId} role={role} tenants={tenants}>
      <SessionExpiryHandler />
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar
          userEmail={userEmail}
          authProvider={authProvider}
          initialTheme={initialTheme}
        />
        <main className="min-h-0 flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </DashboardProvider>
  );
}
