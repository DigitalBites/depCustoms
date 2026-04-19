/**
 * HTTP/2 client for the OSV API.
 *
 * Uses undici's Agent for HTTP/2 persistent connections with keep-alive.
 * The backgroundTimeoutMs is passed as the AbortSignal timeout — this is the
 * maximum time we will wait for a response before aborting the connection
 * entirely. The per-request response deadline (responseTimeoutMs) is handled
 * in the gateway via Promise.race(), independently of this abort signal.
 */

import { fetch, Agent } from "undici";

type OsvQueryResponse = {
  vulns?: unknown[];
  next_page_token?: string;
};

export class OsvHttpClient {
  private agent: Agent;

  constructor(
    private baseUrl: string,
    private backgroundTimeoutMs: number,
  ) {
    this.agent = new Agent({
      connect: { rejectUnauthorized: true },
      keepAliveTimeout: 60_000, // 60s idle keep-alive; HTTP/2 sessions stay warm
    });
  }

  private async queryPage(
    ecosystem: string,
    pkg: string,
    version: string,
    pageToken?: string,
  ): Promise<OsvQueryResponse> {
    const res = await fetch(`${this.baseUrl}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name: pkg, ecosystem },
        version,
        ...(pageToken ? { page_token: pageToken } : {}),
      }),
      signal: AbortSignal.timeout(this.backgroundTimeoutMs),
      dispatcher: this.agent,
    });

    if (!res.ok) {
      throw new Error(`OSV API error: HTTP ${res.status}`);
    }

    return res.json() as Promise<OsvQueryResponse>;
  }

  async query(
    ecosystem: string,
    pkg: string,
    version: string,
  ): Promise<unknown> {
    const combined: OsvQueryResponse = { vulns: [] };
    let pageToken: string | undefined;

    do {
      const page = await this.queryPage(ecosystem, pkg, version, pageToken);
      if (page.vulns?.length) {
        combined.vulns!.push(...page.vulns);
      }
      pageToken = page.next_page_token;
    } while (pageToken);

    return combined;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
