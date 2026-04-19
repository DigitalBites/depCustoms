import { redirect } from "next/navigation";
import { getBootstrapStatus } from "@/lib/bootstrap";
import { createServerClient } from "@/lib/supabase-server";

export default async function RootPage() {
  const bootstrap = await getBootstrapStatus();
  if (bootstrap.state !== "ready") {
    redirect("/setup");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
