// eBay application tokens (client_credentials grant), cached until shortly
// before expiry.
//
// The base scope and the Marketplace Insights scope are minted as separate
// tokens on purpose: asking for a scope the app was never granted makes eBay
// reject the WHOLE request (invalid_scope), which would also take down
// active-listing lookups.

export const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
export const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export type EbayEnv = "production" | "sandbox";

export function apiBase(env: EbayEnv): string {
  return env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

export class ScopeNotGrantedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeNotGrantedError";
  }
}

type FetchFn = typeof fetch;

export class EbayTokenManager {
  private clientId: string;
  private clientSecret: string;
  private env: EbayEnv;
  private fetchFn: FetchFn;
  private cache = new Map<string, { token: string; expiresAt: number }>();
  private inflight = new Map<string, Promise<string>>();

  constructor(opts: { clientId: string; clientSecret: string; env: EbayEnv; fetchFn?: FetchFn }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.env = opts.env;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get environment(): EbayEnv {
    return this.env;
  }

  async getToken(scopes: string[]): Promise<string> {
    const key = scopes.join(" ");
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.token;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.mint(scopes).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async mint(scopes: string[]): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetchFn(`${apiBase(this.env)}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: scopes.join(" ") }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body?.error === "invalid_scope" || body?.error === "unauthorized_client") {
        throw new ScopeNotGrantedError(`eBay did not grant scope (${body.error})`);
      }
      // Never include credentials in errors; eBay's error text is safe.
      throw new Error(`eBay token request failed: HTTP ${res.status} ${body?.error ?? ""}`.trim());
    }
    const ttlMs = Math.max(60, Number(body.expires_in ?? 7200) - 120) * 1000;
    this.cache.set(scopes.join(" "), { token: body.access_token, expiresAt: Date.now() + ttlMs });
    return body.access_token;
  }
}
