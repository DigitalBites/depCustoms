import { randomBytes } from "node:crypto";
import { hashSecret } from "../../auth/hashing.js";

export function generateProxySecret() {
  const rawSecret = "cxp_" + randomBytes(16).toString("hex");
  return {
    rawSecret,
    secretHash: hashSecret(rawSecret),
    secretPrefix: rawSecret.slice(0, 12),
  };
}
