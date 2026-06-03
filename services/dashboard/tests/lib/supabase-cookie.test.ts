import test from "node:test";
import assert from "node:assert/strict";

import { SUPABASE_AUTH_COOKIE_NAME } from "@/lib/supabase-cookie";

test("Supabase auth cookie name is stable across browser and server clients", () => {
  assert.equal(SUPABASE_AUTH_COOKIE_NAME, "customs-supabase-auth");
});

