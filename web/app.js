import * as api from "./lib/api.js";
import { downscale, blobToBase64 } from "./lib/image.js";
import * as db from "./lib/db.js";
import { newOnly } from "./lib/dedupe.js";
import { toCsv } from "./lib/csv.js";
import { startScanner } from "./lib/barcode.js";
import { el, money, confidenceBadge, safeUrl, shortDate, sourceClass, cleanListingTitle } from "./lib/ui.js";

const MAX_PHOTOS = 5;
const PRICE_CONCURRENCY = 3;
const CURRENT_KEY = "cdbin.current";
const PREFS_KEY = "cdbin.prefs";

const $ = (id) => document.getElementById(id);
const rows = new Map(); // item id -> <li>

const state = {
  scan: null,
  prefs: loadPrefs(),
  pendingPhotos: 0,
  queuedPhotos: 0,
  soldAvailable: null,
};

/* ---------- small helpers ---------- */

function loadPrefs() {
  try {
    return { hideLots: true, includeShipping: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { hideLots: true, includeShipping: false };
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch {}
}
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

function newScan() {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [], unreadable: 0 };
}

let saveTimer = null;
function persist() {
  state.scan.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Strip transient fields before saving.
    const clean = { ...state.scan, items: state.scan.items.map(({ _req, ...i }) => i) };
    db.saveScan(clean).catch(() => {});
  }, 300);
}

