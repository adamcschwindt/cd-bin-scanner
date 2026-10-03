import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";
import { RateLimiter } from "../src/limits.ts";

const ORIGIN = "https://adamcschwindt.github.io";
const H = { "X-App-Passcode": "letmein", "X-Device-Id": "device-1234", Origin: ORIGIN };

async function start(overrides: any = {}) {
  let lookups = 0;
  const server = createApp({
    config: {
      allowedOrigins: [ORIGIN],
      appPasscode: "letmein",
      priceCacheHours: 12,
      identifyLimits: { perDevicePerDay: 2, perDevicePerMinute: 10, globalPerDay: 100 },
      priceLimits: { perDevicePerDay: 100, perDevicePerMinute: 100, globalPerDay: 100 },
    },
    prices: {
      isAvailable: () => false,
      lookup: async (req: any) => { lookups++; return { query: req.q, gtin: req.gtin, source: "active", notes: [], comps: [] }; },
    } as any,
    identify: async () => ({ cds: [{ artist: "A", title: "B", year: null, confidence: 1, collectible: false, why: null }], unreadable: 0 }),
    ...overrides,
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, server, lookups: () => lookups };
}

test("rejects wrong passcode, accepts right one, sets CORS for allowed origin", async () => {
  const { base, server } = await start();
  try {
    const bad = await fetch(`${base}/v1/ping`, { headers: { ...H, "X-App-Passcode": "nope" } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/v1/ping`, { headers: H });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    const other = await fetch(`${base}/v1/ping`, { headers: { ...H, Origin: "https://evil.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    server.close();
  }
});

test("identify enforces per-device daily limit", async () => {
  const { base, server } = await start();
  try {
    const post = () => fetch(`${base}/v1/identify`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ image: "abc" }) });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    const third = await post();
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, "device_day");
  } finally {
    server.close();
  }
});

test("prices builds the query, caches by normalized key", async () => {
  const { base, server, lookups } = await start();
  try {
    const r1 = await (await fetch(`${base}/v1/prices?artist=Nirvana&title=Nevermind%20(Disc%201)`, { headers: H })).json();
    assert.equal(r1.query, "Nirvana Nevermind CD");
    assert.equal(r1.cached, false);
    const r2 = await (await fetch(`${base}/v1/prices?artist=nirvana&title=nevermind`, { headers: H })).json();
    assert.equal(r2.cached, true);
    assert.equal(lookups(), 1);
    assert.equal((await fetch(`${base}/v1/prices`, { headers: H })).status, 400);
  } finally {
    server.close();
  }
});

test("rate limiter: per-minute, per-day, global, and daily reset", () => {
  let now = Date.parse("2026-10-02T15:00:00Z");
  const rl = new RateLimiter({ perDevicePerDay: 3, perDevicePerMinute: 2, globalPerDay: 4 }, () => now);
  assert.ok(rl.check("a").ok);
  assert.ok(rl.check("a").ok);
  assert.deepEqual(rl.check("a"), { ok: false, reason: "device_minute" });
  now += 61_000;
  assert.ok(rl.check("a").ok);
  assert.deepEqual(rl.check("a"), { ok: false, reason: "device_day" });
  assert.ok(rl.check("b").ok);
  assert.deepEqual(rl.check("c"), { ok: false, reason: "global_day" });
  now += 24 * 3600_000;
  assert.ok(rl.check("a").ok);
});
