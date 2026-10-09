import type { Config } from "../config";
import type {
  Component,
  ComponentScores,
  Concept,
  DomainCandidate,
  ExpectedValue,
  Horizon,
  MarketData,
  Scenario,
  TrademarkRisk,
} from "../core/types";
import { clamp } from "../core/util";
import { brandabilityHeuristic, TLD_QUALITY } from "./prescore";
import { TRADEMARK_PENALTY } from "./trademark";

/** Scoring weights from the product spec (must sum to 1). */
export const WEIGHTS: ComponentScores = {
  demand_evidence: 0.25,
  historical_market: 0.2,
  buyer_universe: 0.15,
  brandability: 0.15,
  trend_momentum: 0.1,
  tld_quality: 0.1,
  capital_efficiency: 0.05,
};

/** Minimum registration years by TLD (.ai requires 2-year registrations). */
export const TLD_MIN_YEARS: Record<string, number> = { ai: 2 };

const AI_FIT = /\b(ai|agent|agents|llm|model|models|gpt|inference|prompt|context|autonomous|copilot|assistant|receptionist)\b/;

// ------------------------------------------------------------------ deterministic components

export function demandEvidence(concept: Pick<Concept, "sources" | "frequency">, engagement: number): number {
  const s = concept.sources.length;
  const base = s >= 4 ? 80 : s === 3 ? 68 : s === 2 ? 50 : 25;
  const eng = Math.min(12, 3 * Math.log10(1 + engagement));
  const freq = Math.min(8, concept.frequency);
  return Math.round(clamp(base + eng + freq));
}

export function historicalMarket(md: MarketData | null): number {
  if (!md) return 25;
  const kw = md.keyword_stats.filter((k) => k.sales_count !== null);
  let compsScore: number | null = null;
  if (md.comps_summary) {
    const c = md.comps_summary;
    const median = clamp((Math.log10(Math.max(1, c.median)) - 2.5) * 33, 0, 50);
    const depth = Math.min(30, 10 * Math.log2(1 + c.count));
    const recency = c.last_24m_count > 0 ? 10 : 0;
    const tld = c.count > 0 ? 10 * (c.same_tld_count / c.count) : 0;
    compsScore = median + depth + recency + tld;
  } else if (md.comps && md.comps.length === 0) {
    compsScore = 10; // the source answered: no comparable sales at all
  }
  let kwScore: number | null = null;
  if (kw.length) {
    const count = kw.reduce((s, k) => s + (k.sales_count ?? 0), 0);
    const medians = kw.map((k) => k.median_price).filter((m): m is number => m !== null);
    const med = medians.length ? Math.min(...medians) : 0;
    kwScore = Math.min(40, 8 * Math.log2(1 + count)) + clamp((Math.log10(Math.max(1, med)) - 2.5) * 30, 0, 40);
  }
  if (compsScore === null && kwScore === null) return 25; // unknown: neutral-pessimistic, confidence is capped separately
  if (compsScore !== null && kwScore !== null) return Math.round(clamp(0.7 * compsScore + 0.3 * kwScore));
  return Math.round(clamp(compsScore ?? (kwScore as number) * 0.8));
}

export function trendMomentum(concept: Pick<Concept, "momentum" | "durability">): number {
  const base = concept.momentum === null ? 40 : 40 + 20 * Math.log2(Math.max(0.1, concept.momentum));
  const dur = concept.durability === "DURABLE" ? 10 : concept.durability === "HYPE" ? -20 : 0;
  return Math.round(clamp(base + dur));
}

export function tldQuality(tld: string, conceptText: string): number {
  const q = TLD_QUALITY[tld] ?? 35;
  if (tld === "ai" && AI_FIT.test(conceptText)) return 85;
  return q;
}

export function capitalEfficiency(tld: string, reg: number | null, renew: number | null): number {
  if (reg === null) return 0;
  const minYears = TLD_MIN_YEARS[tld] ?? 1;
  const threeYear = reg * minYears + (renew ?? reg) * Math.max(0, 3 - minYears);
  return Math.round(clamp(100 - 30 * Math.log2(Math.max(1, threeYear / 35))));
}