let toastTimer = null;
function toast(msg, action) {
  const t = $("toast");
  t.replaceChildren(el("span", {}, msg));
  if (action) t.append(el("button", { type: "button", onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 6000 : 3500);
}

function show(view) {
  for (const v of ["setup", "scan", "history", "settings"]) $(`view-${v}`).hidden = v !== view;
  $("nav-scan").hidden = view === "scan" || view === "setup";
  $("nav-history").hidden = view === "history" || view === "setup";
  $("nav-settings").hidden = view === "settings" || view === "setup";
  if (view === "history") renderHistory();
  if (view === "settings") renderSettings();
  window.scrollTo(0, 0);
}

function handleAuthError(e) {
  if (e instanceof api.ApiError && e.status === 401) {
    api.setPasscode(null);
    show("setup");
    $("setup-error").textContent = "Passcode was changed. Enter the new one.";
    return true;
  }
  return false;
}

/* ---------- status line ---------- */

function renderStatus() {
  const parts = [];
  if (state.pendingPhotos) parts.push(el("span", {}, el("span", { class: "spinner", "aria-hidden": "true" }), ` Reading ${state.pendingPhotos} photo${state.pendingPhotos > 1 ? "s" : ""}…`));
  if (state.queuedPhotos) parts.push(el("span", {}, `${state.queuedPhotos} photo${state.queuedPhotos > 1 ? "s" : ""} waiting for a connection.`));
  if (state.scan?.unreadable) parts.push(el("span", { class: "muted" }, ` ${state.scan.unreadable} CD${state.scan.unreadable > 1 ? "s" : ""} could not be read. Try a closer photo.`));
  $("scan-status").replaceChildren(...parts.flatMap((p, i) => (i ? [el("br"), p] : [p])));
}

function renderNet() {
  const b = $("net-banner");
  b.hidden = navigator.onLine;
  b.textContent = "Offline. Photos are saved and will be checked when you have signal.";
}

/* ---------- results list ---------- */

function renderList() {
  const ul = $("results");
  const items = state.scan.items;
  $("empty-state").hidden = items.length > 0;
  $("results-count").textContent = items.length ? `(${items.length})` : "";
  const keep = new Set(items.map((i) => i.id));
  for (const [id, li] of rows) if (!keep.has(id)) { li.remove(); rows.delete(id); }
  items.forEach((item) => {
    let li = rows.get(item.id);
    if (!li) {
      li = buildRow(item);
      rows.set(item.id, li);
    }
    ul.append(li); // keeps order
    updateRow(item);
  });
}

function buildRow(item) {
  const artist = el("input", { type: "text", class: "f-artist", "aria-label": "Artist", placeholder: "Artist", autocomplete: "off", autocapitalize: "words" });
  const title = el("input", { type: "text", class: "f-title", "aria-label": "Album title", placeholder: "Album title", autocomplete: "off", autocapitalize: "words" });
  for (const input of [artist, title]) {
    input.addEventListener("change", () => onEdit(item.id, artist.value, title.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  }
  const inner = el("div", { class: "result-inner" },
    title, artist,
    el("div", { class: "meta" }),
    el("button", { type: "button", class: "price", onclick: () => openDetail(item.id) }),
  );
  const del = el("button", { type: "button", class: "visually-hidden", onclick: () => removeItem(item.id) }, "Delete");
  const li = el("li", { class: "result", "data-id": item.id }, el("span", { class: "swipe-label", "aria-hidden": "true" }, "Delete"), inner, del);
  attachSwipe(inner, () => removeItem(item.id));
  return li;
}

function updateRow(item) {
  const li = rows.get(item.id);
  if (!li) return;
  const artist = li.querySelector(".f-artist");
  const title = li.querySelector(".f-title");
  if (document.activeElement !== artist) artist.value = item.artist;
  if (document.activeElement !== title) title.value = item.title;
  const name = `${item.title || "Unknown title"}${item.artist ? ` by ${item.artist}` : ""}`;
  li.querySelector(".visually-hidden").setAttribute("aria-label", `Delete ${name}`);

  const meta = li.querySelector(".meta");
  meta.replaceChildren(
    ...(item.year ? [el("span", {}, String(item.year))] : []),
    ...(item.upc ? [el("span", {}, `UPC ${item.upc}`)] : []),
    ...(item.origin === "photo" ? [confidenceBadge(item.confidence)] : [el("span", { class: "badge conf-high" }, "Barcode match")]),
    ...(item.titleFromListing ? [el("span", { class: "muted" }, "name from eBay listing")] : []),
    ...(item.collectible ? [el("span", { class: "badge flag" }, `★ Worth checking${item.why ? `: ${item.why}` : ""}`)] : []),
  );

  const btn = li.querySelector(".price");
  btn.className = "price";
  const p = item.price || { status: "idle" };
  if (p.status === "loading" || p.status === "idle") {
    btn.replaceChildren(el("span", { class: "sub" }, el("span", { class: "spinner", "aria-hidden": "true" }), " Checking eBay…"));
  } else if (p.status === "queued") {
    btn.replaceChildren(el("span", { class: "sub" }, "Will check prices when online."));
  } else if (p.status === "error") {
    btn.replaceChildren(el("span", { class: "sub" }, `${p.error || "Price check failed."} Tap for options.`));
  } else {
    const d = p.data;
    const s = pickStats(d);
    btn.classList.add(sourceClass(d.source));
    const label = d.source === "sold" ? "Sold · last 90 days" : d.source === "active" ? "Asking prices (active listings), not sold" : "No API price data";
    btn.replaceChildren(
      el("span", { class: "src" }, label),
      d.source === "none" || s.median === null
        ? el("span", { class: "sub" }, "Tap to open eBay sold listings.")
        : el("span", { class: "num" }, `${money(s.median)} median`),
      ...(s.median !== null && d.source !== "none"
        ? [el("span", { class: "sub" }, `${money(s.low)} – ${money(s.high)} · ${s.count} comp${s.count === 1 ? "" : "s"}${s.thin ? " · thin data" : ""}${state.prefs.includeShipping ? " · incl. shipping" : ""}`)]
        : []),
    );
  }
  const priceText = [...btn.children].map((c) => c.textContent.trim()).filter(Boolean).join(". ");
  btn.setAttribute("aria-label", `${name}. ${priceText}. Open price details.`);
}

function pickStats(d) {
  const view = state.prefs.hideLots ? d.stats.noLots : d.stats.withLots;
  return state.prefs.includeShipping ? view.total : view.item;
}

function attachSwipe(node, onDelete) {
  let x0 = null, y0 = null, dx = 0, active = false;
  node.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("input")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = false;
  });
  node.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!active && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my)) { active = true; node.classList.add("dragging"); }
    if (!active) return;
    dx = Math.min(0, mx);
    node.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (x0 === null) return;
    node.classList.remove("dragging");
    if (active && dx < -Math.min(140, node.offsetWidth * 0.35)) {
      node.style.transform = "translateX(-100%)";
      setTimeout(onDelete, 150);
    } else {
      node.style.transform = "";
    }
    if (active) node.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
    x0 = null; active = false;
  };
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}

