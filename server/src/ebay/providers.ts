import { ProviderUnavailableError, type Comp, type PriceProvider, type PriceRequest } from "../types.ts";
import { lotTerms } from "../query.ts";
import { BASE_SCOPE, INSIGHTS_SCOPE, ScopeNotGrantedError, apiBase, type EbayTokenManager } from "./token.ts";

type FetchFn = typeof fetch;

const MARKETPLACE = "EBAY_US";
const LIMIT = 50;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstShipping(item: any): number | null {
  const opt = Array.isArray(item?.shippingOptions) ? item.shippingOptions[0] : null;
  return num(opt?.shippingCost?.value);
}

function buildParams(req: PriceRequest, categoryId: string): URLSearchParams {
  const p = new URLSearchParams({ limit: String(LIMIT), category_ids: categoryId });
  if (req.gtin) p.set("gtin", req.gtin);
  else if (req.q) p.set("q", req.q);
  return p;
}

async function getJson(fetchFn: FetchFn, url: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      Accept: "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function errorIds(body: any): number[] {
  return Array.isArray(body?.errors) ? body.errors.map((e: any) => Number(e?.errorId)).filter(Number.isFinite) : [];
}

/** Sold items, last 90 days. Limited Release: needs eBay business-unit approval. */
export class MarketplaceInsightsProvider implements PriceProvider {
  id = "marketplace_insights";
  kind = "sold" as const;
  label = "Sold prices (eBay, last 90 days)";
  private tokens: EbayTokenManager;
  private categoryId: string;
  private fetchFn: FetchFn;

  constructor(tokens: EbayTokenManager, categoryId: string, fetchFn: FetchFn = fetch) {
    this.tokens = tokens;
    this.categoryId = categoryId;
    this.fetchFn = fetchFn;
  }

  async search(req: PriceRequest): Promise<Comp[]> {
    let token: string;
    try {
      token = await this.tokens.getToken([BASE_SCOPE, INSIGHTS_SCOPE]);
    } catch (e) {
      if (e instanceof ScopeNotGrantedError) throw new ProviderUnavailableError(this.id, "Marketplace Insights scope not granted to this eBay app");
      throw e;
    }
    const url = `${apiBase(this.tokens.environment)}/buy/marketplace_insights/v1_beta/item_sales/search?${buildParams(req, this.categoryId)}`;
    const { status, body } = await getJson(this.fetchFn, url, token);
    // 403 / 1100 "Access denied" / insufficient permissions = not approved.
    if (status === 403 || status === 401 || errorIds(body).includes(1100)) {
      throw new ProviderUnavailableError(this.id, `Marketplace Insights not available for this eBay app (HTTP ${status})`);
    }
    if (status >= 400) throw new Error(`Marketplace Insights HTTP ${status}`);
    const query = req.q ?? "";
    const items: any[] = Array.isArray(body?.itemSales) ? body.itemSales : [];
    return items
      .map((it): Comp | null => {
        const price = num(it?.lastSoldPrice?.value);
        if (price === null) return null;
        const title = String(it?.title ?? "");
        const terms = lotTerms(title, query);
        return {
          title,
          price,
          shipping: firstShipping(it),
          currency: String(it?.lastSoldPrice?.currency ?? "USD"),
          date: it?.lastSoldDate ? String(it.lastSoldDate) : null,
          condition: it?.condition ? String(it.condition) : null,
          imageUrl: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? null,
          url: it?.itemWebUrl ?? null,
          isLot: terms.length > 0,
          lotTerms: terms,
        };
      })
      .filter((c): c is Comp => c !== null);
  }
}

/** ACTIVE listings only. Asking prices, never sold prices. */
export class BrowseActiveProvider implements PriceProvider {
  id = "browse_active";
  kind = "active" as const;
  label = "Asking prices (active listings), not sold";
  private tokens: EbayTokenManager;
  private categoryId: string;
  private fetchFn: FetchFn;

  constructor(tokens: EbayTokenManager, categoryId: string, fetchFn: FetchFn = fetch) {
    this.tokens = tokens;
    this.categoryId = categoryId;
    this.fetchFn = fetchFn;
  }

  async search(req: PriceRequest): Promise<Comp[]> {
    const token = await this.tokens.getToken([BASE_SCOPE]);
    const url = `${apiBase(this.tokens.environment)}/buy/browse/v1/item_summary/search?${buildParams(req, this.categoryId)}`;
    const { status, body } = await getJson(this.fetchFn, url, token);
    if (status === 403 || status === 401) throw new ProviderUnavailableError(this.id, `Browse API not available for this eBay app (HTTP ${status})`);
    if (status >= 400) throw new Error(`Browse API HTTP ${status}`);
    const query = req.q ?? "";
    const items: any[] = Array.isArray(body?.itemSummaries) ? body.itemSummaries : [];
    return items
      .map((it): Comp | null => {
        const price = num(it?.price?.value);
        if (price === null) return null;
        const title = String(it?.title ?? "");
        const terms = lotTerms(title, query);
        return {
          title,
          price,
          shipping: firstShipping(it),
          currency: String(it?.price?.currency ?? "USD"),
          date: null,
          condition: it?.condition ? String(it.condition) : null,
          imageUrl: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? null,
          url: it?.itemWebUrl ?? null,
          isLot: terms.length > 0,
          lotTerms: terms,
        };
      })
      .filter((c): c is Comp => c !== null);
  }
}
