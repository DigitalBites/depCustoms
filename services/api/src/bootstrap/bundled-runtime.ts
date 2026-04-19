import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

type SecretSource = "env" | "file" | "generated";

type SecretResolution = {
  value: string;
  source: SecretSource;
  path: string;
};

type BootstrapState = {
  mode: string;
  data_dir: string;
  generated_at: string;
  secrets: Record<
    string,
    {
      source: SecretSource;
      path: string;
    }
  >;
};

export type BundledBootstrapEnvironment = {
  PROXY_JWT_SECRET: string;
  PROXY_ID: string;
  PROXY_CONTROL_PLANE_SECRET: string;
  GOTRUE_JWT_SECRET: string;
  GOTRUE_JWT_KEYS: string;
  GOTRUE_ANON_KEY: string;
  GOTRUE_SERVICE_ROLE_KEY: string;
  GOTRUE_HOOK_SECRET: string;
  GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS: string;
};

export async function resolveBundledBootstrapEnvironment(
  env: NodeJS.ProcessEnv,
): Promise<BundledBootstrapEnvironment> {
  const mode = env.BOOTSTRAP_MODE ?? "bundled";
  if (mode !== "bundled") {
    return {
      PROXY_JWT_SECRET: env.PROXY_JWT_SECRET ?? "",
      PROXY_ID: env.PROXY_ID ?? "",
      PROXY_CONTROL_PLANE_SECRET: env.PROXY_CONTROL_PLANE_SECRET ?? "",
      GOTRUE_JWT_SECRET: env.GOTRUE_JWT_SECRET ?? "",
      GOTRUE_JWT_KEYS: env.GOTRUE_JWT_KEYS ?? "",
      GOTRUE_ANON_KEY: env.GOTRUE_ANON_KEY ?? "",
      GOTRUE_SERVICE_ROLE_KEY: env.GOTRUE_SERVICE_ROLE_KEY ?? "",
      GOTRUE_HOOK_SECRET: env.GOTRUE_HOOK_SECRET ?? "",
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS:
        env.GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS ?? "",
    };
  }

  const dataDir = env.BOOTSTRAP_DATA_DIR ?? "/app/data";
  const allowGeneration = parseBoolean(
    env.BOOTSTRAP_ALLOW_SECRET_GENERATION,
    true,
  );
  const secretsDir = path.join(dataDir, "secrets");
  const stateDir = path.join(dataDir, "state");

  await mkdir(secretsDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await chmod(secretsDir, 0o700);
  await chmod(stateDir, 0o700);

  const proxyJwtSecret = await resolveSecretValue({
    envName: "PROXY_JWT_SECRET",
    filePath: path.join(secretsDir, "proxy-jwt-secret"),
    envValue: env.PROXY_JWT_SECRET,
    allowGeneration,
    generate: () => randomBase64UrlSecret(32),
  });

  const proxyId = await resolveSecretValue({
    envName: "PROXY_ID",
    filePath: path.join(secretsDir, "bundled-proxy-id"),
    envValue: env.PROXY_ID,
    allowGeneration,
    generate: () => randomUUID(),
  });

  const proxyControlPlaneSecret = await resolveSecretValue({
    envName: "PROXY_CONTROL_PLANE_SECRET",
    filePath: path.join(secretsDir, "bundled-proxy-secret"),
    envValue: env.PROXY_CONTROL_PLANE_SECRET,
    allowGeneration,
    generate: () => `cxp_${randomBytes(16).toString("hex")}`,
  });

  const gotrueJwtSecret = await resolveSecretValue({
    envName: "GOTRUE_JWT_SECRET",
    filePath: path.join(secretsDir, "gotrue-jwt-secret"),
    envValue: env.GOTRUE_JWT_SECRET,
    allowGeneration,
    generate: () => randomBase64UrlSecret(32),
  });

  const gotrueJwtKeys = await resolveSecretValue({
    envName: "GOTRUE_JWT_KEYS",
    filePath: path.join(secretsDir, "gotrue-jwt-keys.json"),
    envValue: env.GOTRUE_JWT_KEYS,
    allowGeneration,
    generate: async () => JSON.stringify(await generateGotrueJwkSet()),
  });
  const gotrueAnonKey = await resolveSecretValue({
    envName: "GOTRUE_ANON_KEY",
    filePath: path.join(secretsDir, "gotrue-anon-key"),
    envValue: env.GOTRUE_ANON_KEY,
    allowGeneration,
    generate: async () =>
      signBootstrapRoleToken({
        role: "anon",
        signingKey: await getSigningKey(gotrueJwtKeys.value),
      }),
  });

  const gotrueServiceRoleKey = await resolveSecretValue({
    envName: "GOTRUE_SERVICE_ROLE_KEY",
    filePath: path.join(secretsDir, "gotrue-service-role-key"),
    envValue: env.GOTRUE_SERVICE_ROLE_KEY,
    allowGeneration,
    generate: async () =>
      signBootstrapRoleToken({
        role: "service_role",
        signingKey: await getSigningKey(gotrueJwtKeys.value),
      }),
  });

  const gotrueHookSecret = await resolveSecretValue({
    envName: "GOTRUE_HOOK_SECRET",
    filePath: path.join(secretsDir, "gotrue-hook-secret"),
    envValue: env.GOTRUE_HOOK_SECRET,
    allowGeneration,
    generate: () => randomBase64UrlSecret(32),
  });

  const gotrueHookCustomAccessTokenSecrets = await resolveSecretValue({
    envName: "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS",
    filePath: path.join(secretsDir, "gotrue-hook-custom-access-token-secrets"),
    envValue: env.GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS,
    allowGeneration,
    generate: () => buildHookCustomAccessTokenSecrets(gotrueHookSecret.value),
  });

  await writeBootstrapState({
    mode,
    dataDir,
    stateDir,
    secrets: {
      PROXY_JWT_SECRET: proxyJwtSecret,
      PROXY_ID: proxyId,
      PROXY_CONTROL_PLANE_SECRET: proxyControlPlaneSecret,
      GOTRUE_JWT_SECRET: gotrueJwtSecret,
      GOTRUE_JWT_KEYS: gotrueJwtKeys,
      GOTRUE_ANON_KEY: gotrueAnonKey,
      GOTRUE_SERVICE_ROLE_KEY: gotrueServiceRoleKey,
      GOTRUE_HOOK_SECRET: gotrueHookSecret,
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS:
        gotrueHookCustomAccessTokenSecrets,
    },
  });

  return {
    PROXY_JWT_SECRET: proxyJwtSecret.value,
    PROXY_ID: proxyId.value,
    PROXY_CONTROL_PLANE_SECRET: proxyControlPlaneSecret.value,
    GOTRUE_JWT_SECRET: gotrueJwtSecret.value,
    GOTRUE_JWT_KEYS: gotrueJwtKeys.value,
    GOTRUE_ANON_KEY: gotrueAnonKey.value,
    GOTRUE_SERVICE_ROLE_KEY: gotrueServiceRoleKey.value,
    GOTRUE_HOOK_SECRET: gotrueHookSecret.value,
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS:
      gotrueHookCustomAccessTokenSecrets.value,
  };
}

export function renderShellExports(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `export ${name}=${shellEscape(value)}`)
    .join("\n");
}

