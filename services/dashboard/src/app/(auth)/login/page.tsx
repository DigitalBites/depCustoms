import { redirect } from "next/navigation";
import { LoginPageClient } from "@/components/login-page-client";
import { getBootstrapStatus } from "@/lib/bootstrap";
import { createServerClient } from "@/lib/supabase-server";

export default async function LoginPage() {
  const bootstrap = await getBootstrapStatus();
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (bootstrap.state !== "ready") {
    const canContinueToLogin =
      bootstrap.state === "needs_setup" &&
      bootstrap.nextStep === "sign_in" &&
      bootstrap.checks.usersExist &&
      !bootstrap.checks.ownerMembershipExists;

    if (user || !canContinueToLogin) {
      redirect("/setup");
    }
  } else if (user) {
    redirect("/dashboard");
  }

  return <LoginPageClient />;
}
