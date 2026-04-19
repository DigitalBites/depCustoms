import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_MAX_SKEW_SECONDS = 300;
const WEBHOOK_ID_TTL_MS = WEBHOOK_MAX_SKEW_SECONDS * 1000;
const recentWebhookIds = new Map<string, number>();

export type HookVerificationResult =
  | { ok: true }
  | { ok: false; status: 401 | 409; code: string; message: string };

type VerifyHookInput = {
  secret: string;
  body: string;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  nowMs?: number;
};

export function verifyTokenHookRequest({
  secret,
  body,
  webhookId,
  webhookTimestamp,
  webhookSignature,
  nowMs = Date.now(),
}: VerifyHookInput): HookVerificationResult {
  const sigBase64 =
    webhookSignature
      .split(" ")
      .map((segment) =>
        segment.startsWith("v1,") ? segment.slice(3) : segment,
      )
      .find((segment) => segment.length > 0) ?? "";

  const signedPayload = `${webhookId}.${webhookTimestamp}.${body}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest();

  let provided = Buffer.alloc(0);
  try {
    provided = Buffer.from(sigBase64, "base64");
  } catch {
    provided = Buffer.alloc(0);
  }

  const signatureValid =
    sigBase64.length > 0 &&
    provided.length === expected.length &&
    timingSafeEqual(provided, expected);
  if (!signatureValid) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid hook signature",
    };
  }

  const webhookTsSeconds = Number.parseInt(webhookTimestamp, 10);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isFinite(webhookTsSeconds)) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid webhook timestamp",
    };
  }
  if (Math.abs(nowSeconds - webhookTsSeconds) > WEBHOOK_MAX_SKEW_SECONDS) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Webhook timestamp is outside the allowed skew window",
    };
  }

  pruneRecentWebhookIds(nowMs);
  if (webhookId && recentWebhookIds.has(webhookId)) {
    return {
      ok: false,
      status: 409,
      code: "REPLAYED_WEBHOOK",
      message: "Duplicate webhook delivery rejected",
    };
  }
  if (webhookId) {
    recentWebhookIds.set(webhookId, nowMs);
  }

  return { ok: true };
}

function pruneRecentWebhookIds(nowMs: number): void {
  for (const [id, seenAt] of recentWebhookIds) {
    if (nowMs - seenAt > WEBHOOK_ID_TTL_MS) {
      recentWebhookIds.delete(id);
    }
  }
}
