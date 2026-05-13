import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTOR_RESOLUTION_MODE } from "@customs/shared-constants";

vi.mock("../../db/index.js");
vi.mock("../../auth/admin-service.js", () => ({
  authAdminService: {
    listUsers: vi.fn(),
  },
}));

import { db } from "../../db/index.js";
import { authAdminService } from "../../auth/admin-service.js";
import {
  createProjectToken,
  listProjectTokens,
} from "../../features/tokens/service.js";
import {
  q,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

const OTHER_USER_ID = "00000000-0000-0000-0000-000000000123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project token service", () => {
  it("sets owner and creator to the current user for self-service creation", async () => {
    const insertQuery = q([
      {
        id: "00000000-0000-0000-0000-000000000456",
        token_prefix: "abc123",
        expires_at: null,
      },
    ]);
    vi.mocked(db.insert).mockReturnValueOnce(insertQuery as any);

    await createProjectToken({
      projectId: TEST_PROJECT_ID,
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      name: "local dev",
      expiresAt: null,
    });

    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_user_id: TEST_USER_ID,
        created_by_user_id: TEST_USER_ID,
      }),
    );
  });

  it("returns UUID-only actor objects without profile access", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "token-1",
          name: "local dev",
          token_prefix: "abc123",
          created_at: new Date("2026-01-01T00:00:00Z"),
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          owner_user_id: TEST_USER_ID,
          created_by_user_id: OTHER_USER_ID,
          revoked_by_user_id: null,
        },
      ]) as any,
    );

    await expect(
      listProjectTokens({
        projectId: TEST_PROJECT_ID,
        userId: TEST_USER_ID,
        canReadAll: false,
        actorResolutionMode: ACTOR_RESOLUTION_MODE.IDS_ONLY,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        owner: { user_id: TEST_USER_ID, email: null, provider: null },
        created_by: { user_id: OTHER_USER_ID, email: null, provider: null },
        revoked_by: null,
      }),
    ]);
    expect(authAdminService.listUsers).not.toHaveBeenCalled();
  });

  it("enriches actor profile details when profile access is allowed", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "token-1",
          name: "local dev",
          token_prefix: "abc123",
          created_at: new Date("2026-01-01T00:00:00Z"),
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          owner_user_id: TEST_USER_ID,
          created_by_user_id: TEST_USER_ID,
          revoked_by_user_id: OTHER_USER_ID,
        },
      ]) as any,
    );
    vi.mocked(authAdminService.listUsers).mockResolvedValueOnce([
      {
        id: TEST_USER_ID,
        email: "owner@example.com",
        app_metadata: { provider: "email" },
      },
    ]);

    await expect(
      listProjectTokens({
        projectId: TEST_PROJECT_ID,
        userId: TEST_USER_ID,
        canReadAll: true,
        actorResolutionMode: ACTOR_RESOLUTION_MODE.WITH_PROFILE,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        owner: {
          user_id: TEST_USER_ID,
          email: "owner@example.com",
          provider: "email",
        },
        revoked_by: { user_id: OTHER_USER_ID, email: null, provider: null },
      }),
    ]);
  });
});
