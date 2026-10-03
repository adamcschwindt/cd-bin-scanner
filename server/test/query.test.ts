import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKeywordQuery, normalizeGtin, cacheKey, isLot, lotTerms, ebaySoldUrl } from "../src/query.ts";

test("keyword query strips disc and edition noise, keeps core title", () => {
  assert.equal(buildKeywordQuery("Nirvana", "Nevermind (Deluxe Edition) [Disc 1]"), "Nirvana Nevermind CD");
  assert.equal(buildKeywordQuery("The Beatles", "Abbey Road - 2019 Remaster"), "The Beatles Abbey Road CD");
  assert.equal(buildKeywordQuery("Pink Floyd", "The Wall, Disc 2 of 2"), "Pink Floyd The Wall CD");
  assert.equal(buildKeywordQuery("Guns N' Roses", "Appetite for Destruction"), "Guns N Roses Appetite for Destruction CD");
  assert.equal(buildKeywordQuery("Simon & Garfunkel", "Bookends"), "Simon and Garfunkel Bookends CD");
});

test("compilations drop Various Artists from the query", () => {
  assert.equal(buildKeywordQuery("Various Artists", "Now That's What I Call Music! 5"), "Now Thats What I Call Music 5 CD");
});

test("empty input gives empty query", () => {
  assert.equal(buildKeywordQuery("", ""), "");
});

test("gtin normalization accepts UPC/EAN only", () => {
  assert.equal(normalizeGtin("0 720642 44252 1"), "0720642442521");
  assert.equal(normalizeGtin("720642442524"), "720642442524");
  assert.equal(normalizeGtin("5099902987613"), "5099902987613");
  assert.equal(normalizeGtin("12345"), null);
  assert.equal(normalizeGtin(null), null);
});

test("cache key is case/punctuation insensitive and prefers gtin", () => {
  assert.equal(cacheKey("Nirvana  Nevermind CD", null), cacheKey("nirvana nevermind cd!", null));
  assert.equal(cacheKey("anything", "720642442524"), "gtin:720642442524");
});

test("sold URL matches spec format", () => {
  assert.equal(
    ebaySoldUrl("Nirvana Nevermind CD"),
    "https://www.ebay.com/sch/i.html?_nkw=Nirvana%20Nevermind%20CD&LH_Sold=1&LH_Complete=1&_sop=13",
  );
});

test("lot filter flags multi-item listings", () => {
  const q = "Nirvana Nevermind CD";
  assert.ok(isLot("Lot of 10 Rock CDs Nirvana Pearl Jam", q));
  assert.ok(isLot("Nirvana CD bundle Nevermind + In Utero", q));
  assert.ok(isLot("90s grunge CD collection nirvana", q));
  assert.ok(isLot("25 CDs wholesale mixed", q));
  assert.ok(isLot("x12 CDs rock pop", q));
  assert.ok(isLot("Nirvana Nevermind U PICK cds", q));
});

test("lot filter leaves single albums alone", () => {
  assert.ok(!isLot("Nirvana - Nevermind CD 1991 DGC", "Nirvana Nevermind CD"));
  assert.ok(!isLot("Pink Floyd The Wall 2 CDs Remastered", "Pink Floyd The Wall CD"));
  assert.ok(!isLot("Beatles Anthology 3 discs box", "Beatles Anthology CD"));
});

test("lot term that is part of the album name is ignored", () => {
  assert.deepEqual(lotTerms("Elton John The Essential Collection CD", "Elton John The Essential Collection CD"), []);
  assert.deepEqual(lotTerms("Elton John Collection CD lot of 5", "Elton John The Essential Collection CD"), ["lot"]);
});