async function resolveSecretValue(input: {
  envName: string;
  envValue: string | undefined;
  filePath: string;
  allowGeneration: boolean;
  generate: () => Promise<string> | string;
}): Promise<SecretResolution> {
  const explicitValue = input.envValue?.trim();
  if (explicitValue) {
    return { value: explicitValue, source: "env", path: input.filePath };
  }

  const fileValue = await readSecretFile(input.filePath);
  if (fileValue) {
    return { value: fileValue, source: "file", path: input.filePath };
  }

  if (!input.allowGeneration) {
    throw new Error(
      `${input.envName} is required when BOOTSTRAP_ALLOW_SECRET_GENERATION=false`,
    );
  }

  const generatedValue = (await input.generate()).trim();
  if (!generatedValue) {
    throw new Error(`${input.envName} generator returned an empty value`);
  }

  await writeSecretFile(input.filePath, generatedValue);
  return { value: generatedValue, source: "generated", path: input.filePath };
}

async function readSecretFile(filePath: string): Promise<string | null> {
  try {
    const value = await readFile(filePath, "utf8");
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    if (isMissingFileError(err)) {
      return null;
    }
    throw err;
  }
}

async function writeSecretFile(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${value}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function isMissingFileError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

function parseBoolean(
  rawValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (rawValue === undefined) {
    return defaultValue;
  }
  return rawValue === "true";
}

function randomBase64UrlSecret(size: number): string {
  return randomBytes(size).toString("base64url");
}

async function generateGotrueJwkSet(): Promise<JWK[]> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const es256PrivateJwk = await exportJWK(privateKey);

  return [
    {
      ...es256PrivateJwk,
      kid: es256PrivateJwk.kid ?? randomUUID(),
      alg: "ES256",
      use: "sig",
      key_ops: ["sign", "verify"],
    },
  ];
}

