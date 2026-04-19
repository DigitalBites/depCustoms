import { createHash, randomBytes } from "node:crypto";

export function generateProxySecret() {
  const rawSecret = "cxp_" + randomBytes(16).toString("hex");
  return {
    rawSecret,
    secretHash: createHash("sha256").update(rawSecret).digest("hex"),
    secretPrefix: rawSecret.slice(0, 12),
  };
}
