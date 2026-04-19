import test from "node:test";
import assert from "node:assert/strict";

import { getSafeExternalHref } from "@/lib/url-safety";

test("getSafeExternalHref allows https URLs", () => {
  assert.equal(
    getSafeExternalHref("https://example.com/advisory"),
    "https://example.com/advisory",
  );
});

test("getSafeExternalHref rejects javascript URLs", () => {
  assert.equal(getSafeExternalHref("javascript:alert(1)"), null);
});

test("getSafeExternalHref rejects malformed URLs", () => {
  assert.equal(getSafeExternalHref("not a url"), null);
});
