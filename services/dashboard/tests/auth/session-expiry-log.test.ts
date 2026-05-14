import test from "node:test";
import assert from "node:assert/strict";

import { errorLogFields, isSessionExpiredAuthError } from "@/lib/errors";

test("session expiry auth errors are recognized without relying on stack traces", () => {
  assert.equal(
    isSessionExpiredAuthError({
      __isAuthError: true,
      status: 400,
      code: "session_expired",
      message: "Invalid Refresh Token: Session Expired (Inactivity)",
    }),
    true,
  );

  assert.equal(
    isSessionExpiredAuthError({
      __isAuthError: true,
      status: 401,
      code: "bad_jwt",
      message: "JWT is invalid",
    }),
    false,
  );
});

test("session expiry log fields omit noisy exception details", () => {
  assert.deepEqual(
    errorLogFields({
      status: 400,
      code: "session_expired",
      stack: "do not log",
    }),
    {
      error_code: "session_expired",
      status: 400,
    },
  );
});
