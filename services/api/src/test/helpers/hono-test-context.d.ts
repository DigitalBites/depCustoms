import "hono";

declare module "hono" {
  interface ContextVariableMap {
    capabilityAllowed: boolean;
  }
}

export {};
