import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderShellExports,
  resolveBundledBootstrapEnvironment,
} from "../../bootstrap/bundled-runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveBundledBootstrapEnvironment", () => {
  it("generates and persists missing bundled secrets", async () => {
    const dataDir = await makeTempDir();

    const env = await resolveBundledBootstrapEnvironment({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_ALLOW_SECRET_GENERATION: "true",
      BOOTSTRAP_DATA_DIR: dataDir,
    });

    expect(env.PROXY_JWT_SECRET).not.toBe("");
    expect(env.PROXY_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(env.PROXY_CONTROL_PLANE_SECRET).toMatch(/^cxp_[0-9a-f]{32}$/);
    expect(env.GOTRUE_JWT_SECRET).not.toBe("");
    expect(env.GOTRUE_JWT_KEYS).toContain('"alg":"ES256"');
    expect(env.GOTRUE_JWT_KEYS).not.toContain('"alg":"HS256"');
    expect(decodeJwt(env.GOTRUE_ANON_KEY).role).toBe("anon");
    expect(decodeJwt(env.GOTRUE_SERVICE_ROLE_KEY).role).toBe("service_role");
    expect(env.GOTRUE_HOOK_SECRET).not.toBe("");
    expect(env.GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS).toContain("v1,whsec_");

    await expectSecretFile(
      path.join(dataDir, "secrets", "proxy-jwt-secret"),
      env.PROXY_JWT_SECRET,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "bundled-proxy-id"),
      env.PROXY_ID,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "bundled-proxy-secret"),
      env.PROXY_CONTROL_PLANE_SECRET,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "gotrue-jwt-secret"),
      env.GOTRUE_JWT_SECRET,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "gotrue-anon-key"),
      env.GOTRUE_ANON_KEY,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "gotrue-service-role-key"),
      env.GOTRUE_SERVICE_ROLE_KEY,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "gotrue-hook-secret"),
      env.GOTRUE_HOOK_SECRET,
    );
    await expectSecretFile(
      path.join(dataDir, "secrets", "gotrue-hook-custom-access-token-secrets"),
      env.GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS,
    );
  });

  it("reuses persisted values on later runs", async () => {
    const dataDir = await makeTempDir();

    const first = await resolveBundledBootstrapEnvironment({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_ALLOW_SECRET_GENERATION: "true",
      BOOTSTRAP_DATA_DIR: dataDir,
    });

    const second = await resolveBundledBootstrapEnvironment({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_ALLOW_SECRET_GENERATION: "true",
      BOOTSTRAP_DATA_DIR: dataDir,
    });

    expect(second).toEqual(first);
  });

  it("prefers explicit env values over persisted files", async () => {
    const dataDir = await makeTempDir();

    const env = await resolveBundledBootstrapEnvironment({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_ALLOW_SECRET_GENERATION: "true",
      BOOTSTRAP_DATA_DIR: dataDir,
      PROXY_JWT_SECRET: "explicit-proxy-secret",
      PROXY_ID: "00000000-0000-4000-8000-000000000001",
      PROXY_CONTROL_PLANE_SECRET: "cxp_0123456789abcdef0123456789abcdef",
      GOTRUE_JWT_SECRET: "explicit-gotrue-jwt-secret",
      GOTRUE_JWT_KEYS: '[{"kty":"oct","k":"abc","alg":"HS256"}]',
      GOTRUE_ANON_KEY: "anon-token",
      GOTRUE_SERVICE_ROLE_KEY: "service-role-token",
      GOTRUE_HOOK_SECRET: "explicit-hook-secret",
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS: "v1,whsec_ZXhwbGljaXQ=",
    });

    expect(env).toEqual({
      PROXY_JWT_SECRET: "explicit-proxy-secret",
      PROXY_ID: "00000000-0000-4000-8000-000000000001",
      PROXY_CONTROL_PLANE_SECRET: "cxp_0123456789abcdef0123456789abcdef",
      GOTRUE_JWT_SECRET: "explicit-gotrue-jwt-secret",
      GOTRUE_JWT_KEYS: '[{"kty":"oct","k":"abc","alg":"HS256"}]',
      GOTRUE_ANON_KEY: "anon-token",
      GOTRUE_SERVICE_ROLE_KEY: "service-role-token",
      GOTRUE_HOOK_SECRET: "explicit-hook-secret",
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS: "v1,whsec_ZXhwbGljaXQ=",
    });
  });

  it("fails clearly when generation is disabled and a required secret is missing", async () => {
    const dataDir = await makeTempDir();

    await expect(
      resolveBundledBootstrapEnvironment({
        BOOTSTRAP_MODE: "bundled",
        BOOTSTRAP_ALLOW_SECRET_GENERATION: "false",
        BOOTSTRAP_DATA_DIR: dataDir,
      }),
    ).rejects.toThrow(
      "PROXY_JWT_SECRET is required when BOOTSTRAP_ALLOW_SECRET_GENERATION=false",
    );
  });
});

describe("renderShellExports", () => {
  it("renders sourceable export lines", () => {
    expect(
      renderShellExports({
        PROXY_JWT_SECRET: "plain",
        PROXY_ID: "00000000-0000-4000-8000-000000000001",
        GOTRUE_HOOK_SECRET: "contains'quote",
      }),
    ).toBe(
      "export PROXY_JWT_SECRET='plain'\nexport PROXY_ID='00000000-0000-4000-8000-000000000001'\nexport GOTRUE_HOOK_SECRET='contains'\"'\"'quote'",
    );
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "customs-bootstrap-"));
  tempDirs.push(dir);
  return dir;
}

async function expectSecretFile(filePath: string, expectedValue: string) {
  const actual = await readFile(filePath, "utf8");
  expect(actual.trim()).toBe(expectedValue);
}
