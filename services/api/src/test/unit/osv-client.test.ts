import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, closeMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  closeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("undici", () => ({
  fetch: fetchMock,
  Agent: class {
    close = closeMock;
  },
}));

import { OsvHttpClient } from "../../connectors/osv/client.js";

describe("OsvHttpClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    closeMock.mockClear();
  });

  it("follows next_page_token until all advisory pages are merged", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          vulns: [{ id: "OSV-1" }],
          next_page_token: "page-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          vulns: [{ id: "OSV-2" }],
        }),
      });

    const client = new OsvHttpClient("https://osv.example.test", 5000);

    await expect(client.query("npm", "left-pad", "1.0.0")).resolves.toEqual({
      vulns: [{ id: "OSV-1" }, { id: "OSV-2" }],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://osv.example.test/v1/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          package: { name: "left-pad", ecosystem: "npm" },
          version: "1.0.0",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://osv.example.test/v1/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          package: { name: "left-pad", ecosystem: "npm" },
          version: "1.0.0",
          page_token: "page-2",
        }),
      }),
    );

    await client.close();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
