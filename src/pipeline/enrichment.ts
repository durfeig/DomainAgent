import type { MarketDataProvider } from "../adapters/market";
import type { TableStore } from "../adapters/store";
import type { CostTracker } from "../core/cost";
import type { Logger } from "../core/logger";
import type { ComparableSale, CompsSummary, DomainCandidate, KeywordStats, MarketData } from "../core/types";
import { mapLimit, quantile } from "../core/util";

/**
 * Market data enrichment. Two sources:
 *  1. Keyword sale statistics from the `market_keyword_stats` table (imported from NameBio's
 *     keyword stats download via `npm run import:namebio-keywords`). Missing keyword -> absent.
 *  2. Comparable sales from the market provider (NameBio Comps API). Unavailable -> null.
 * Nothing is ever estimated here: summaries are arithmetic over returned rows.
 */
export async function enrichStage<T extends DomainCandidate>(
  cands: T[],
  deps: { market: MarketDataProvider; store: TableStore; costs: CostTracker; log: Logger },
): Promise<(T & { market: MarketData })[]> {
  const { market, store, costs, log } = deps;
  const keywords = [...new Set(cands.flatMap((c) => c.parts))];
  const kwRows = keywords.length
    ? await store.select<KeywordStats & { id: string }>("market_keyword_stats", { in: { keyword: keywords } })
    : [];
  const kwMap = new Map<string, KeywordStats>(kwRows.map((r) => [r.keyword, r]));
  if (market.mock && market.mockKeywordStats) {
    for (const k of keywords) {
      if (kwMap.has(k)) continue;
      const s = market.mockKeywordStats(k);
      if (s) kwMap.set(k, s);
    }
  }

  return mapLimit(cands, 3, async (c) => {
    const res = await market.getComps(c.domain, c.parts, costs);
    if (res.error) log.warn("enrichment", "comps_error", { domain: c.domain, error: res.error });
    const comps = res.comps;
    const md: MarketData = {
      provider: market.name,
      mock: market.mock,
      keyword_stats: c.parts.map((p) => kwMap.get(p)).filter((k): k is KeywordStats => !!k),
      comps,
      comps_summary: comps && comps.length ? summarizeComps(comps, c.tld) : null,
      credits_used: res.credits_used,
      errors: res.error ? [res.error] : [],
    };
    return { ...c, market: md };
  });
}

export function summarizeComps(comps: ComparableSale[], tld: string, now = new Date()): CompsSummary {
  const prices = comps.map((c) => c.price).sort((a, b) => a - b);
  const cutoff = new Date(now.getTime() - 730 * 86400_000);
  const dates = comps.map((c) => c.date).filter((d): d is string => !!d).sort();
  return {
    count: comps.length,
    median: Math.round(quantile(prices, 0.5)),
    mean: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    p25: Math.round(quantile(prices, 0.25)),
    p75: Math.round(quantile(prices, 0.75)),
    min: prices[0],
    max: prices[prices.length - 1],
    same_tld_count: comps.filter((c) => c.domain.endsWith(`.${tld}`)).length,
    last_24m_count: comps.filter((c) => c.date && new Date(c.date) >= cutoff).length,
    most_recent_date: dates.length ? dates[dates.length - 1] : null,
  };
}
