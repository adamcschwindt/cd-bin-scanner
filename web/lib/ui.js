// DOM helpers. All text goes through textContent, never innerHTML, because
// listing titles come from eBay sellers.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "value") node[k] = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false || c === "") continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function sourceClass(source) {
  return source === "sold" ? "sold" : source === "active" ? "active" : "none";
}

export function confidenceBadge(c) {
  if (c >= 0.85) return el("span", { class: "badge conf-high" }, "High confidence");
  if (c >= 0.6) return el("span", { class: "badge conf-med" }, "Medium confidence");
  return el("span", { class: "badge conf-low" }, "Low confidence: check spelling");
}

/** Listing titles are noisy; trim the obvious seller junk for display. */
export function cleanListingTitle(t) {
  return (t || "")
    .replace(/\b(cd|compact disc|new|sealed|free shipping|fast ship\w*|tested|very good|vg\+?|like new|used)\b/gi, " ")
    .replace(/[|~*!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
