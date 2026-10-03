// Same CD seen in two photos = one row.
export function cdKey(artist, title) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/^the\s+/, "")
      .replace(/[([].*?[)\]]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(artist)}|${norm(title)}`;
}

/** Returns only the candidates not already present (by artist/title or UPC). */
export function newOnly(existing, candidates) {
  const seen = new Set(existing.map((i) => (i.upc ? `upc:${i.upc}` : cdKey(i.artist, i.title))));
  const out = [];
  for (const c of candidates) {
    const k = c.upc ? `upc:${c.upc}` : cdKey(c.artist, c.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