function removeItem(id) {
  const idx = state.scan.items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [item] = state.scan.items.splice(idx, 1);
  persist();
  renderList();
  if ($("detail").open) $("detail").close();
  toast(`Deleted ${item.title || "item"}.`, {
    label: "Undo",
    run: () => {
      state.scan.items.splice(Math.min(idx, state.scan.items.length), 0, item);
      const li = rows.get(item.id);
      if (li) li.querySelector(".result-inner").style.transform = "";
      persist();
      renderList();
    },
  });
}

function onEdit(id, artist, title) {
  const item = state.scan.items.find((i) => i.id === id);
  if (!item) return;
  artist = artist.trim();
  title = title.trim();
  if (artist === item.artist && title === item.title) return;
  item.artist = artist;
  item.title = title;
  item.titleFromListing = false;
  persist();
  queuePrice(item);
}

/* ---------- adding items ---------- */

function addItems(candidates) {
  const fresh = newOnly(state.scan.items, candidates);
  for (const c of fresh) {
    const item = {
      id: crypto.randomUUID(),
      artist: c.artist || "",
      title: c.title || "",
      year: c.year ?? null,
      confidence: c.confidence ?? 1,
      collectible: !!c.collectible,
      why: c.why ?? null,
      upc: c.upc ?? null,
      origin: c.origin,
      price: { status: "idle" },
    };
    state.scan.items.unshift(item);
    queuePrice(item);
  }
  persist();
  renderList();
  return fresh.length;
}

/* ---------- photos ---------- */

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || f.type === "");
  if (!files.length) return;
  if (files.length > MAX_PHOTOS) toast(`Only the first ${MAX_PHOTOS} photos are used.`);
  const batch = files.slice(0, MAX_PHOTOS);
  state.pendingPhotos += batch.length;
  renderStatus();
  await Promise.all(
    batch.map(async (file) => {
      let blob;
      try {
        blob = await downscale(file);
      } catch {
        toast("Could not read one photo. Try again.");
        state.pendingPhotos--;
        renderStatus();
        return;
      }
      await identifyBlob(blob, null);
      state.pendingPhotos--;
      renderStatus();
    }),
  );
}

async function identifyBlob(blob, queueId) {
  if (!navigator.onLine) return queuePhoto(blob, queueId);
  try {
    const res = await api.identify(await blobToBase64(blob));
    const added = addItems(res.cds.map((c) => ({ ...c, origin: "photo" })));
    state.scan.unreadable += res.unreadable || 0;
    persist();
    if (queueId) await db.dequeuePhoto(queueId);
    if (!res.cds.length) toast("No readable CDs in that photo. Try closer, with less glare.");
    else if (!added) toast("Those CDs are already in this scan.");
  } catch (e) {
    if (handleAuthError(e)) return;
    if (e.offline) return queuePhoto(blob, queueId);
    toast(e.message || "Could not read that photo.");
    // Permanent errors: drop from the queue so it doesn't retry forever.
    if (queueId && e.status && e.status !== 429 && e.status < 500) await db.dequeuePhoto(queueId);
  }
}

async function queuePhoto(blob, queueId) {
  if (!queueId) await db.enqueuePhoto({ id: crypto.randomUUID(), scanId: state.scan.id, blob, createdAt: Date.now() });
  await refreshQueueCount();
}

async function refreshQueueCount() {
  state.queuedPhotos = (await db.listQueue().catch(() => [])).length;
  renderStatus();
}

let draining = false;
async function drainQueue() {
  if (draining || !navigator.onLine) return;
  draining = true;
  try {
    // Queued photos are added to the scan that is open when signal returns.
    for (const q of await db.listQueue()) {
      if (!navigator.onLine) break;
      await identifyBlob(q.blob, q.id);
    }
  } finally {
    draining = false;
    await refreshQueueCount();
    renderList();
  }
}

/* ---------- prices ---------- */

const priceQueue = [];
let priceRunning = 0;