export function buyerUniverseHeuristic(concept: Pick<Concept, "score">, c: Pick<DomainCandidate, "parts">): number {
  return Math.round(clamp(25 + concept.score * 0.5 - (c.parts.length > 2 ? 10 : 0)));
}

export function deterministicComponents(
  c: DomainCandidate,
  concept: Concept,
  md: MarketData | null,
  engagement: number,
  price: { reg: number | null; renew: number | null },
): ComponentScores {
  return {
    demand_evidence: demandEvidence(concept, engagement),
    historical_market: historicalMarket(md),
    buyer_universe: buyerUniverseHeuristic(concept, c),
    brandability: brandabilityHeuristic(c),
    trend_momentum: trendMomentum(concept),
    tld_quality: tldQuality(c.tld, `${concept.name} ${concept.keywords.join(" ")}`),
    capital_efficiency: capitalEfficiency(c.tld, price.reg, price.renew),
  };
}

/**
 * Merge LLM judgement with deterministic evidence. Capital preservation: for data-driven
 * components keep the MORE PESSIMISTIC value; judgement components use the LLM (brandability
 * averaged with the heuristic); TLD quality and capital efficiency are purely deterministic.
 */
export function mergeComponents(det: ComponentScores, llm: Partial<ComponentScores> | null): ComponentScores {
  if (!llm) return det;
  const pick = (k: Component) => llm[k] ?? det[k];
  return {
    demand_evidence: Math.min(det.demand_evidence, pick("demand_evidence")),
    historical_market: Math.min(det.historical_market, pick("historical_market")),
    trend_momentum: Math.min(det.trend_momentum, pick("trend_momentum")),
    buyer_universe: pick("buyer_universe"),
    brandability: Math.round((det.brandability + pick("brandability")) / 2),
    tld_quality: det.tld_quality,
    capital_efficiency: det.capital_efficiency,
  };
}

export function weightedScore(cs: ComponentScores): number {
  return Math.round((Object.keys(WEIGHTS) as Component[]).reduce((s, k) => s + cs[k] * WEIGHTS[k], 0) * 10) / 10;
}

export function finalScore(cs: ComponentScores, tm: TrademarkRisk): { weighted: number; penalty: number; final: number } {
  const weighted = weightedScore(cs);
  const penalty = TRADEMARK_PENALTY[tm];
  return { weighted, penalty, final: Math.round(clamp(weighted + penalty)) };
}

// ------------------------------------------------------------------ confidence cap (data coverage)

export function confidenceCap(
  args: { md: MarketData | null; liveAvailability: boolean; concept: Pick<Concept, "sources" | "momentum" | "durability"> },
  cfg: Pick<Config, "CONFIDENCE_CAP_NO_MARKET_DATA">,
): { cap: number; notes: string[] } {
  const notes: string[] = [];
  const hasComps = !!args.md?.comps_summary;
  const hasKw = (args.md?.keyword_stats.length ?? 0) > 0;
  let cap = 30;
  if (hasComps) cap += 20;
  else notes.push("no comparable sales");
  if (hasKw) cap += 10;
  else notes.push("no keyword sale stats");
  if (args.liveAvailability) cap += 10;
  else notes.push("availability not from a live registrar");
  if (args.concept.sources.length >= 2) cap += 10;
  if (args.concept.sources.length >= 3) cap += 5;
  else notes.push("fewer than 3 independent trend sources");
  if (args.concept.momentum !== null) cap += 10;
  else notes.push("momentum unknown (no history yet)");
  if (args.concept.durability === "DURABLE") cap += 5;
  if (!hasComps && !hasKw) {
    cap = Math.min(cap, cfg.CONFIDENCE_CAP_NO_MARKET_DATA);
    notes.push(`no market data at all: confidence capped at ${cfg.CONFIDENCE_CAP_NO_MARKET_DATA}`);
  }
  return { cap: Math.min(100, cap), notes };
}

// ------------------------------------------------------------------ retail estimate & EV

