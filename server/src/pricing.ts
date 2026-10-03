import { ProviderUnavailableError, type Comp, type PriceProvider, type PriceRequest } from "./types.ts";
import { allStats } from "./stats.ts";
import { ebaySoldUrl } from "./query.ts";

// How long a "not approved" verdict sticks before we probe the provider again.
const UNAVAILABLE_RECHECK_MS = 6 * 60 * 60 * 1000;

export interface PriceResult {
  query: string | null;
  gtin: string | null;
  source: "sold" | "active" | "none";
  providerId: string | null;
  sourceLabel: string;
  comps: Comp[];
  stats: ReturnType<typeof allStats>;
  notes: string[];
  soldSearchUrl: string | null;
  soldDataAvailable: boolean;
  fetchedAt: string;
}

export class PriceService {
  private providers: PriceProvider[];
  private unavailableUntil = new Map<string, number>();
  private verified = new Set<string>();
  private log: (msg: string) => void;

  constructor(providers: PriceProvider[], log: (msg: string) => void = () => {}) {
    this.providers = providers;
    this.log = log;
  }

  isAvailable(id: string): boolean {
    return (this.unavailableUntil.get(id) ?? 0) <= Date.now();
  }

  /**
   * Whether sold data works for this credential set. Probes the sold
   * provider once if it has never been tried, so a fresh process doesn't
   * report "available" before eBay has been asked.
   */
  async soldStatus(): Promise<boolean> {
    const sold = this.providers.filter((p) => p.kind === "sold");
    for (const p of sold) {
      if (!this.isAvailable(p.id)) continue;
      if (this.verified.has(p.id)) return true;
      try {
        await p.search({ q: "nirvana nevermind CD", gtin: null });
        this.verified.add(p.id);
        return true;
      } catch (e) {
        if (e instanceof ProviderUnavailableError) this.unavailableUntil.set(p.id, Date.now() + UNAVAILABLE_RECHECK_MS);
      }
    }
    return false;
  }

  /**
   * Tries providers in priority order. For each, GTIN first (exact match),
   * then the keyword query. A provider that answers 403 / scope-not-granted
   * is marked unavailable and skipped without surfacing an error.
   */
  async lookup(req: PriceRequest): Promise<PriceResult> {
    const notes: string[] = [];
    const attempts: PriceRequest[] = [];
    if (req.gtin) attempts.push({ q: req.q, gtin: req.gtin });
    if (req.q) attempts.push({ q: req.q, gtin: null });

    for (const p of this.providers) {
      if (!this.isAvailable(p.id)) continue;
      try {
        for (const a of attempts) {
          const comps = await p.search(a);
          this.verified.add(p.id);
          if (comps.length > 0) {
            if (a.gtin === null && req.gtin) notes.push("No match for the barcode; showing keyword results.");
            return this.result(req, p, comps, notes);
          }
        }
        if (p.kind === "sold") notes.push("No sold comps in the last 90 days.");
      } catch (e) {
        if (e instanceof ProviderUnavailableError) {
          this.unavailableUntil.set(p.id, Date.now() + UNAVAILABLE_RECHECK_MS);
          this.verified.delete(p.id);
          this.log(`provider ${p.id} unavailable: ${e.message}`);
          continue;
        }
        this.log(`provider ${p.id} error: ${(e as Error).message}`);
        notes.push(p.kind === "sold" ? "Sold-price lookup failed." : "Active-listing lookup failed.");
      }
    }
    return this.result(req, null, [], notes);
  }

  private result(req: PriceRequest, p: PriceProvider | null, comps: Comp[], notes: string[]): PriceResult {
    const soldQuery = req.q ?? req.gtin;
    return {
      query: req.q,
      gtin: req.gtin,
      source: p ? p.kind : "none",
      providerId: p?.id ?? null,
      sourceLabel: p ? p.label : "No API data. Check eBay sold listings.",
      comps,
      stats: allStats(comps),
      notes,
      soldSearchUrl: soldQuery ? ebaySoldUrl(soldQuery) : null,
      soldDataAvailable: this.providers.some((x) => x.kind === "sold" && this.isAvailable(x.id)),
      fetchedAt: new Date().toISOString(),
    };
  }
}
