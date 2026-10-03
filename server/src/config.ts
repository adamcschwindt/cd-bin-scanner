import type { EbayEnv } from "./ebay/token.ts";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function int(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}

export function loadConfig() {
  const effort = (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high";
  return {
    port: int("PORT", 8080),
    // Comma-separated list of browser origins allowed to call the API.
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "https://adamcschwindt.github.io,http://localhost:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    appPasscode: req("APP_PASSCODE"),
    anthropicApiKey: req("ANTHROPIC_API_KEY"),
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
    claudeEffort: ["low", "medium", "high"].includes(effort) ? effort : "low",
    ebayClientId: req("EBAY_CLIENT_ID"),
    ebayClientSecret: req("EBAY_CLIENT_SECRET"),
    ebayEnv: (process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production") as EbayEnv,
    // Music > CDs on EBAY_US. Confirm with `npm run verify-ebay` (Taxonomy API).
    ebayCdCategoryId: process.env.EBAY_CD_CATEGORY_ID ?? "176984",
    priceCacheHours: int("PRICE_CACHE_HOURS", 12),
    identifyLimits: {
      perDevicePerDay: int("IDENTIFY_PER_DEVICE_PER_DAY", 200),
      perDevicePerMinute: int("IDENTIFY_PER_DEVICE_PER_MINUTE", 20),
      globalPerDay: int("IDENTIFY_GLOBAL_PER_DAY", 2000),
    },
    priceLimits: {
      perDevicePerDay: int("PRICES_PER_DEVICE_PER_DAY", 1000),
      perDevicePerMinute: int("PRICES_PER_DEVICE_PER_MINUTE", 60),
      globalPerDay: int("PRICES_GLOBAL_PER_DAY", 4000),
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
