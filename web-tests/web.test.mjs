// Tests for the page's pure modules (run: node --test web-tests/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, CSV_HEADER } from "../web/lib/csv.js";
import { newOnly, cdKey } from "../web/lib/dedupe.js";
import { targetSize, MAX_PIXELS } from "../web/lib/image.js";

const stats = (median, count) => ({ count, median, low: median, high: median, thin: count < 3 });
const priced = (source, median, count) => ({
  status: "ok",
  data: { source, soldSearchUrl: "https://www.ebay.com/sch/i.html?_nkw=x&LH_Sold=1", stats: { noLots: { item: stats(median, count) }, withLots: { item: stats(median + 1, count + 1) } } },
});

test("csv has spec columns and never labels asking prices as sold", () => {
  const csv = toCsv([
    { artist: "Nirvana", title: "Nevermind", year: 1991, upc: "720642442524", price: priced("active", 7.75, 4) },
    { artist: "Various Artists", title: 'Hits, "Vol 1"', year: null, upc: null, price: priced("sold", 5, 2) },
    { artist: "=cmd()", title: "x", year: null, upc: null, price: { status: "error" } },
  ]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], CSV_HEADER.join(","));
  assert.match(lines[1], /^Nirvana,Nevermind,1991,720642442524,7.75,"asking \(active listings, not sold\)",4,https/);
  assert.match(lines[2], /"Hits, ""Vol 1""".*,5,"sold \(eBay, last 90 days\)",2,/);
  assert.match(lines[3], /^'=cmd\(\),x,,,,,,$/);
});

test("csv respects the lot toggle", () => {
  const csv = toCsv([{ artist: "a", title: "b", price: priced("sold", 5, 3) }], { hideLots: false });
  assert.match(csv.split("\r\n")[1], /,6,"sold.*",4,/);
});

test("dedupe within a session by artist/title and UPC", () => {
  const existing = [{ artist: "The Beatles", title: "Abbey Road" }, { upc: "123456789012", artist: "", title: "" }];
  const out = newOnly(existing, [
    { artist: "Beatles", title: "Abbey Road (Remastered)" },
    { artist: "Beatles", title: "Abbey Road" },
    { upc: "123456789012" },
    { artist: "Nirvana", title: "Nevermind" },
    { artist: "nirvana", title: "NEVERMIND" },
  ]);
  assert.deepEqual(out.map((o) => o.title ?? o.upc), ["Nevermind"]);
  assert.equal(cdKey("The Who", "Tommy"), cdKey("who", "tommy!"));
});

test("downscale target is about 1.5MP and keeps aspect", () => {
  const { w, h } = targetSize(4032, 3024);
  assert.ok(w * h <= MAX_PIXELS && w * h > MAX_PIXELS * 0.99);
  assert.ok(Math.abs(w / h - 4032 / 3024) < 0.01);
  assert.deepEqual(targetSize(800, 600), { w: 800, h: 600 });
});
