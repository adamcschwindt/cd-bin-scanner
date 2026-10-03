// CSV export. "median_price" + "price_source" so asking prices are never
// mistaken for sold prices in a spreadsheet.
export const CSV_HEADER = ["artist", "album", "year", "upc", "median_price", "price_source", "comp_count", "ebay_sold_link"];

function cell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sourceText(source) {
  if (source === "sold") return "sold (eBay, last 90 days)";
  if (source === "active") return "asking (active listings, not sold)";
  return "none";
}

export function toCsv(items, { hideLots = true } = {}) {
  const rows = [CSV_HEADER];
  for (const it of items) {
    const d = it.price?.data;
    const s = d ? (hideLots ? d.stats.noLots.item : d.stats.withLots.item) : null;
    rows.push([
      it.artist,
      it.title,
      it.year ?? "",
      it.upc ?? "",
      s?.median ?? "",
      d ? sourceText(d.source) : "",
      s?.count ?? "",
      d?.soldSearchUrl ?? "",
    ]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
