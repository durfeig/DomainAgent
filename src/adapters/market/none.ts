import type { CostTracker } from "../../core/cost";
import type { CompsResult, MarketDataProvider } from "./types";

/** No market data source configured: every field is null. Underwriter confidence is capped accordingly. */
export class NoMarket implements MarketDataProvider {
  readonly name = "none";
  readonly mock = false;
  async getComps(_domain: string, _parts: string[], _costs: CostTracker): Promise<CompsResult> {
    return { comps: null, credits_used: 0, credits_remaining: null, notes: ["no market data provider configured"], error: null };
  }
}
