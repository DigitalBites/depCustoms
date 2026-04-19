import type { Context } from "hono";
import { z } from "zod";
import { log, serializeError } from "../logger.js";

export function errorBody(
  code: string,
  message: string,
  detail: string | null = null,
) {
  return { error: { code, message, detail } };
}

export function errorJson(
  c: Context,
  status: number,
  code: string,
  message: string,
  detail: string | null = null,
) {
  return c.json(errorBody(code, message, detail), status as any);
}

export async function logUpstreamFailure(
  operation: string,
  response: Response,
): Promise<void> {
  const detail = await response.text().catch(() => null);
  log.warn("upstream_request_failed", {
    operation,
    status: response.status,
    detail,
  });
}

export function logInternalFailure(operation: string, err: unknown): void {
  log.error("internal_operation_failed", {
    operation,
    ...serializeError(err),
  });
}

export const uuidParamSchema = z.string().uuid();

export function validateUuidParam(
  c: Context,
  name: string,
  label = "Identifier",
): string | null {
  const value = c.req.param(name);
  const parsed = uuidParamSchema.safeParse(value);
  if (!parsed.success) {
    c.res = errorJson(
      c,
      400,
      "BAD_REQUEST",
      `${label} must be a valid UUID`,
      null,
    ) as any;
    return null;
  }
  return parsed.data;
}
