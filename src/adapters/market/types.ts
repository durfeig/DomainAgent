import type { CostTracker } from "../../core/cost";
import type { ComparableSale, KeywordStats } from "../../core/types";

export interface CompsResult {
  comps: ComparableSale[] | null; // null => unavailable (never invented)
  credits_used: number;
  credits_remaining: number | null;
  notes: string[];
  error: string | null;
}

export interface MarketDataProvider {
  readonly name: string;
  readonly mock: boolean;
  getComps(domain: string, parts: string[], costs: CostTracker): Promise<CompsResult>;
  /** Synthetic keyword stats (mock only). Real keyword stats come from the imported table. */
  mockKeywordStats?(keyword: string): KeywordStats | null;
}
