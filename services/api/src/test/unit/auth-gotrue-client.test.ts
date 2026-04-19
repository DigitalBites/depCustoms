import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    gotrueUrl: "http://gotrue.local",
    gotrueRequestTimeoutMs: 5000,
  },
}));

import {
  GotrueDependencyError,
  fetchGotrue,
  isGotrueDependencyError,
  normalizeGotrueDependencyError,
} from "../../auth/gotrue-client.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gotrue client helpers", () => {
  it("recognizes timeout and network errors", () => {
    const timeout = normalizeGotrueDependencyError(
      Object.assign(new Error("too slow"), { name: "AbortError" }),
    );
    expect(timeout).toBeInstanceOf(GotrueDependencyError);
    expect(timeout.kind).toBe("timeout");

    const network = normalizeGotrueDependencyError(new Error("socket hang up"));
    expect(network.kind).toBe("network");
    expect(isGotrueDependencyError(network)).toBe(true);
    expect(isGotrueDependencyError(new Error("plain"))).toBe(false);
  });

  it("passes through a provided abort signal", async () => {
    const signal = new AbortController().signal;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    );

    await fetchGotrue("/health", { method: "POST", signal });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://gotrue.local/health",
      expect.objectContaining({
        method: "POST",
        signal,
      }),
    );
  });

  it("wraps fetch failures with normalized dependency errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("deadline exceeded"), {
            name: "TimeoutError",
          }),
        ),
    );

    await expect(fetchGotrue("/invite")).rejects.toMatchObject({
      name: "GotrueDependencyError",
      kind: "timeout",
    });
  });
});
