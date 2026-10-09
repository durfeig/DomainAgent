/**
 * Core domain model for Arbitrage OS.
 *
 * The model is market-agnostic: an Opportunity points to an Asset of a given `market`
 * ("domain" today; "api", "etsy_product", "stock_asset", ... later). Domain-specific
 * fields live in `Asset.attributes` and in the domain vertical, never in the core tables.
 */

export type Market = "domain" | "api" | "etsy_product" | "stock_asset" | "kdp" | "micro_saas" | "dataset";

export type EvidenceKind = "FACT" | "ESTIMATE" | "INFERENCE";
export type TrademarkRisk = "LOW" | "MEDIUM" | "HIGH";
export type Durability = "DURABLE" | "HYPE" | "UNCLEAR";
export type OpportunityStatus = "NEW" | "APPROVED" | "REJECTED" | "WATCH" | "BOUGHT" | "ARCHIVED";
export type DecisionAction = "APPROVE" | "REJECT" | "WATCH" | "BUY";
export type Actor = "human" | "agent";

export interface RawSignal {
  source: string; // hackernews | github | reddit | producthunt | rss:<host> | mock
  source_id: string;
  source_url: string;
  title: string;
  text: string | null;
  published_at: string; // ISO
  engagement: { points?: number; comments?: number; stars?: number; votes?: number };
  tags: string[];
  mock: boolean;
}

export interface TrendSignal extends RawSignal {
  id: string;
  run_id: string;
  fetched_at: string;
  hash: string;
}

export interface Phrase {
  phrase: string;
  doc_freq: number;
  sources: string[];
  weight: number;
  signal_ids: string[];
  recent_freq: number;
  baseline_freq: number | null; // null when no history yet
  momentum: number | null;
}

export interface Concept {
  id: string;
  slug: string;
  name: string;
  description: string;
  commercial_rationale: string;
  keywords: string[];
  durability: Durability;
  durability_reason: string;
  frequency: number; // distinct supporting signals
  sources: string[];
  momentum: number | null; // ratio recent vs baseline; null = unknown (no history)
  confidence: number; // 0-100
  evidence_signal_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  score: number; // concept strength 0-100 (deterministic)
}

export type GenerationStrategy =
  | "exact"
  | "semantic"
  | "noun_noun"
  | "verb_noun"
  | "prefix"
  | "suffix"
  | "brandable";

export interface DomainCandidate {
  domain: string; // sld.tld
  sld: string;
  tld: string;
  parts: string[];
  strategy: GenerationStrategy;
  concept_slug: string;
  prescore?: number;
}

export interface FilterRejection {
  domain: string;
  reasons: string[];
}

export interface AvailabilityResult {
  domain: string;
  provider: string;
  sandbox: boolean;
  mock: boolean;
  registrable: boolean;
  reason: string | null;
  tier: string | null; // "standard" | "premium" | ... as returned by the registrar
  currency: string | null;
  registration_cost: number | null;
  renewal_cost: number | null;
  registrar: string;
  checked_at: string;
  raw?: unknown;
}

export interface ComparableSale {
  domain: string;
  price: number;
  currency: string;
  date: string | null;
  venue: string | null;
  source: string;
  source_url: string | null;
}

export interface KeywordStats {
  keyword: string;
  source: string;
  as_of: string | null;
  sales_count: number | null;
  avg_price: number | null;
  median_price: number | null;
  max_price: number | null;
  mock: boolean;
}

export interface CompsSummary {
  count: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  max: number;
  min: number;
  same_tld_count: number;
  last_24m_count: number;
  most_recent_date: string | null;
}

export interface MarketData {
  provider: string;
  mock: boolean;
  keyword_stats: KeywordStats[]; // only keywords with data; missing keywords are simply absent
  comps: ComparableSale[] | null; // null = not fetched / unavailable (never invented)
  comps_summary: CompsSummary | null;
  credits_used: number;
  errors: string[];
}

export interface FactItem {
  id: string; // F1, F2...
  kind: EvidenceKind; // facts sent to the LLM are FACT; derived arithmetic is FACT (derived)
  category: "availability" | "pricing" | "trend_signal" | "comparable_sale" | "keyword_stats" | "comps_summary" | "concept";
  claim: string;
  source: string;
  source_url: string | null;
  mock: boolean;
  value?: unknown;
}

export const COMPONENTS = [
  "demand_evidence",
  "historical_market",
  "buyer_universe",
  "brandability",
  "trend_momentum",
  "tld_quality",
  "capital_efficiency",
] as const;
export type Component = (typeof COMPONENTS)[number];
export type ComponentScores = Record<Component, number>;

export interface EVCell {
  p_sale: number;
  sale_price: number;
  net_proceeds_if_sold: number;
  expected_cost: number;
  ev: number;
}
export type Scenario = "bear" | "base" | "bull";
export type Horizon = "12m" | "24m" | "36m";
export interface ExpectedValue {
  assumptions: {
    sell_through_annual: Record<Scenario, number>;
    marketplace_fee_pct: number;
    registration_cost: number;
    renewal_cost: number;
    note: string;
  };
  scenarios: Record<Scenario, Record<Horizon, EVCell>>;
}

export interface Evaluation {
  id: string;
  opportunity_id: string;
  run_id: string;
  underwriter_version: string;
  model: string;
  components: ComponentScores;
  components_deterministic: Partial<ComponentScores>;
  components_llm: Partial<ComponentScores> | null;
  weighted_score: number;
  trademark_risk: TrademarkRisk;
  trademark_penalty: number;
  final_score: number;
  confidence: number;
  confidence_llm: number | null;
  confidence_cap: number;
  thesis: string;
  why_now: string;
  risks: { risk: string; severity: "LOW" | "MEDIUM" | "HIGH" }[];
  evidence: { claim: string; type: EvidenceKind; fact_ids: string[] }[];
  potential_buyers: string[];
  retail_estimate: { low: number; base: number; high: number; currency: string; basis: string } | null;
  ev: ExpectedValue | null;
  recommended: boolean;
  rejection_reasons: string[];
  facts: FactItem[];
  raw_llm: unknown;
  created_at: string;
}

export interface Opportunity {
  id: string;
  market: Market;
  asset_id: string;
  asset_identifier: string;
  concept_id: string | null;
  run_id: string; // last run that evaluated it
  thesis: string;
  score: number;
  confidence: number;
  registration_cost: number | null;
  renewal_cost: number | null;
  currency: string | null;
  estimated_value_low: number | null;
  estimated_value_base: number | null;
  estimated_value_high: number | null;
  ev_base_36m: number | null;
  trademark_risk: TrademarkRisk;
  recommended: boolean;
  rank: number | null;
  status: OpportunityStatus;
  surfaced_at: string | null;
  mock: boolean;
  created_at: string;
  updated_at: string;
}

export interface FunnelCounts {
  signals: number;
  phrases: number;
  concepts: number;
  generated: number;
  prefiltered_out: number;
  passed_prefilter: number;
  availability_checked: number;
  availability_cached: number;
  available: number;
  shortlisted: number;
  enriched: number;
  underwritten: number;
  recommended: number;
  surfaced: number;
}

export interface RunRecord {
  id: string;
  status: "running" | "succeeded" | "failed";
  trigger: string;
  mode: "mock" | "live" | "mixed";
  adapters: Record<string, string>;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  funnel: Partial<FunnelCounts>;
  discard_reasons: Record<string, number>;
  llm_cost_usd: number;
  api_cost_usd: number;
  total_cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  api_calls: Record<string, number>;
  errors: string[];
  warnings: string[];
  config: Record<string, unknown>;
  digest_text: string | null;
}