function queuePrice(item) {
  item._req = (item._req || 0) + 1;
  if (!item.artist && !item.title && !item.upc) {
    item.price = { status: "error", error: "Add an artist and title." };
    return updateRow(item);
  }
  item.price = { status: navigator.onLine ? "loading" : "queued" };
  updateRow(item);
  if (!navigator.onLine) return persist();
  priceQueue.push({ item, req: item._req });
  pumpPrices();
}

function pumpPrices() {
  while (priceRunning < PRICE_CONCURRENCY && priceQueue.length) {
    const job = priceQueue.shift();
    priceRunning++;
    runPrice(job).finally(() => { priceRunning--; pumpPrices(); });
  }
}

async function runPrice({ item, req }) {
  try {
    const data = await api.prices({ artist: item.artist, title: item.title, gtin: item.upc });
    if (item._req !== req) return; // edited since; a newer request is in flight
    item.price = { status: "ok", data };
    if (item.origin === "barcode" && !item.title && data.comps.length) {
      item.title = cleanListingTitle(data.comps[0].title);
      item.titleFromListing = true;
    }
    state.soldAvailable = data.soldDataAvailable;
  } catch (e) {
    if (item._req !== req) return;
    if (handleAuthError(e)) return;
    item.price = e.offline ? { status: "queued" } : { status: "error", error: e.message };
  }
  persist();
  updateRow(item);
  if ($("detail").open && $("detail").dataset.id === item.id) openDetail(item.id);
}

function repriceStale() {
  for (const item of state.scan.items) {
    if (item.price?.status !== "ok") queuePrice(item);
  }
}

/* ---------- detail sheet ---------- */

function openDetail(id) {
  const item = state.scan.items.find((i) => i.id === id);
  if (!item) return;
  const dlg = $("detail");
  dlg.dataset.id = id;
  $("detail-title").textContent = item.title || (item.upc ? `UPC ${item.upc}` : "Unknown title");
  $("detail-sub").textContent = [item.artist, item.year].filter(Boolean).join(" · ");

  const body = [];
  const p = item.price || {};
  const d = p.status === "ok" ? p.data : null;
  const soldUrl = d?.soldSearchUrl || soldSearchUrlFor(item);

  if (d) {
    const kind = sourceClass(d.source);
    body.push(el("p", {}, el("span", { class: `pill ${kind}` }, d.sourceLabel)));
    if (d.source === "active") {
      body.push(el("p", { class: "warn" }, "These are asking prices from items still for sale, not what CDs sold for. Check eBay sold listings before you price."));
    }
    const s = pickStats(d);
    if (d.source !== "none") {
      body.push(
        el("div", { class: "toggles" },
          el("label", {}, el("input", { type: "checkbox", checked: state.prefs.hideLots, onchange: (e) => setPref("hideLots", e.target.checked, id) }), "Hide lots / bundles"),
          el("label", {}, el("input", { type: "checkbox", checked: state.prefs.includeShipping, onchange: (e) => setPref("includeShipping", e.target.checked, id) }), "Include shipping"),
        ),
      );
      body.push(
        el("div", { class: `stats ${kind}-tint` },
          stat(money(s.median), d.source === "sold" ? "Median sold" : "Median asking"),
          stat(money(s.low), "Low"),
          stat(money(s.high), "High"),
          stat(String(s.count), "Comps"),
          ...(d.source === "sold" && s.dateFrom ? [stat(`${shortDate(s.dateFrom)} – ${shortDate(s.dateTo)}`, "Sold between")] : []),
        ),
      );
      if (s.thin) body.push(el("p", { class: "warn" }, `Thin data: only ${s.count} comp${s.count === 1 ? "" : "s"}. Check eBay before trusting this.`));
    }
    for (const n of d.notes || []) body.push(el("p", { class: "muted" }, n));
    if (d.fetchedAt) body.push(el("p", { class: "muted small" }, `Checked ${new Date(d.fetchedAt).toLocaleString()}${d.cached ? " (cached)" : ""}`));
  } else if (p.status === "error") {
    body.push(el("p", { class: "error" }, p.error || "Price check failed."), el("button", { type: "button", class: "btn", onclick: () => { queuePrice(item); dlg.close(); } }, "Try again"));
  } else if (p.status === "queued") {
    body.push(el("p", { class: "muted" }, "Prices will be checked when you're back online."));
  } else {
    body.push(el("p", { class: "muted" }, el("span", { class: "spinner", "aria-hidden": "true" }), " Checking eBay…"));
  }

  if (soldUrl) body.push(el("button", { type: "button", class: "primary", onclick: () => window.open(soldUrl, "_blank", "noopener") }, "Open eBay sold listings"));

  if (d && d.comps.length) {
    const comps = state.prefs.hideLots ? d.comps.filter((c) => !c.isLot) : d.comps;
    body.push(el("h3", {}, d.source === "sold" ? "Sold listings" : "Active listings (asking)"));
    body.push(el("ul", { class: "comps" }, ...comps.map((c) => compRow(c, d.source))));
    const hidden = d.comps.length - comps.length;
    if (hidden) body.push(el("p", { class: "muted small" }, `${hidden} lot/bundle listing${hidden > 1 ? "s" : ""} hidden.`));
  }

  body.push(el("button", { type: "button", class: "btn danger", onclick: () => removeItem(id) }, "Delete from scan"));
  $("detail-body").replaceChildren(el("div", { class: "stack" }, ...body));
  if (!dlg.open) dlg.showModal();
}

