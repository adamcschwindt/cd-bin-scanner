import { test } from "node:test";
import assert from "node:assert/strict";
import { median, computeStats, allStats } from "../src/stats.ts";
import type { Comp } from "../src/types.ts";

const c = (price: number, shipping: number | null = null, isLot = false, date: string | null = null): Comp => ({
  title: "t", price, shipping, currency: "USD", date, condition: null, imageUrl: null, url: null, isLot, lotTerms: isLot ? ["lot"] : [],
});

test("median odd / even / empty", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([1.005, 2.335]), 1.67);
});

test("stats exclude lots when asked", () => {
  const comps = [c(5), c(7), c(9), c(50, null, true)];
  const s = computeStats(comps, { excludeLots: true, includeShipping: false });
  assert.deepEqual([s.count, s.median, s.low, s.high, s.thin], [3, 7, 5, 9, false]);
  const all = computeStats(comps, { excludeLots: false, includeShipping: false });
  assert.deepEqual([all.count, all.median, all.high], [4, 8, 50]);
});

test("total view adds shipping, unknown shipping counts as 0", () => {
  const s = computeStats([c(5, 4), c(7, null), c(9, 0)], { excludeLots: true, includeShipping: true });
  assert.deepEqual([s.low, s.median, s.high], [7, 9, 9]);
});

test("thin data flag under 3 comps", () => {
  assert.equal(computeStats([c(5), c(6)], { excludeLots: true, includeShipping: false }).thin, true);
  assert.equal(computeStats([], { excludeLots: true, includeShipping: false }).median, null);
});

test("date range from sold dates", () => {
  const s = computeStats([c(5, null, false, "2026-08-01T00:00:00Z"), c(6, null, false, "2026-06-15T00:00:00Z")], {
    excludeLots: true,
    includeShipping: false,
  });
  assert.equal(s.dateFrom, "2026-06-15T00:00:00Z");
  assert.equal(s.dateTo, "2026-08-01T00:00:00Z");
});

test("allStats returns all four views", () => {
  const a = allStats([c(5, 1), c(10, null, true)]);
  assert.equal(a.noLots.item.count, 1);
  assert.equal(a.withLots.total.high, 10);
});
