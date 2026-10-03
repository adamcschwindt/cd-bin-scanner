// In-memory limits and cache. The service runs with max-instances=1, so one
// process sees all traffic. State resets on cold start, which only ever
// loosens limits for the rest of that day (acceptable for this scale).

function dayKey(now: number): string {
  // Reset at midnight US Eastern-ish (UTC-5); exactness doesn't matter.
  return new Date(now - 5 * 3600_000).toISOString().slice(0, 10);
}

export interface LimitConfig {
  perDevicePerDay: number;
  perDevicePerMinute: number;
  globalPerDay: number;
}

export type LimitVerdict = { ok: true } | { ok: false; reason: "device_minute" | "device_day" | "global_day" };

export class RateLimiter {
  private cfg: LimitConfig;
  private now: () => number;
  private day = "";
  private deviceDay = new Map<string, number>();
  private deviceMinute = new Map<string, number[]>();
  private globalDay = 0;

  constructor(cfg: LimitConfig, now: () => number = Date.now) {
    this.cfg = cfg;
    this.now = now;
  }

  check(deviceId: string): LimitVerdict {
    const t = this.now();
    const d = dayKey(t);
    if (d !== this.day) {
      this.day = d;
      this.deviceDay.clear();
      this.globalDay = 0;
    }
    const recent = (this.deviceMinute.get(deviceId) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.cfg.perDevicePerMinute) return { ok: false, reason: "device_minute" };
    if ((this.deviceDay.get(deviceId) ?? 0) >= this.cfg.perDevicePerDay) return { ok: false, reason: "device_day" };
    if (this.globalDay >= this.cfg.globalPerDay) return { ok: false, reason: "global_day" };
    recent.push(t);
    this.deviceMinute.set(deviceId, recent);
    this.deviceDay.set(deviceId, (this.deviceDay.get(deviceId) ?? 0) + 1);
    this.globalDay += 1;
    return { ok: true };
  }
}

export class TtlCache<V> {
  private ttlMs: number;
  private max: number;
  private map = new Map<string, { v: V; exp: number }>();

  constructor(ttlMs: number, max = 5000) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }

  set(k: string, v: V): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }
}
