import { test } from "node:test";
import assert from "node:assert/strict";
import { EbayTokenManager, INSIGHTS_SCOPE } from "../src/ebay/token.ts";
import { BrowseActiveProvider, MarketplaceInsightsProvider } from "../src/ebay/providers.ts";
import { PriceService } from "../src/pricing.ts";

type Route = (url: string, init: any) => { status: number; body: any };

function fakeFetch(route: Route) {
  const calls: string[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push(url);
    const { status, body } = route(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const tokenOk = (init: any) => ({ status: 200, body: { access_token: `tok:${new URLSearchParams(init.body).get("scope")}`, expires_in: 7200 } });
const browseBody = { itemSummaries: [
  { title: "Nirvana Nevermind CD", price: { value: "6.99", currency: "USD" }, shippingOptions: [{ shippingCost: { value: "3.50" } }], itemWebUrl: "https://ebay/1" },
  { title: "Nirvana Nevermind CD 1991", price: { value: "8.00", currency: "USD" }, itemWebUrl: "https://ebay/2" },
  { title: "Lot of 10 grunge CDs", price: { value: "30.00", currency: "USD" }, itemWebUrl: "https://ebay/3" },
] };

function service(route: Route) {
  const f = fakeFetch(route);
  const tokens = new EbayTokenManager({ clientId: "id", clientSecret: "secret", env: "production", fetchFn: f.fn });
  const svc = new PriceService([
    new MarketplaceInsightsProvider(tokens, "176984", f.fn),
    new BrowseActiveProvider(tokens, "176984", f.fn),
  ]);
  return { svc, calls: f.calls };
}

test("insights 403 falls through to active listings, labeled as asking prices", async () => {
  const { svc, calls } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    if (url.includes("marketplace_insights")) return { status: 403, body: { errors: [{ errorId: 1100, message: "Access denied" }] } };
    return { status: 200, body: browseBody };
  });
  const r = await svc.lookup({ q: "Nirvana Nevermind CD", gtin: null });
  assert.equal(r.source, "active");
  assert.match(r.sourceLabel, /Asking prices \(active listings\), not sold/);
  assert.equal(r.notes.length, 0, "403 must not surface as an error note");
  assert.equal(r.soldDataAvailable, false);
  assert.equal(r.stats.noLots.item.count, 2);
  assert.equal(r.comps.find((c) => c.title.startsWith("Lot"))?.isLot, true);
  assert.match(r.soldSearchUrl!, /LH_Sold=1/);

  // Second lookup skips insights entirely (remembered as unavailable).
  const before = calls.filter((u) => u.includes("marketplace_insights")).length;
  await svc.lookup({ q: "Pearl Jam Ten CD", gtin: null });
  assert.equal(calls.filter((u) => u.includes("marketplace_insights")).length, before);
});

test("insights scope not granted at token mint also falls through cleanly", async () => {
  const { svc } = service((url, init) => {
    if (url.includes("/oauth2/token")) {
      const scope = new URLSearchParams(init.body).get("scope")!;
      return scope.includes(INSIGHTS_SCOPE) ? { status: 400, body: { error: "invalid_scope" } } : tokenOk(init);
    }
    return { status: 200, body: browseBody };
  });
  const r = await svc.lookup({ q: "Nirvana Nevermind CD", gtin: null });
  assert.equal(r.source, "active");
  assert.equal(r.notes.length, 0);
});

test("base token never requests the insights scope", async () => {
  const scopes: string[] = [];
  const { svc } = service((url, init) => {
    if (url.includes("/oauth2/token")) {
      scopes.push(new URLSearchParams(init.body).get("scope")!);
      return tokenOk(init);
    }
    if (url.includes("marketplace_insights")) return { status: 403, body: {} };
    return { status: 200, body: browseBody };
  });
  await svc.lookup({ q: "x CD", gtin: null });
  assert.ok(scopes.includes("https://api.ebay.com/oauth/api_scope"));
});

test("approved insights returns sold data with dates", async () => {
  const { svc } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    if (url.includes("marketplace_insights"))
      return { status: 200, body: { itemSales: [
        { title: "Nirvana Nevermind CD", lastSoldPrice: { value: "5.00", currency: "USD" }, lastSoldDate: "2026-09-01T00:00:00.000Z" },
        { title: "Nirvana Nevermind", lastSoldPrice: { value: "7.00", currency: "USD" }, lastSoldDate: "2026-08-01T00:00:00.000Z" },
      ] } };
    throw new Error("browse should not be called");
  });
  const r = await svc.lookup({ q: "Nirvana Nevermind CD", gtin: null });
  assert.equal(r.source, "sold");
  assert.equal(r.stats.noLots.item.median, 6);
  assert.equal(r.stats.noLots.item.thin, true);
  assert.equal(r.stats.noLots.item.dateFrom, "2026-08-01T00:00:00.000Z");
});

test("gtin is tried first, then keywords", async () => {
  const { svc, calls } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    if (url.includes("marketplace_insights")) return { status: 403, body: {} };
    return { status: 200, body: url.includes("gtin=") ? { itemSummaries: [] } : browseBody };
  });
  const r = await svc.lookup({ q: "Nirvana Nevermind CD", gtin: "720642442524" });
  const browse = calls.filter((u) => u.includes("/browse/"));
  assert.match(browse[0], /gtin=720642442524/);
  assert.doesNotMatch(browse[0], /[?&]q=/);
  assert.match(browse[1], /[?&]q=/);
  assert.equal(r.source, "active");
  assert.match(r.notes[0], /barcode/);
});

test("every request carries the CDs category and EBAY_US marketplace", async () => {
  const seen: any[] = [];
  const { svc } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    seen.push({ url, h: init.headers });
    if (url.includes("marketplace_insights")) return { status: 403, body: {} };
    return { status: 200, body: browseBody };
  });
  await svc.lookup({ q: "x CD", gtin: null });
  for (const s of seen) {
    assert.match(s.url, /category_ids=176984/);
    assert.equal(s.h["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
  }
});

test("transient error on both providers returns manual-only result", async () => {
  const { svc } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    return { status: 500, body: {} };
  });
  const r = await svc.lookup({ q: "x CD", gtin: null });
  assert.equal(r.source, "none");
  assert.equal(r.notes.length, 2);
  assert.ok(r.soldSearchUrl);
  assert.equal(r.soldDataAvailable, true, "a 500 is not a 'not approved' verdict");
});

test("soldStatus probes once: false when not approved, without a lookup first", async () => {
  const { svc, calls } = service((url, init) => {
    if (url.includes("/oauth2/token")) return tokenOk(init);
    if (url.includes("marketplace_insights")) return { status: 403, body: {} };
    return { status: 200, body: browseBody };
  });
  assert.equal(await svc.soldStatus(), false);
  assert.equal(await svc.soldStatus(), false);
  assert.equal(calls.filter((u) => u.includes("marketplace_insights")).length, 1);
});
