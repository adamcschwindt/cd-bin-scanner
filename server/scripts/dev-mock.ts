// Local UI testing without any keys: real server code, fake eBay + Claude.
//   npm run dev:mock   (API on :8080, passcode "dev")
// Insights answers 403 so the page shows the "asking prices" path; set
// MOCK_SOLD=1 to simulate an approved eBay app instead.
import { createApp } from "../src/app.ts";
import { EbayTokenManager } from "../src/ebay/token.ts";
import { BrowseActiveProvider, MarketplaceInsightsProvider } from "../src/ebay/providers.ts";
import { PriceService } from "../src/pricing.ts";

const sold = process.env.MOCK_SOLD === "1";
const items = (q: string) => [
  { title: `${q} 1991 original`, p: 6.99, s: 3.5 },
  { title: `${q} excellent condition`, p: 8.5, s: 0 },
  { title: `${q} jewel case`, p: 5.25, s: 4.0 },
  { title: `Lot of 10 rock CDs incl ${q}`, p: 25, s: 6 },
  { title: `${q} remastered`, p: 11, s: null },
];
const fakeFetch = (async (url: string, init: any) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (url.includes("/oauth2/token")) return json(200, { access_token: "t", expires_in: 7200 });
  const q = new URL(url).searchParams.get("q") ?? `UPC ${new URL(url).searchParams.get("gtin")}`;
  await new Promise((r) => setTimeout(r, 600));
  if (url.includes("marketplace_insights")) {
    if (!sold) return json(403, { errors: [{ errorId: 1100 }] });
    return json(200, { itemSales: items(q).map((i, n) => ({ title: i.title, lastSoldPrice: { value: String(i.p), currency: "USD" }, lastSoldDate: new Date(Date.now() - n * 9 * 864e5).toISOString(), itemWebUrl: "https://www.ebay.com/itm/1", condition: "Used" })) });
  }
  if (q.includes("Rare")) return json(200, { itemSummaries: [{ title: `${q}`, price: { value: "40.00", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/2" }] });
  return json(200, {
    itemSummaries: items(q).map((i) => ({
      title: i.title, price: { value: String(i.p), currency: "USD" },
      shippingOptions: i.s === null ? [] : [{ shippingCost: { value: String(i.s) } }],
      itemWebUrl: "https://www.ebay.com/itm/1", condition: "Very Good",
      image: { imageUrl: "https://i.ebayimg.com/images/g/placeholder/s-l225.jpg" },
    })),
  });
}) as unknown as typeof fetch;

const tokens = new EbayTokenManager({ clientId: "x", clientSecret: "y", env: "production", fetchFn: fakeFetch });
const prices = new PriceService([new MarketplaceInsightsProvider(tokens, "176984", fakeFetch), new BrowseActiveProvider(tokens, "176984", fakeFetch)], console.log);

createApp({
  config: {
    allowedOrigins: ["http://localhost:5173"],
    appPasscode: "dev",
    priceCacheHours: 12,
    identifyLimits: { perDevicePerDay: 500, perDevicePerMinute: 60, globalPerDay: 5000 },
    priceLimits: { perDevicePerDay: 5000, perDevicePerMinute: 300, globalPerDay: 50000 },
  },
  prices,
  identify: async () => {
    await new Promise((r) => setTimeout(r, 1200));
    return {
      cds: [
        { artist: "Nirvana", title: "Nevermind", year: 1991, confidence: 0.97, collectible: false, why: null },
        { artist: "Radiohead", title: "OK Computer (Disc 1)", year: null, confidence: 0.72, collectible: false, why: null },
        { artist: "Boards of Canada", title: "Geogaddi Rare", year: 2002, confidence: 0.55, collectible: true, why: "out-of-print Warp pressing" },
      ],
      unreadable: 1,
    };
  },
  log: console.log,
}).listen(8080, () => console.log("mock API on :8080, passcode 'dev'"));
