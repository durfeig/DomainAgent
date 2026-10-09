import type { CostTracker } from "../../core/cost";
import type { ComparableSale, KeywordStats } from "../../core/types";
import { hashUnit } from "../../core/util";
import type { CompsResult, MarketDataProvider } from "./types";

/** Synthetic market data for offline runs. Every row is flagged mock=true / source "mock". */
const LIQUID = new Set(["agent", "ai", "pay", "voice", "trust", "id", "secure", "data", "cloud", "bot", "chat", "auth", "check", "verify", "commerce", "shop", "health", "legal", "robot", "code", "key", "pass", "proof", "guard", "receptionist", "call", "context", "identity", "payments", "checkout"]);

export class MockMarket implements MarketDataProvider {
  readonly name = "mock";
  readonly mock = true;

  async getComps(domain: string, parts: string[], costs: CostTracker): Promise<CompsResult> {
    costs.call("mock", "comps", 1, 0);
    const liquid = parts.filter((p) => LIQUID.has(p)).length;
    const n = Math.floor(hashUnit(`ncomps:${domain}`) * (liquid * 6));
    const tld = domain.split(".").slice(1).join(".");
    const comps: ComparableSale[] = Array.from({ length: n }, (_, i) => {
      const u = hashUnit(`comp:${domain}:${i}`);
      const price = Math.round(Math.exp(Math.log(1000) + u * Math.log(25))); // $1k–$25k (NameBio comps floor is $1k)
      const word = parts[i % Math.max(1, parts.length)] ?? "name";
      const year = 2021 + Math.floor(hashUnit(`y:${domain}:${i}`) * 5);
      return {
        domain: `${word}${["hub", "ly", "base", "labs", "hq", "kit"][i % 6]}.${i % 3 === 0 ? tld : "com"}`,
        price,
        currency: "USD",
        date: `${year}-0${1 + (i % 9)}-15`,
        venue: ["Afternic", "Sedo", "GoDaddy", "Atom"][i % 4],
        source: "mock",
        source_url: null,
      };
    });
    return { comps, credits_used: 0, credits_remaining: null, notes: ["MOCK comps — synthetic"], error: null };
  }

  mockKeywordStats(keyword: string): KeywordStats | null {
    if (!LIQUID.has(keyword) && hashUnit(`kw:${keyword}`) > 0.4) return null;
    const count = Math.floor(5 + hashUnit(`kwc:${keyword}`) * (LIQUID.has(keyword) ? 400 : 40));
    const median = Math.round(800 + hashUnit(`kwm:${keyword}`) * 3000);
    return {
      keyword,
      source: "mock",
      as_of: null,
      sales_count: count,
      avg_price: Math.round(median * 1.6),
      median_price: median,
      max_price: median * 40,
      mock: true,
    };
  }
}
