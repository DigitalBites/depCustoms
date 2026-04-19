import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    gotrueUrl: "http://gotrue.local",
    gotrueServiceRoleKey: "service-role-key",
    gotrueRequestTimeoutMs: 5000,
  },
}));

import { config } from "../../config.js";
import {
  AuthAdminServiceError,
  authAdminService,
} from "../../auth/admin-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authAdminService", () => {
  it("sends invite requests with service-role headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "user-1" }),
      }),
    );

    const user = await authAdminService.inviteUser("user@example.com");

    expect(user.id).toBe("user-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://gotrue.local/invite",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer service-role-key",
          apikey: "service-role-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("returns null when getUser receives a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue("not found"),
      }),
    );

    await expect(authAdminService.getUser("user-1")).resolves.toBeNull();
  });

  it("throws a misconfigured error when admin credentials are missing", async () => {
    (config as any).gotrueServiceRoleKey = "";

    await expect(authAdminService.listUsers()).rejects.toMatchObject({
      name: "AuthAdminServiceError",
      kind: "misconfigured",
    } satisfies Partial<AuthAdminServiceError>);

    (config as any).gotrueServiceRoleKey = "service-role-key";
  });

  it("paginates through admin users until all pages are fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            users: [{ id: "user-1" }, { id: "user-2" }],
            page: 1,
            per_page: 2,
            total: 3,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            users: [{ id: "user-3" }],
            page: 2,
            per_page: 2,
            total: 3,
          }),
        }),
    );

    const users = await authAdminService.listUsers(2);

    expect(users.map((user) => user.id)).toEqual([
      "user-1",
      "user-2",
      "user-3",
    ]);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://gotrue.local/admin/users?page=1&per_page=2",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer service-role-key",
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://gotrue.local/admin/users?page=2&per_page=2",
      expect.any(Object),
    );
  });

  it("creates, updates, and deletes users through the admin API", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi
            .fn()
            .mockResolvedValue({ id: "user-9", email: "new@example.com" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(""),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(""),
          json: vi.fn().mockResolvedValue({}),
        }),
    );

    await expect(
      authAdminService.createUser("new@example.com", "password123"),
    ).resolves.toEqual({ id: "user-9", email: "new@example.com" });
    await expect(
      authAdminService.updateUser("user-9", {
        app_metadata: { role: "member" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      authAdminService.deleteUser("user-9"),
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://gotrue.local/admin/users",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://gotrue.local/admin/users/user-9",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "http://gotrue.local/admin/users/user-9",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("finds a user by normalized email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          users: [
            { id: "user-1", email: "first@example.com" },
            { id: "user-2", email: "Second@Example.com " },
          ],
          page: 1,
          per_page: 1000,
          total: 2,
        }),
      }),
    );

    await expect(
      authAdminService.findUserByEmail(" second@example.com "),
    ).resolves.toEqual({
      id: "user-2",
      email: "Second@Example.com ",
    });
    await expect(authAdminService.findUserByEmail("   ")).resolves.toBeNull();
  });

  it("wraps upstream failures with operation details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("boom"),
      }),
    );

    await expect(
      authAdminService.inviteUser("user@example.com"),
    ).rejects.toMatchObject({
      name: "AuthAdminServiceError",
      kind: "upstream",
      operation: "invite_user",
      status: 500,
      detail: "boom",
    } satisfies Partial<AuthAdminServiceError>);
  });
});
