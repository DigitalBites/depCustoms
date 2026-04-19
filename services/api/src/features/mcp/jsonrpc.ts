import { z } from "zod";

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export class JsonRpcRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly id: JsonRpcId = null,
  ) {
    super(message);
    this.name = "JsonRpcRequestError";
  }
}

export function parseJsonRpcRequest(body: unknown): JsonRpcRequest {
  const parsed = jsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new JsonRpcRequestError(-32600, "Invalid Request");
  }

  return parsed.data;
}

export function jsonRpcResult(
  id: JsonRpcId,
  result: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}