async function getSigningKey(jwkSetJson: string): Promise<{
  key: CryptoKey | Uint8Array;
  alg: string;
  kid?: string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jwkSetJson);
  } catch {
    throw new Error("GOTRUE_JWT_KEYS must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("GOTRUE_JWT_KEYS must be a JSON array");
  }

  const signingJwk = (parsed as unknown[]).find(
    (entry): entry is JWK & { alg: string } =>
      !!entry &&
      typeof entry === "object" &&
      "alg" in entry &&
      "key_ops" in entry &&
      Array.isArray(entry.key_ops) &&
      entry.key_ops.includes("sign") &&
      typeof entry.alg === "string",
  );

  if (!signingJwk) {
    throw new Error("GOTRUE_JWT_KEYS must contain exactly one signing key");
  }

  const importableJwk: JWK = { ...signingJwk };
  delete (importableJwk as { key_ops?: unknown }).key_ops;
  delete (importableJwk as { use?: unknown }).use;

  return {
    key: await importJWK(importableJwk, signingJwk.alg),
    alg: signingJwk.alg,
    kid: typeof signingJwk.kid === "string" ? signingJwk.kid : undefined,
  };
}

function buildHookCustomAccessTokenSecrets(secret: string): string {
  return `v1,whsec_${Buffer.from(secret, "utf8").toString("base64")}`;
}

async function writeBootstrapState(input: {
  mode: string;
  dataDir: string;
  stateDir: string;
  secrets: Record<string, SecretResolution>;
}): Promise<void> {
  const state: BootstrapState = {
    mode: input.mode,
    data_dir: input.dataDir,
    generated_at: new Date().toISOString(),
    secrets: Object.fromEntries(
      Object.entries(input.secrets).map(([name, secret]) => [
        name,
        {
          source: secret.source,
          path: secret.path,
        },
      ]),
    ),
  };

  const statePath = path.join(input.stateDir, "bundled-bootstrap.json");
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(statePath, 0o600);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function signBootstrapRoleToken(input: {
  role: "anon" | "service_role";
  signingKey: {
    key: CryptoKey | Uint8Array;
    alg: string;
    kid?: string;
  };
  issuer?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt =
    issuedAt + (input.expiresInSeconds ?? 60 * 60 * 24 * 365 * 5);

  return await new SignJWT({
    role: input.role,
    iss: input.issuer ?? "supabase",
    iat: issuedAt,
    exp: expiresAt,
  })
    .setProtectedHeader({
      alg: input.signingKey.alg,
      ...(input.signingKey.kid ? { kid: input.signingKey.kid } : {}),
    })
    .sign(input.signingKey.key);
}
