import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import type { Config } from "./config.ts";
import type { PriceService, PriceResult } from "./pricing.ts";
import type { IdentifyResult } from "./identify.ts";
import { RateLimiter, TtlCache } from "./limits.ts";
import { cacheKey, normalizeGtin, buildKeywordQuery } from "./query.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface Deps {
  config: Pick<Config, "allowedOrigins" | "appPasscode" | "priceCacheHours" | "identifyLimits" | "priceLimits">;
  prices: PriceService;
  identify: (b64: string, mediaType: any) => Promise<IdentifyResult>;
  log?: (msg: string) => void;
}

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function passcodeOk(given: string | undefined, expected: string): boolean {
  return !!given && timingSafeEqual(sha(given), sha(expected));
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Image too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

export function createApp(deps: Deps) {
  const log = deps.log ?? (() => {});
  const identifyLimiter = new RateLimiter(deps.config.identifyLimits);
  const priceLimiter = new RateLimiter(deps.config.priceLimits);
  const priceCache = new TtlCache<PriceResult>(deps.config.priceCacheHours * 3600_000);

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin && deps.config.allowedOrigins.includes(origin)) {
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
    }
    const url = new URL(req.url ?? "/", "http://x");

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-App-Passcode, X-Device-Id",
          "Access-Control-Max-Age": "86400",
        });
        return res.end();
      }
      if (url.pathname === "/health") return send(res, 200, { ok: true }, cors);

      // Everything below needs the shared passcode and a device id.
      if (!passcodeOk(req.headers["x-app-passcode"] as string | undefined, deps.config.appPasscode)) {
        return send(res, 401, { error: "bad_passcode", message: "Wrong passcode." }, cors);
      }
      const deviceId = String(req.headers["x-device-id"] ?? "");
      if (!DEVICE_ID.test(deviceId)) return send(res, 400, { error: "bad_device", message: "Missing device id." }, cors);

      if (req.method === "GET" && url.pathname === "/v1/ping") {
        return send(res, 200, { ok: true, soldDataAvailable: await deps.prices.soldStatus() }, cors);
      }

      if (req.method === "POST" && url.pathname === "/v1/identify") {
        const v = identifyLimiter.check(deviceId);
        if (!v.ok) return send(res, 429, { error: v.reason, message: limitMessage(v.reason) }, cors);
        const body = await readJson(req);
        const image = typeof body?.image === "string" ? body.image : "";
        const mediaType = MEDIA_TYPES.has(body?.mediaType) ? body.mediaType : "image/jpeg";
        if (!image) return send(res, 400, { error: "no_image", message: "No image." }, cors);
        const result = await deps.identify(image, mediaType);
        return send(res, 200, result, cors);
      }

      if (req.method === "GET" && url.pathname === "/v1/prices") {
        const gtin = normalizeGtin(url.searchParams.get("gtin"));
        const artist = url.searchParams.get("artist") ?? "";
        const title = url.searchParams.get("title") ?? "";
        const q = buildKeywordQuery(artist, title) || null;
        if (!gtin && !q) return send(res, 400, { error: "no_query", message: "Need artist/title or a barcode." }, cors);
        const key = cacheKey(q, gtin);
        const cached = priceCache.get(key);
        if (cached) return send(res, 200, { ...cached, cached: true }, cors);
        const v = priceLimiter.check(deviceId);
        if (!v.ok) return send(res, 429, { error: v.reason, message: limitMessage(v.reason) }, cors);
        const result = await deps.prices.lookup({ q, gtin });
        // Don't cache total failures; a retry later may work.
        if (result.source !== "none" || result.notes.length === 0) priceCache.set(key, result);
        return send(res, 200, { ...result, cached: false }, cors);
      }

      return send(res, 404, { error: "not_found" }, cors);
    } catch (e: any) {
      const status = typeof e?.status === "number" ? e.status : 502;
      log(`error ${req.method} ${url.pathname}: ${e?.message ?? e}`);
      return send(res, status, { error: "upstream", message: status === 502 ? "Lookup failed. Try again." : e.message }, cors);
    }
  });
}

function limitMessage(reason: string): string {
  if (reason === "device_minute") return "Slow down a little and try again in a minute.";
  if (reason === "device_day") return "Daily limit reached for this phone.";
  return "Daily limit reached for the app. Try again tomorrow.";
}
