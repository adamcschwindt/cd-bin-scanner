import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIdentifyJson } from "../src/identify.ts";

test("parses and cleans model output", () => {
  const r = parseIdentifyJson(JSON.stringify({
    cds: [
      { artist: " Nirvana ", title: "Nevermind", year: 1991, confidence: 1.4, collectible: false, why: "ignored" },
      { artist: "", title: "No artist", year: null, confidence: 0.5, collectible: false, why: null },
      { artist: "Boards of Canada", title: "Music Has the Right to Children", year: 3000, confidence: "x", collectible: true, why: "original Warp pressing out of print UK" },
    ],
    unreadable: 2,
  }));
  assert.equal(r.cds.length, 2);
  assert.deepEqual(r.cds[0], { artist: "Nirvana", title: "Nevermind", year: 1991, confidence: 1, collectible: false, why: null });
  assert.equal(r.cds[1].year, null);
  assert.equal(r.cds[1].confidence, 0.5);
  assert.equal(r.cds[1].why, "original Warp pressing out of print");
  assert.equal(r.unreadable, 2);
});

test("tolerates prose around JSON and junk shapes", () => {
  assert.equal(parseIdentifyJson('Here you go: {"cds": [], "unreadable": 1}').unreadable, 1);
  assert.deepEqual(parseIdentifyJson('{"cds": "nope"}'), { cds: [], unreadable: 0 });
  assert.throws(() => parseIdentifyJson("no json here"));
});
