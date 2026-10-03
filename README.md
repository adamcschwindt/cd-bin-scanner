# CD Bin Scanner

A phone web app for CD resellers. You photograph a stack or box of CDs, or scan their barcodes. The app identifies each CD and shows what it goes for on eBay.

- **Page:** GitHub Pages (`web/`). It's static and holds no secrets.
- **Backend:** Google Cloud Run (`server/`), in the `remington-automation` project. It keeps the eBay and Anthropic keys and serves photo identification and price lookups.
- **On the phone:** open the page in Safari, tap Share, then **Add to Home Screen**.

```
iPhone Safari ──> adamcschwindt.github.io/cd-bin-scanner   (static page)
      │
      └─ passcode + device id ──> Cloud Run: /v1/identify  ──> Claude (Sonnet 5.5, vision)
                                             /v1/prices    ──> eBay Marketplace Insights (sold, if approved)
                                                                └─> eBay Browse (active listings)
```

## How prices work

The backend tries each source in order and uses the first one that returns results:

| Source | What it is | How it's shown |
|---|---|---|
| eBay Marketplace Insights | Real **sold** prices, last 90 days | Green, labeled "Sold · last 90 days" |
| eBay Browse | **Active** listings only, asking prices | Amber, labeled "Asking prices (active listings), not sold" |
| Manual | No API data | "Open eBay sold listings" button only |

- **Barcodes are exact matches.** A scanned barcode searches by GTIN first and falls back to keywords only if eBay finds nothing.
- **"Not approved" is handled quietly.** If Marketplace Insights returns 403 or the scope isn't granted, the source is skipped for 6 hours. Lookups go to Browse without showing an error.
- **Lots are filtered.** Lot and bundle listings ("lot", "bundle", "collection", "10 CDs"…) are removed before the median is calculated. A word that is part of the album's own name is ignored, so "The Essential Collection" still counts. You can turn the filter off in the price detail.
- **Stats:** median, low, high and comp count, plus a date range for sold data. An optional view includes shipping. Fewer than 3 comps is flagged "thin data".
- **Category:** every search is limited to Music > CDs (`EBAY_CD_CATEGORY_ID`, default `176984`), so vinyl and cassettes stay out of the comps. Confirm the ID with `npm run verify-ebay`.
- **No eBay page scraping, anywhere.** The "Open eBay sold listings" button just opens eBay's own search page in a new tab.

## Getting sold-price access

Real sold prices come from eBay's **Marketplace Insights API**. It's a *Limited Release* API, and only developers approved by eBay's business units can use it. To ask for it:

1. Sign in at developer.ebay.com with the account that owns this app's keys.
2. File an **Application Growth Check** (developer.ebay.com → Grow → Application Growth Check, or My Account → Support tickets → "App check"). Request access to Marketplace Insights (`buy.marketplace.insights`) and explain the use case: pricing used CDs for resale, low volume, internal tool.
3. Wait for eBay to answer. Forum reports show small apps are often turned down or never answered, so don't count on it.

**Until then:** the app shows active-listing asking prices, clearly labeled and colored amber, plus the "Open eBay sold listings" button for real sold prices. The app needs no change when approval arrives: the next lookup after the 6-hour recheck picks it up automatically. Settings shows "Sold prices: ✅ / ❌". `npm run verify-ebay` also tells you right away.

## Setup (one time)

You need:
- An eBay developer account with **production** keys: Client ID (App ID) and Client Secret (Cert ID).
- An Anthropic API key.
- `gcloud` logged in as a user who can deploy to `remington-automation`.

```bash
gcloud auth login
```

### 1. Check the eBay keys and category

```bash
cd server && npm ci && EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=... npm run verify-ebay
```

This prints the CDs category from eBay's Taxonomy API, one sample Browse search, and whether sold prices are approved. If the category ID isn't `176984`, set `EBAY_CD_CATEGORY_ID` when you deploy.

### 2. Store the secrets

```bash
./deploy/set-secrets.sh
```

You'll get hidden prompts for the eBay Client ID, the eBay Client Secret, the Anthropic key and a team passcode. The values go to Secret Manager only. They are never in the repo, the page, or the logs.

### 3. Deploy the backend

```bash
./deploy/deploy.sh
```

This prints the backend URL. Put it in `web/config.js` as `API_BASE`, then commit and push. GitHub Actions runs the tests and publishes the page.

### 4. Share

Send your team the page link and the passcode. Each phone enters the passcode once.

## Limits and costs

All limits can be changed with env vars on the Cloud Run service.

| | Per phone | Per phone | All phones |
|---|---|---|---|
| Photo identifications | 20 / minute | 200 / day | 2,000 / day |
| Price lookups | 60 / minute | 1,000 / day | 4,000 / day |

- **Price caching:** price results are cached for 12 hours, by normalized query or by barcode (`PRICE_CACHE_HOURS`). A cached answer doesn't count against the limits.
- **Single process:** Cloud Run runs with `max-instances=1`, so the limits and the cache live in one process. They reset when the service restarts, which only loosens them.
- **eBay call limit:** the Browse API's default limit is 5,000 calls/day per app, so the 4,000 global cap stays under it.
- **Claude cost:** Claude Sonnet 5.5 at about 1.5 MP per photo is roughly half a cent per photo.
- **Cloud Run cost:** it scales to zero, so it's about $0 when idle.

**Security:** the passcode is shared, so anyone who has it can use the app. Change it with `./deploy/set-secrets.sh` (passcode only) followed by `./deploy/deploy.sh`. Each phone is then asked for the new one.

## Local development (no keys needed)

```bash
npm --prefix server run dev:mock
```

```bash
python3 -m http.server 5173 --directory web
```

Open http://localhost:5173 and use passcode `dev`. The mock backend uses the real server code with fake eBay and Claude responses. Run it with `MOCK_SOLD=1` to see what sold data looks like.

## Tests

```bash
npm --prefix server test
```

```bash
node --test web-tests/web.test.mjs
```

The tests cover:
- query normalization
- the lot filter
- median and stats
- provider fallback on 403 / scope not granted
- GTIN-first search
- token scope separation
- passcode and CORS
- rate limits
- the price cache
- model-output validation
- CSV export (column labels, formula-injection guard)
- dedupe
- image sizing

## Differences from the original iPhone-app spec

- **Web app instead of a native app:** no Apple developer account is needed. Instead of the Keychain and a per-device install token, a shared passcode plus a device id is used for the limits.
- **Barcode scanning:** uses a vendored copy of ZXing (`web/vendor`, Apache-2.0), because iPhone Safari has no built-in barcode reader.
- **No "bring your own keys" mode.** Keys would have to sit in browser storage, so it was left out. It can be added later.
- **Separate eBay tokens:** the eBay token for Marketplace Insights is minted separately from the base token. Asking for a scope the app wasn't granted makes eBay reject the whole token request, which would also break Browse.
- **CSV columns:** the CSV uses `median_price` + `price_source` instead of "median sold", so asking prices are never mislabeled as sold.
- **Price caching vs eBay's terms:** eBay's API License Agreement limits how long you can keep eBay data. The 12-hour price cache is meant to stay within "refresh regularly". Lower `PRICE_CACHE_HOURS` if eBay's current terms require it.
- **Claude refusals:** the Claude request uses server-side refusal fallback (`fallbacks: "default"`). If Sonnet declines a photo, Anthropic re-runs it on its recommended fallback model.
