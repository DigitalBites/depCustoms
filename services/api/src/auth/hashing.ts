import { createHash } from "node:crypto";

export function hashProjectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
