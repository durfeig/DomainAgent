import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";

export interface FetchOptions {
  lookbackDays: number;
  now: Date;
}

/** A programmatic trend source. Implementations must return verifiable URLs — never synthesized evidence. */
export interface TrendSource {
  readonly name: string;
  readonly mock: boolean;
  fetch(opts: FetchOptions, costs: CostTracker, log: Logger): Promise<RawSignal[]>;
}
