import { describe, expect, it } from "vitest";
import {
  buildGotrueProxyHeaders,
  buildGotrueProxyResponseHeaders,
} from "../../auth/gotrue-proxy.js";

describe("gotrue proxy header helpers", () => {
  it("forwards only allowlisted request headers", () => {
    const headers = buildGotrueProxyHeaders(
      new Headers({
        authorization: "Bearer token",
        cookie: "a=1",
        "content-type": "application/json",
        "x-client-info": "web",
        "x-not-allowed": "drop-me",
      }),
    );

    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("cookie")).toBe("a=1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-client-info")).toBe("web");
    expect(headers.get("x-not-allowed")).toBeNull();
  });

  it("removes hop-by-hop response headers", () => {
    const headers = buildGotrueProxyResponseHeaders(
      new Headers({
        connection: "keep-alive",
        "content-length": "12",
        "transfer-encoding": "chunked",
        "cache-control": "no-cache",
        etag: "abc",
      }),
    );

    expect(headers.get("connection")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("cache-control")).toBe("no-cache");
    expect(headers.get("etag")).toBe("abc");
  });
});
