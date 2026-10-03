export type PriceKind = "sold" | "active";

export interface Comp {
  title: string;
  price: number;
  shipping: number | null; // null = unknown, 0 = free
  currency: string;
  date: string | null; // sold date for "sold", null for "active"
  condition: string | null;
  imageUrl: string | null;
  url: string | null;
  isLot: boolean;
  lotTerms: string[];
}

export interface Stats {
  count: number;
  median: number | null;
  low: number | null;
  high: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  thin: boolean;
}

export interface PriceRequest {
  q: string | null;
  gtin: string | null;
}

export interface PriceProvider {
  id: string;
  kind: PriceKind;
  label: string;
  /** Throws ProviderUnavailableError when this credential set can't use it. */
  search(req: PriceRequest): Promise<Comp[]>;
}

export class ProviderUnavailableError extends Error {
  providerId: string;
  constructor(providerId: string, message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
  }
}
