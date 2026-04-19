import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    logLevel: "debug",
  },
}));

import { log, serializeError } from "../../logger.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("logger helpers", () => {
  it("serializes Error instances into a consistent shape", () => {
    const err = new TypeError("boom");

    expect(serializeError(err)).toEqual({
      error_name: "TypeError",
      error_message: "boom",
    });
  });

  it("applies child logger context fields to emitted logs", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const requestLog = log.child({ request_id: "req-1" });

    requestLog.info("request_finished", { status: 200 });

    expect(stdout).toHaveBeenCalledTimes(1);
    const line = stdout.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");

    const parsed = JSON.parse(String(line));
    expect(parsed.service).toBe("api");
    expect(parsed.msg).toBe("request_finished");
    expect(parsed.request_id).toBe("req-1");
    expect(parsed.status).toBe(200);
  });
});
