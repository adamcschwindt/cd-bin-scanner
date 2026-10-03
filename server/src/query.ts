// Query building and lot detection. Pure functions, no I/O.

// Edition / disc noise that hurts eBay keyword matching. Applied to the
// query only; the original artist/title is kept for display.
const NOISE_PATTERNS: RegExp[] = [
  /[([]\s*(disc|disk|cd)\s*\d+(\s*(of|\/)\s*\d+)?\s*[)\]]/gi,
  /\b(disc|disk|cd)\s*\d+(\s*(of|\/)\s*\d+)?\b/gi,
  /[([][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|special|limited|collector'?s|bonus|explicit|clean|edition|version|reissue|import)\b[^)\]]*[)\]]/gi,
  /\b(\d+(st|nd|rd|th)\s+anniversary|((19|20)\d{2}\s+)?remaster(ed)?(\s+(19|20)\d{2})?|deluxe(\s+edition)?|expanded(\s+edition)?|special\s+edition|explicit(\s+version)?|clean\s+version|bonus\s+tracks?)\b/gi,
];

export function stripNoise(s: string): string {
  let out = s ?? "";
  for (const re of NOISE_PATTERNS) out = out.replace(re, " ");
  return out;
}

// Lowercase-insensitive, punctuation-free, single-spaced.
export function clean(s: string): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VARIOUS = /^(various( artists)?|va|v\/a)$/i;

/** "{artist} {title} CD", noise stripped. Compilations drop "Various Artists". */
export function buildKeywordQuery(artist: string, title: string): string {
  const a = clean(stripNoise(artist));
  const t = clean(stripNoise(title));
  const parts = [VARIOUS.test(a) ? "" : a, t].filter(Boolean);
  if (parts.length === 0) return "";
  return `${parts.join(" ")} CD`;
}

export function normalizeGtin(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return /^\d{8}$|^\d{12,14}$/.test(digits) ? digits : null;
}

export function cacheKey(q: string | null, gtin: string | null): string {
  return gtin ? `gtin:${gtin}` : `q:${clean(q ?? "").toLowerCase()}`;
}

export function ebaySoldUrl(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;
}

// Words that mark a multi-item listing. A term is ignored when it is part of
// the album's own name ("The Essential Collection" is not a lot).
const LOT_TERMS: { term: string; re: RegExp }[] = [
  { term: "lot", re: /\blots?\b/i },
  { term: "bundle", re: /\bbundles?\b/i },
  { term: "collection", re: /\bcollections?\b/i },
  { term: "wholesale", re: /\bwholesale\b/i },
  { term: "assorted", re: /\bassorted\b/i },
  { term: "mixed", re: /\bmixed\s+(cds?|genres?|lot)\b/i },
  { term: "you pick", re: /\b(you|u)\s+(pick|choose)\b/i },
];

// "10 CDs", "x12 CDs", "25 albums". Small counts are left alone because
// "2 CDs" / "3 discs" usually describes a double album or a box set.
const MULTI_COUNT = /\b(?:x\s*)?(\d{1,3})\s*(?:x\s*)?(?:cds|cd'?s|albums|discs)\b/gi;
const MIN_LOT_COUNT = 5;

export function lotTerms(listingTitle: string, query: string): string[] {
  const q = ` ${clean(query).toLowerCase()} `;
  const hits: string[] = [];
  for (const m of listingTitle.matchAll(MULTI_COUNT)) {
    if (Number(m[1]) >= MIN_LOT_COUNT) hits.push("multi");
  }
  for (const { term, re } of LOT_TERMS) {
    if (!re.test(listingTitle)) continue;
    if (q.includes(` ${term} `) || q.includes(` ${term}s `)) continue;
    hits.push(term);
  }
  return [...new Set(hits)];
}

export function isLot(listingTitle: string, query: string): boolean {
  return lotTerms(listingTitle, query).length > 0;
}
