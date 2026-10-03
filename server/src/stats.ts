import type { Comp, Stats } from "./types.ts";

export const THIN_DATA_THRESHOLD = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 100) / 100;
}

/** includeShipping: unknown shipping counts as 0 for the total view. */
export function computeStats(comps: Comp[], opts: { excludeLots: boolean; includeShipping: boolean }): Stats {
  const used = opts.excludeLots ? comps.filter((c) => !c.isLot) : comps;
  const values = used
    .map((c) => (opts.includeShipping ? c.price + (c.shipping ?? 0) : c.price))
    .filter((v) => Number.isFinite(v) && v > 0);
  const dates = used.map((c) => c.date).filter((d): d is string => !!d).sort();
  return {
    count: values.length,
    median: median(values),
    low: values.length ? Math.min(...values) : null,
    high: values.length ? Math.max(...values) : null,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    thin: values.length < THIN_DATA_THRESHOLD,
  };
}

/** All four views so the page can flip toggles without another request. */
export function allStats(comps: Comp[]) {
  return {
    noLots: {
      item: computeStats(comps, { excludeLots: true, includeShipping: false }),
      total: computeStats(comps, { excludeLots: true, includeShipping: true }),
    },
    withLots: {
      item: computeStats(comps, { excludeLots: false, includeShipping: false }),
      total: computeStats(comps, { excludeLots: false, includeShipping: true }),
    },
  };
}
