import { config } from "../config.js";
import { fetchGotrue } from "./gotrue-client.js";
import { log, serializeError } from "../logger.js";

type AuthAdminHeaders = Record<string, string>;
type PaginatedResult<T> = {
  items: T[];
  page?: number;
  per_page?: number;
  total?: number;
};

export type AuthAdminUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: {
    provider?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export class AuthAdminServiceError extends Error {
  readonly kind: "misconfigured" | "upstream";
  readonly operation: string;
  readonly status?: number;
  readonly detail?: string | null;

  constructor(
    kind: "misconfigured" | "upstream",
    operation: string,
    message: string,
    options?: { status?: number; detail?: string | null },
  ) {
    super(message);
    this.name = "AuthAdminServiceError";
    this.kind = kind;
    this.operation = operation;
    this.status = options?.status;
    this.detail = options?.detail;
  }
}

const authAdminLog = log.child({ component: "auth_admin_service" });

class AuthAdminService {
  private get serviceKey(): string {
    const serviceKey = config.gotrueServiceRoleKey;
    if (!config.gotrueUrl || !serviceKey) {
      throw new AuthAdminServiceError(
        "misconfigured",
        "auth_admin_config",
        "GoTrue admin service is not configured",
      );
    }
    return serviceKey;
  }

  private headers(includeJson = false): AuthAdminHeaders {
    const serviceKey = this.serviceKey;
    return {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      ...(includeJson ? { "Content-Type": "application/json" } : {}),
    };
  }

  private async request(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      const response = await fetchGotrue(path, init);
      if (response.ok) return response;

      const detail = await response.text().catch(() => null);
      authAdminLog.warn("upstream_request_failed", {
        operation,
        status: response.status,
        detail,
      });
      throw new AuthAdminServiceError(
        "upstream",
        operation,
        "GoTrue admin request failed",
        { status: response.status, detail },
      );
    } catch (err) {
      if (err instanceof AuthAdminServiceError) throw err;

      authAdminLog.error("request_failed", {
        operation,
        ...serializeError(err),
      });
      throw err;
    }
  }

  private async requestPaginated<T>(
    operation: string,
    path: string,
    pageSize: number,
    extractItems: (body: Record<string, unknown>) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(pageSize),
      });
      const separator = path.includes("?") ? "&" : "?";
      const response = await this.request(
        operation,
        `${path}${separator}${params.toString()}`,
        { headers: this.headers() },
      );

      const body = (await response.json()) as Record<string, unknown>;
      const result: PaginatedResult<T> = {
        items: extractItems(body),
        page: typeof body.page === "number" ? body.page : undefined,
        per_page: typeof body.per_page === "number" ? body.per_page : undefined,
        total: typeof body.total === "number" ? body.total : undefined,
      };

      items.push(...result.items);

      if (result.total !== undefined && items.length >= result.total)
        return items;
      if (result.items.length < pageSize) return items;

      page += 1;
    }
  }

  async inviteUser(email: string): Promise<AuthAdminUser> {
    const response = await this.request("invite_user", "/invite", {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ email }),
    });
    return (await response.json()) as AuthAdminUser;
  }

  async createUser(email: string, password: string): Promise<AuthAdminUser> {
    const response = await this.request("create_user", "/admin/users", {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
      }),
    });
    return (await response.json()) as AuthAdminUser;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request("delete_user", `/admin/users/${userId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }

  async listUsers(pageSize = 1000): Promise<AuthAdminUser[]> {
    return this.requestPaginated(
      "list_users",
      "/admin/users",
      pageSize,
      (body) => (body.users as AuthAdminUser[] | undefined) ?? [],
    );
  }

  async findUserByEmail(email: string): Promise<AuthAdminUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return null;

    const users = await this.listUsers();
    return (
      users.find(
        (user) => user.email?.trim().toLowerCase() === normalizedEmail,
      ) ?? null
    );
  }

  async getUser(userId: string): Promise<AuthAdminUser | null> {
    try {
      const response = await this.request(
        "get_user",
        `/admin/users/${userId}`,
        {
          headers: this.headers(),
        },
      );
      return (await response.json()) as AuthAdminUser;
    } catch (err) {
      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "upstream" &&
        err.status === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async updateUser(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.request("update_user", `/admin/users/${userId}`, {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(payload),
    });
  }
}

export const authAdminService = new AuthAdminService();
