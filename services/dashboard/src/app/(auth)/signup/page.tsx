import { redirect } from "next/navigation";
import { LoginPageClient } from "@/components/login-page-client";
import { getEnabledAuthProviders } from "@/lib/auth-provider-settings";
import { getBootstrapStatus } from "@/lib/bootstrap";
import { createServerClient } from "@/lib/supabase-server";

export default async function SignupPage() {
  const bootstrap = await getBootstrapStatus();
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (bootstrap.state !== "ready") {
    const canContinueToSignup =
      bootstrap.state === "needs_setup" && bootstrap.nextStep === "sign_in";

    if (user || !canContinueToSignup) {
      redirect("/setup");
    }
  } else if (user) {
    redirect("/dashboard");
  }

  const providers = await getEnabledAuthProviders();

  return <LoginPageClient providers={providers} mode="signup" />;
}
