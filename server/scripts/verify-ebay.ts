// One-off live check of the eBay setup. Run with your keys in the env:
//   EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=... npm run verify-ebay
// Prints: token mint per scope, the Music > CDs category from the Taxonomy
// API, one Browse search, and a Marketplace Insights probe. Never prints keys.
import { EbayTokenManager, BASE_SCOPE, INSIGHTS_SCOPE, apiBase, type EbayEnv } from "../src/ebay/token.ts";

const env: EbayEnv = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const id = process.env.EBAY_CLIENT_ID;
const secret = process.env.EBAY_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET first.");
  process.exit(1);
}
const tokens = new EbayTokenManager({ clientId: id, clientSecret: secret, env });
const base = apiBase(env);
const hdr = (t: string) => ({ Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" });

let token: string;
try {
  token = await tokens.getToken([BASE_SCOPE]);
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  if (String(e).includes("invalid_client")) {
    console.error("eBay rejected the App ID / Cert ID pair. Check: Production keys (not Sandbox), App ID and Cert ID from the SAME keyset, both copied in full.");
  }
  process.exit(1);
}
console.log(`✅ base token minted (${env})`);

// Taxonomy: find the CDs category under Music.
const tree = await (await fetch(`${base}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US`, { headers: hdr(token) })).json();
const sugg = await (
  await fetch(`${base}/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=music%20cd`, { headers: hdr(token) })
).json();
console.log("Category suggestions for 'music cd':");
for (const s of sugg.categorySuggestions ?? []) {
  const path = [...(s.categoryTreeNodeAncestors ?? [])].reverse().map((a: any) => a.categoryName).join(" > ");
  console.log(`  ${s.category.categoryId}  ${path} > ${s.category.categoryName}`);
}

const cat = process.env.EBAY_CD_CATEGORY_ID ?? "176984";
const b = await fetch(`${base}/buy/browse/v1/item_summary/search?q=nirvana%20nevermind%20cd&category_ids=${cat}&limit=3`, { headers: hdr(token) });
const bj: any = await b.json();
console.log(`Browse search (category ${cat}): HTTP ${b.status}, total=${bj.total ?? "?"}`);
for (const it of bj.itemSummaries ?? []) console.log(`  $${it.price?.value}  ${it.title}  [${it.categories?.map((c: any) => c.categoryId).join(",")}]`);

try {
  const it = await tokens.getToken([BASE_SCOPE, INSIGHTS_SCOPE]);
  const r = await fetch(`${base}/buy/marketplace_insights/v1_beta/item_sales/search?q=nirvana%20nevermind%20cd&category_ids=${cat}&limit=3`, { headers: hdr(it) });
  console.log(`Sold prices (Marketplace Insights): HTTP ${r.status} ${r.ok ? "✅ approved" : "❌ not approved"}`);
} catch (e) {
  console.log(`Sold prices (Marketplace Insights): ❌ not approved (${(e as Error).message})`);
}