function stat(value, label) {
  return el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label));
}

function compRow(c, source) {
  const total = c.shipping !== null ? c.price + c.shipping : null;
  const ship = c.shipping === null ? "shipping unknown" : c.shipping === 0 ? "free shipping" : `+ ${money(c.shipping)} ship`;
  const href = safeUrl(c.url);
  const inner = [
    c.imageUrl && safeUrl(c.imageUrl)
      ? el("img", { src: safeUrl(c.imageUrl), alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("div", { class: "noimg", "aria-hidden": "true" }),
    el("div", {},
      el("div", { class: "t" }, c.title),
      el("div", {}, el("span", { class: "p" }, money(c.price)), ` ${ship}`, ...(state.prefs.includeShipping && total !== null ? [` = ${money(total)}`] : [])),
      el("div", { class: "muted small" }, [source === "sold" && c.date ? `Sold ${shortDate(c.date)}` : "Still for sale", c.condition].filter(Boolean).join(" · ")),
      ...(c.isLot ? [el("div", { class: "lot" }, `Looks like a lot (${c.lotTerms.join(", ")})`)] : []),
    ),
  ];
  return el("li", {}, href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, ...inner) : el("a", {}, ...inner));
}

function setPref(key, value, id) {
  state.prefs[key] = value;
  savePrefs();
  for (const item of state.scan.items) updateRow(item);
  openDetail(id);
}

function soldSearchUrlFor(item) {
  const q = [item.artist && !/^various/i.test(item.artist) ? item.artist : "", item.title, "CD"].filter(Boolean).join(" ").trim();
  const query = item.title || item.artist ? q : item.upc;
  return query ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13` : null;
}

/* ---------- barcode ---------- */

let stopScanner = null;
async function openScanner() {
  const overlay = $("scanner");
  overlay.hidden = false;
  $("scanner-msg").textContent = "Point at the barcode on the back of the case.";
  $("scanner-done").focus();
  let count = 0;
  try {
    stopScanner = await startScanner($("scanner-video"), (code) => {
      const added = addItems([{ upc: code, origin: "barcode", confidence: 1 }]);
      count += added;
      navigator.vibrate?.(60);
      $("scanner-msg").textContent = added ? `Added ${code}. ${count} scanned. Keep going or tap Done.` : `${code} is already in this scan.`;
    });
  } catch (e) {
    $("scanner-msg").textContent =
      e?.name === "NotAllowedError" ? "Camera blocked. Allow camera access for this site in Settings > Safari." : e?.message || "Could not start the camera.";
  }
}
function closeScanner() {
  stopScanner?.();
  stopScanner = null;
  $("scanner").hidden = true;
  $("btn-barcode").focus();
}

/* ---------- export ---------- */

async function exportCsv(scan) {
  if (!scan.items.length) return toast("Nothing to export yet.");
  const name = `cd-scan-${scan.createdAt.slice(0, 16).replace(/[:T]/g, "-")}.csv`;
  const file = new File([toCsv(scan.items, state.prefs)], name, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  const a = el("a", { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- history & settings ---------- */

async function renderHistory() {
  const scans = (await db.listScans().catch(() => [])).filter((s) => s.items.length || s.id === state.scan.id);
  $("history-empty").hidden = scans.length > 0;
  $("history").replaceChildren(
    ...scans.map((s) => {
      const priced = s.items.filter((i) => i.price?.status === "ok").length;
      const isCurrent = s.id === state.scan.id;
      return el("li", {},
        el("div", {}, el("b", {}, new Date(s.createdAt).toLocaleString()), isCurrent ? el("span", { class: "muted" }, " · current") : ""),
        el("div", { class: "muted small" }, `${s.items.length} CD${s.items.length === 1 ? "" : "s"} · ${priced} priced`),
        el("div", { class: "row" },
          ...(isCurrent ? [] : [el("button", { type: "button", class: "btn small", onclick: () => openScan(s.id) }, "Open")]),
          el("button", { type: "button", class: "btn small", onclick: () => exportCsv(s) }, "Export CSV"),
          el("button", { type: "button", class: "btn small danger", "aria-label": `Delete scan from ${new Date(s.createdAt).toLocaleString()}`, onclick: () => deleteSavedScan(s) }, "Delete"),
        ),
      );
    }),
  );
}

async function openScan(id) {
  const s = await db.getScan(id);
  if (!s) return;
  state.scan = s;
  lsSet(CURRENT_KEY, s.id);
  rows.forEach((li) => li.remove());
  rows.clear();
  renderList();
  renderStatus();
  show("scan");
  repriceStale();
}

async function deleteSavedScan(s) {
  if (!confirm("Delete this saved scan?")) return;
  await db.deleteScan(s.id);
  if (s.id === state.scan.id) startNewScan();
  renderHistory();
}

function startNewScan() {
  state.scan = newScan();
  lsSet(CURRENT_KEY, state.scan.id);
  rows.forEach((li) => li.remove());
  rows.clear();
  renderList();
  renderStatus();
}

async function renderSettings() {
  const p = $("settings-sold");
  p.textContent = "Checking…";
  try {
    const r = await api.ping();
    p.textContent = r.soldDataAvailable
      ? "Sold prices: ✅ available (eBay Marketplace Insights)"
      : "Sold prices: ❌ not approved yet. Showing asking prices from active listings.";
  } catch (e) {
    if (handleAuthError(e)) return;
    p.textContent = e.offline ? "Offline." : e.message;
  }
}

/* ---------- boot ---------- */

async function boot() {
  $("input-camera").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  $("input-library").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  $("btn-barcode").addEventListener("click", openScanner);
  $("scanner-done").addEventListener("click", closeScanner);
  $("btn-export").addEventListener("click", () => exportCsv(state.scan));
  $("btn-new").addEventListener("click", () => {
    if (state.scan.items.length) toast("Scan saved to History.");
    startNewScan();
  });
  $("nav-scan").addEventListener("click", () => show("scan"));
  $("nav-history").addEventListener("click", () => show("history"));
  $("nav-settings").addEventListener("click", () => show("settings"));
  $("detail-close").addEventListener("click", () => $("detail").close());
  $("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });
  $("btn-reset-pass").addEventListener("click", () => { api.setPasscode(null); show("setup"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("scanner").hidden) closeScanner(); });

  $("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("setup-pass").value.trim();
    $("setup-error").textContent = "";
    try {
      await api.ping(pass);
      api.setPasscode(pass);
      $("setup-pass").value = "";
      show("scan");
      repriceStale();
      drainQueue();
    } catch (err) {
      $("setup-error").textContent = err.status === 401 ? "Wrong passcode." : err.offline ? "No connection. Try again with signal." : err.message;
    }
  });

  window.addEventListener("online", () => { renderNet(); drainQueue(); repriceStale(); });
  window.addEventListener("offline", renderNet);
  renderNet();

  const currentId = lsGet(CURRENT_KEY);
  state.scan = (currentId && (await db.getScan(currentId).catch(() => null))) || newScan();
  lsSet(CURRENT_KEY, state.scan.id);
  renderList();
  await refreshQueueCount();

  if (!api.getPasscode()) {
    show("setup");
  } else {
    show("scan");
    repriceStale();
    drainQueue();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
