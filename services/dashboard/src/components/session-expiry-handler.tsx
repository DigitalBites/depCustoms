"use client";

import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { redirectToLogin } from "@/lib/session-expiry";

export function SessionExpiryHandler() {
  useEffect(() => {
    const supabase = createBrowserClient();

    const verifySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        redirectToLogin();
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !session) {
        redirectToLogin();
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void verifySession();
      }
    };

    const handleWindowFocus = () => {
      void verifySession();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  return null;
}
