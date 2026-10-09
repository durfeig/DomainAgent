import type { Config } from "../../config";
import { MockMarket } from "./mock";
import { NameBioMarket } from "./namebio";
import { NoMarket } from "./none";
import type { MarketDataProvider } from "./types";

export * from "./types";

export function createMarket(cfg: Config): MarketDataProvider {
  switch (cfg.MARKET_PROVIDER) {
    case "namebio":
      if (!cfg.NAMEBIO_EMAIL || !cfg.NAMEBIO_API_KEY) throw new Error("MARKET_PROVIDER=namebio requires NAMEBIO_EMAIL and NAMEBIO_API_KEY");
      return new NameBioMarket(cfg.NAMEBIO_EMAIL, cfg.NAMEBIO_API_KEY, {
        maxCallsPerRun: cfg.NAMEBIO_MAX_COMPS_CALLS_PER_RUN,
        monthsOld: cfg.NAMEBIO_COMPS_MONTHS_OLD,
        usdPerCredit: cfg.NAMEBIO_USD_PER_CREDIT,
      });
    case "none":
      return new NoMarket();
    default:
      return new MockMarket();
  }
}
