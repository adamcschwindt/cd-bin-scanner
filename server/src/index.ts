import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { EbayTokenManager } from "./ebay/token.ts";
import { BrowseActiveProvider, MarketplaceInsightsProvider } from "./ebay/providers.ts";
import { PriceService } from "./pricing.ts";
import { Identifier } from "./identify.ts";

const config = loadConfig();
// Logs never include request bodies, headers, or secrets.
const log = (msg: string) => console.log(JSON.stringify({ severity: "INFO", message: msg }));

const tokens = new EbayTokenManager({
  clientId: config.ebayClientId,
  clientSecret: config.ebayClientSecret,
  env: config.ebayEnv,
});
const prices = new PriceService(
  [
    new MarketplaceInsightsProvider(tokens, config.ebayCdCategoryId),
    new BrowseActiveProvider(tokens, config.ebayCdCategoryId),
  ],
  log,
);
const identifier = new Identifier({
  apiKey: config.anthropicApiKey,
  model: config.claudeModel,
  effort: config.claudeEffort,
});

createApp({ config, prices, identify: (b64, mt) => identifier.identify(b64, mt), log }).listen(config.port, () =>
  log(`listening on ${config.port} (eBay ${config.ebayEnv}, category ${config.ebayCdCategoryId}, model ${config.claudeModel})`),
);
