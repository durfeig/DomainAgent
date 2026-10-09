import type { Market } from "../core/types";

/**
 * Vertical contract — how future asset types plug into Arbitrage OS.
 *
 *   Scout → Underwriter → Builder → Publisher → Portfolio Manager
 *
 * Domain arbitrage (src/pipeline/*) is vertical #1 and implements Scout + Underwriter only.
 * Shared, market-agnostic pieces: trend signals & concepts, opportunities/evaluations/evidence/decisions
 * tables, cost tracking, budget guard, digest, dashboard. A new vertical (API arbitrage, Etsy digital
 * products, Adobe Stock, KDP, micro-SaaS, datasets) provides its own candidate generator, availability /
 * feasibility check, market-data enrichment and underwriting fact sheet, and writes Opportunities with
 * its own `market` value. Builder/Publisher/PortfolioManager stay unimplemented until Phase 2+.
 */
export interface VerticalCandidate {
  market: Market;
  identifier: string; // unique within the market (e.g. "agentpassport.com", "etsy:<slug>")
  concept_slug: string;
  attributes: Record<string, unknown>;
}

export interface Vertical<C extends VerticalCandidate = VerticalCandidate> {
  readonly market: Market;
  /** Concepts -> many candidates (cheap, deterministic where possible). */
  generate(conceptSlugs: string[]): Promise<C[]>;
  /** Cheap filters before any paid call; returns reasons for rejected ones. */
  prefilter(cands: C[]): { passed: C[]; rejected: { identifier: string; reasons: string[] }[] };
  /** Can we acquire it, and at what cost? (registrar, marketplace fees, production cost...) */
  feasibility(cands: C[]): Promise<(C & { acquisition_cost: number | null; recurring_cost: number | null })[]>;
  /** Verifiable market data (FACTS only; null when unavailable). */
  enrich(cands: C[]): Promise<(C & { market_data: unknown })[]>;
  /** Fact sheet + scoring + EV, returns an evaluation per candidate. */
  underwrite(cands: C[]): Promise<unknown[]>;
}

/** Phase 2+ stages (not implemented in the Analyst MVP). */
export interface Builder<C> { build(opportunityId: string, c: C): Promise<never> }
export interface Publisher<C> { publish(opportunityId: string, c: C): Promise<never> }
export interface PortfolioManager { review(): Promise<never> }
