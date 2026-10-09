import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import {
  capitalEfficiency,
  confidenceCap,
  expectedValue,
  finalScore,
  mergeComponents,
  recommendationRules,
  reconcileRetail,
  WEIGHTS,
} from "../src/pipeline/scoring";
import type { ComponentScores, MarketData } from "../src/core/types";

const cfg = loadConfig({});
const all = (n: number): ComponentScores => ({
  demand_evidence: n, historical_market: n, buyer_universe: n, brandability: n, trend_momentum: n, tld_quality: n, capital_efficiency: n,
});

describe("scoring", () => {
  it("weights sum to 1", () => {
    expect(Object.values(WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
  });

  it("applies trademark penalties LOW 0 / MEDIUM -15 / HIGH -40", () => {
    expect(finalScore(all(80), "LOW").final).toBe(80);
    expect(finalScore(all(80), "MEDIUM").final).toBe(65);
    expect(finalScore(all(80), "HIGH").final).toBe(40);
  });

  it("keeps the more pessimistic value for data-driven components", () => {
    const det = all(50);
    const merged = mergeComponents(det, { ...all(90), tld_quality: 10 });
    expect(merged.demand_evidence).toBe(50);
    expect(merged.historical_market).toBe(50);
    expect(merged.trend_momentum).toBe(50);
    expect(merged.buyer_universe).toBe(90); // judgement: LLM
    expect(merged.brandability).toBe(70); // average
    expect(merged.tld_quality).toBe(50); // deterministic only
  });

  it("score and confidence are independent: score 91 / confidence 35 is NOT recommended", () => {
    const reasons = recommendationRules(
      { final_score: 91, confidence: 35, trademark_risk: "LOW", ev: null, retail: { low: 1, base: 2, high: 3 }, verdict: "INVEST", registrable: true },
      { ...cfg, REQUIRE_POSITIVE_EV: false },
    );
    expect(reasons.some((r) => r.startsWith("confidence"))).toBe(true);
  });

  it("rejects score < 75, trademark HIGH, and non-positive EV", () => {
    const ev = expectedValue({ tld: "com", reg: 10, renew: 10, retail: { low: 50, base: 100, high: 200 }, score: 80 }, cfg);
    const r = recommendationRules(
      { final_score: 74, confidence: 90, trademark_risk: "HIGH", ev, retail: {}, verdict: "INVEST", registrable: true },
      cfg,
    );
    expect(r.join("|")).toMatch(/score 74 < 75/);
    expect(r.join("|")).toMatch(/trademark HIGH/);
    expect(r.join("|")).toMatch(/EV/);
  });

  it("caps confidence when there is no market data", () => {
    const md: MarketData = { provider: "none", mock: false, keyword_stats: [], comps: null, comps_summary: null, credits_used: 0, errors: [] };
    const { cap } = confidenceCap({ md, liveAvailability: true, concept: { sources: ["a", "b", "c", "d"], momentum: 2, durability: "DURABLE" } }, cfg);
    expect(cap).toBeLessThanOrEqual(cfg.CONFIDENCE_CAP_NO_MARKET_DATA);
  });

  it("EV math: probability compounds, renewals only while unsold, .ai pays 2 years upfront", () => {
    const ev = expectedValue({ tld: "com", reg: 10, renew: 10, retail: { low: 1000, base: 2000, high: 4000 }, score: 75 }, { SELL_THROUGH_ANNUAL_BASE: 0.01, MARKETPLACE_FEE_PCT: 0.2 });
    const base12 = ev.scenarios.base["12m"];
    expect(base12.p_sale).toBeCloseTo(0.01, 6);
    expect(base12.expected_cost).toBe(10);
    expect(base12.ev).toBeCloseTo(0.01 * 1600 - 10, 2);
    const base36 = ev.scenarios.base["36m"];
    expect(base36.p_sale).toBeCloseTo(1 - 0.99 ** 3, 4);
    expect(base36.expected_cost).toBeCloseTo(10 + 10 * 0.99 + 10 * 0.99 ** 2, 2);
    const ai = expectedValue({ tld: "ai", reg: 80, renew: 80, retail: { low: 1000, base: 2000, high: 4000 }, score: 75 }, { SELL_THROUGH_ANNUAL_BASE: 0.01, MARKETPLACE_FEE_PCT: 0.2 });
    expect(ai.scenarios.base["12m"].expected_cost).toBe(160);
    expect(ev.scenarios.bear["36m"].ev).toBeLessThan(ev.scenarios.bull["36m"].ev);
  });

  it("retail estimate never exceeds what comparables support", () => {
    const md = { comps_summary: { count: 5, median: 2000, mean: 2500, p25: 1200, p75: 3000, max: 5000, min: 1000, same_tld_count: 3, last_24m_count: 2, most_recent_date: "2026-01-01" } } as MarketData;
    const r = reconcileRetail({ low: 5000, base: 20000, high: 90000, currency: "USD", basis: "x" }, md)!;
    expect(r.low).toBeLessThanOrEqual(1200);
    expect(r.base).toBeLessThanOrEqual(2000);
    expect(r.high).toBeLessThanOrEqual(5000);
    expect(reconcileRetail(null, md)).toBeNull();
  });

  it("capital efficiency punishes expensive TLDs", () => {
    expect(capitalEfficiency("com", 10.5, 10.5)).toBe(100);
    expect(capitalEfficiency("ai", 80, 80)).toBeLessThan(30);
    expect(capitalEfficiency("com", null, null)).toBe(0);
  });
});