export function reconcileRetail(
  llm: { low: number; base: number; high: number; currency: string; basis: string } | null,
  md: MarketData | null,
): { low: number; base: number; high: number; currency: string; basis: string } | null {
  if (!llm) return null;
  const s = md?.comps_summary;
  if (!s) return { ...llm, basis: `ESTIMATE (no comparables): ${llm.basis}` };
  // Never above what comparables support (and comps are already biased upward by the $1k floor).
  const low = Math.min(llm.low, s.p25);
  const base = Math.max(low, Math.min(llm.base, s.median));
  const high = Math.max(base, Math.min(llm.high, s.max));
  return { low: Math.round(low), base: Math.round(base), high: Math.round(high), currency: "USD", basis: `ESTIMATE clamped to comparables (p25 ${s.p25}, median ${s.median}, max ${s.max}): ${llm.basis}` };
}

const HORIZONS: [Horizon, number][] = [
  ["12m", 1],
  ["24m", 2],
  ["36m", 3],
];

export function expectedValue(
  args: { tld: string; reg: number; renew: number; retail: { low: number; base: number; high: number }; score: number },
  cfg: Pick<Config, "SELL_THROUGH_ANNUAL_BASE" | "MARKETPLACE_FEE_PCT">,
): ExpectedValue {
  const base = cfg.SELL_THROUGH_ANNUAL_BASE;
  const quality = clamp((args.score - 50) / 25, 0.5, 3);
  const p: Record<Scenario, number> = {
    bear: base * 0.5,
    base: Math.min(0.5, base * quality),
    bull: Math.min(0.5, base * quality * 2.5),
  };
  const price: Record<Scenario, number> = { bear: args.retail.low, base: args.retail.base, bull: args.retail.high };
  const minYears = TLD_MIN_YEARS[args.tld] ?? 1;
  const scenarios = {} as ExpectedValue["scenarios"];
  for (const sc of ["bear", "base", "bull"] as Scenario[]) {
    scenarios[sc] = {} as ExpectedValue["scenarios"][Scenario];
    for (const [h, years] of HORIZONS) {
      const pSale = 1 - (1 - p[sc]) ** years;
      // Upfront: minimum registration term. Renewals only paid while still unsold.
      let expectedCost = args.reg * minYears;
      for (let y = minYears; y < years; y++) expectedCost += args.renew * (1 - p[sc]) ** y;
      const net = price[sc] * (1 - cfg.MARKETPLACE_FEE_PCT);
      scenarios[sc][h] = {
        p_sale: round4(pSale),
        sale_price: Math.round(price[sc]),
        net_proceeds_if_sold: Math.round(net),
        expected_cost: round2(expectedCost),
        ev: round2(pSale * net - expectedCost),
      };
    }
  }
  return {
    assumptions: {
      sell_through_annual: { bear: round4(p.bear), base: round4(p.base), bull: round4(p.bull) },
      marketplace_fee_pct: cfg.MARKETPLACE_FEE_PCT,
      registration_cost: args.reg,
      renewal_cost: args.renew,
      note:
        "ESTIMATE. Annual sell-through is an assumption (SELL_THROUGH_ANNUAL_BASE, scaled by score), not a measured fact; " +
        "sale prices come from the retail ESTIMATE; renewals are only counted while unsold. Low precision by design.",
    },
    scenarios,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ------------------------------------------------------------------ hard rules

export function recommendationRules(
  e: { final_score: number; confidence: number; trademark_risk: TrademarkRisk; ev: ExpectedValue | null; retail: unknown; verdict: string | null; registrable: boolean },
  cfg: Pick<Config, "MIN_SCORE" | "MIN_CONFIDENCE" | "REQUIRE_POSITIVE_EV">,
): string[] {
  const r: string[] = [];
  if (!e.registrable) r.push("not_registrable");
  if (e.final_score < cfg.MIN_SCORE) r.push(`score ${e.final_score} < ${cfg.MIN_SCORE}`);
  if (e.confidence < cfg.MIN_CONFIDENCE) r.push(`confidence ${e.confidence} < ${cfg.MIN_CONFIDENCE}`);
  if (e.trademark_risk === "HIGH") r.push("trademark HIGH");
  if (!e.retail) r.push("no retail estimate (insufficient evidence)");
  if (cfg.REQUIRE_POSITIVE_EV) {
    const ev = e.ev?.scenarios.base["36m"].ev;
    if (ev === undefined) r.push("EV unavailable");
    else if (ev <= 0) r.push(`base-case EV(36m) ${ev} <= 0`);
  }
  if (e.verdict && e.verdict !== "INVEST") r.push(`underwriter verdict ${e.verdict}`);
  return r;
}
