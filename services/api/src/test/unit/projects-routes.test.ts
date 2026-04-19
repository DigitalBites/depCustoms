import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../middleware/auth.js");

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { projectsRouter } from "../../routes/projects.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  fakeProject,
  q,
} from "../helpers/fakes.js";

let mockRole = "owner";

vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
  c.set("tenantId", TEST_TENANT_ID);
  c.set("userId", TEST_USER_ID);
  c.set("role", mockRole);
  await next();
});

const app = new Hono();
app.route("/", projectsRouter);

beforeEach(() => {
  mockRole = "owner";
  vi.clearAllMocks();

  vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", mockRole);
    await next();
  });

  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
});

describe("DELETE /v1/projects/:project_id", () => {
  it("returns 200 when an owner deletes a project", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([fakeProject()]) as any);
    vi.mocked(db.delete).mockReturnValueOnce(
      q([{ id: TEST_PROJECT_ID }]) as any,
    );

    const res = await app.request(`/v1/projects/${TEST_PROJECT_ID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe(TEST_PROJECT_ID);
  });

  it("returns 403 when a member tries to delete a project they can access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([{ project_id: TEST_PROJECT_ID }]) as any);

    const res = await app.request(`/v1/projects/${TEST_PROJECT_ID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when the project is missing", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await app.request(`/v1/projects/${TEST_PROJECT_ID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
