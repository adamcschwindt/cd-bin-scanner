import { API_BASE } from "../config.js";

const PASS_KEY = "cdbin.passcode";
const DEVICE_KEY = "cdbin.device";

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

export const getPasscode = () => lsGet(PASS_KEY);
export const setPasscode = (p) => lsSet(PASS_KEY, p);

let memDevice = null;
export function deviceId() {
  let id = lsGet(DEVICE_KEY) || memDevice;
  if (!id) {
    id = crypto.randomUUID();
    lsSet(DEVICE_KEY, id);
  }
  memDevice = id;
  return id;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = "", offline = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.offline = offline;
  }
}

async function request(path, { method = "GET", body, passcode } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "X-App-Passcode": passcode ?? getPasscode() ?? "",
        "X-Device-Id": deviceId(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("No connection.", { offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || `Error ${res.status}`, { status: res.status, code: data.error });
  return data;
}

export const ping = (passcode) => request("/v1/ping", { passcode });
export const identify = (image, mediaType = "image/jpeg") => request("/v1/identify", { method: "POST", body: { image, mediaType } });

export function prices({ artist, title, gtin }) {
  const p = new URLSearchParams();
  if (artist) p.set("artist", artist);
  if (title) p.set("title", title);
  if (gtin) p.set("gtin", gtin);
  return request(`/v1/prices?${p}`);
}
