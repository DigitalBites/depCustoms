import { z } from "@hono/zod-openapi";

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      detail: z.string().nullable(),
    }),
  })
  .openapi("ErrorResponse");

export const uuidPathParam = (name: string, description: string) =>
  z
    .string()
    .uuid()
    .openapi({
      param: {
        name,
        in: "path",
        required: true,
      },
      description,
    });

export const projectPathParamsSchema = z
  .object({
    project_id: uuidPathParam("project_id", "Project UUID"),
  })
  .openapi("ProjectPathParams");

export const projectTokenPathParamsSchema = z
  .object({
    project_id: uuidPathParam("project_id", "Project UUID"),
    token_id: uuidPathParam("token_id", "Project token UUID"),
  })
  .openapi("ProjectTokenPathParams");
