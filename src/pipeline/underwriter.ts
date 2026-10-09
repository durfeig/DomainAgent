import type { Config } from "../config";
import type { LLMProvider } from "../adapters/llm";
import { LLMRefusalError } from "../adapters/llm";
import { BudgetExceededError, type CostTracker } from "../core/cost";
import type { Logger } from "../core/logger";
import { UnderwriterSchema, type UnderwriterOutput } from "../core/schemas";
import type {
  AvailabilityResult,
  ComponentScores,
  Concept,
  DomainCandidate,
  Evaluation,
  FactItem,
  MarketData,
  TrademarkRisk,
  TrendSignal,
} from "../core/types";
import { COMPONENTS } from "../core/types";
import { clamp, hashUnit, mapLimit, nowIso } from "../core/util";
import { UNDERWRITER_SYSTEM, UNDERWRITER_VERSION, underwriterUser } from "../prompts/underwriter";
import {
  confidenceCap,
  deterministicComponents,
  expectedValue,
  finalScore,
  mergeComponents,
  reconcileRetail,
  recommendationRules,
  weightedScore,
} from "./scoring";
import { assessTrademark, maxRisk, type TrademarkAssessment } from "./trademark";

export type UnderwritingInput = DomainCandidate & {
  availability: AvailabilityResult;
  market: MarketData;
  trademark_risk: TrademarkRisk;
};

export interface UnderwritingContext {
  concept: Concept;
  signals: TrendSignal[]; // signals supporting the concept
}

// ------------------------------------------------------------------ fact sheet

export function buildFactSheet(c: UnderwritingInput, ctx: UnderwritingContext): FactItem[] {
  const facts: FactItem[] = [];
  const add = (f: Omit<FactItem, "id">) => facts.push({ ...f, id: `F${facts.length + 1}` });
  const a = c.availability;
  add({
    kind: "FACT",
    category: "availability",
    claim: `${c.domain} is registrable (tier: ${a.tier ?? "unknown"}) per ${a.provider}${a.sandbox ? " SANDBOX" : ""} check at ${a.checked_at}.`,
    source: a.provider,
    source_url: null,
    mock: a.mock,
  });
  add({
    kind: "FACT",
    category: "pricing",
    claim: `Registration ${a.currency ?? "?"} ${a.registration_cost ?? "unknown"}; renewal ${a.currency ?? "?"} ${a.renewal_cost ?? "unknown"} per year.`,
    source: a.provider,
    source_url: null,
    mock: a.mock,
    value: { registration_cost: a.registration_cost, renewal_cost: a.renewal_cost, currency: a.currency },
  });
  const k = ctx.concept;
  add({
    kind: "FACT",
    category: "concept",
    claim:
      `Concept "${k.name}" is supported by ${k.frequency} signals across sources [${k.sources.join(", ")}]; ` +
      `momentum ${k.momentum === null ? "unknown (no history yet)" : `${k.momentum}x recent vs baseline rate`}; ` +
      `durability classified ${k.durability} (an INFERENCE by the concept extractor: ${k.durability_reason}).`,
    source: "arbitrage-os trend scout",
    source_url: null,
    mock: ctx.signals.some((s) => s.mock),
  });
  const top = [...ctx.signals]
    .sort((x, y) => engagementOf(y) - engagementOf(x))
    .slice(0, 8);
  for (const s of top) {
    const e = s.engagement;
    const eng = [e.points ? `${e.points} points` : "", e.stars ? `${e.stars} stars` : "", e.votes ? `${e.votes} votes` : "", e.comments ? `${e.comments} comments` : ""]
      .filter(Boolean)
      .join(", ");
    add({
      kind: "FACT",
      category: "trend_signal",
      claim: `${s.source}: "${s.title}" (${s.published_at.slice(0, 10)}${eng ? `, ${eng}` : ""})`,
      source: s.source,
      source_url: s.source_url,
      mock: s.mock,
    });
  }
  for (const kw of c.market.keyword_stats) {
    add({
      kind: "FACT",
      category: "keyword_stats",
      claim:
        `Keyword "${kw.keyword}": ${kw.sales_count ?? "unknown"} recorded sales; median ${fmt(kw.median_price)}, average ${fmt(kw.avg_price)}, max ${fmt(kw.max_price)}` +
        `${kw.as_of ? ` (as of ${kw.as_of})` : ""}.`,
      source: kw.source,
      source_url: kw.source.startsWith("namebio") ? "https://namebio.com/" : null,
      mock: kw.mock,
    });
  }
  const s = c.market.comps_summary;
  if (s) {
    add({
      kind: "FACT",
      category: "comps_summary",
      claim:
        `${s.count} comparable sales returned (venue reports only sales >= $1,000): median $${s.median}, p25 $${s.p25}, p75 $${s.p75}, ` +
        `min $${s.min}, max $${s.max}; ${s.same_tld_count} in .${c.tld}; ${s.last_24m_count} in the last 24 months; most recent ${s.most_recent_date ?? "unknown"}.`,
      source: c.market.provider,
      source_url: null,
      mock: c.market.mock,
    });
    for (const comp of (c.market.comps ?? []).slice(0, 8)) {
      add({
        kind: "FACT",
        category: "comparable_sale",
        claim: `${comp.domain} sold for $${comp.price}${comp.date ? ` on ${comp.date}` : ""}${comp.venue ? ` at ${comp.venue}` : ""}.`,
        source: comp.source,
        source_url: comp.source_url,
        mock: comp.source === "mock",
      });
    }
  } else if (c.market.comps && c.market.comps.length === 0) {
    add({ kind: "FACT", category: "comps_summary", claim: "The comparables source returned zero comparable sales for this name.", source: c.market.provider, source_url: null, mock: c.market.mock });
  }
  return facts;
}

function engagementOf(s: TrendSignal) {
  const e = s.engagement;
  return (e.points ?? 0) + (e.stars ?? 0) * 0.3 + (e.votes ?? 0) * 0.5;
}
const fmt = (n: number | null) => (n === null ? "unknown" : `$${n}`);

// ------------------------------------------------------------------ stage

export interface UnderwriteDeps {
  llm: LLMProvider;
  costs: CostTracker;
  log: Logger;
  cfg: Config;
}

export async function underwriteStage(
  inputs: UnderwritingInput[],
  ctxFor: (c: UnderwritingInput) => UnderwritingContext,
  deps: UnderwriteDeps,
  runId: string,
): Promise<{ evaluations: (Omit<Evaluation, "id" | "opportunity_id"> & { candidate: UnderwritingInput })[]; stopped: string | null }> {
  let stopped: string | null = null;
  const out = await mapLimit(inputs, 3, async (c) => {
    if (stopped) return null;
    try {
      return { ...(await underwriteOne(c, ctxFor(c), deps, runId)), candidate: c };
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        stopped = e.message;
        deps.log.warn("underwriter", "llm_budget_exhausted", { domain: c.domain });
        return null;
      }
      throw e;
    }
  });
  return { evaluations: out.filter((x): x is NonNullable<typeof x> => !!x), stopped };
}

export async function underwriteOne(c: UnderwritingInput, ctx: UnderwritingContext, deps: UnderwriteDeps, runId: string): Promise<Omit<Evaluation, "id" | "opportunity_id">> {
  const { llm, costs, log, cfg } = deps;
  const facts = buildFactSheet(c, ctx);
  const factIds = new Set(facts.map((f) => f.id));
  const engagement = ctx.signals.reduce((s, x) => s + engagementOf(x), 0);
  const reg = c.availability.registration_cost;
  const renew = c.availability.renewal_cost ?? reg;
  const det = deterministicComponents(c, ctx.concept, c.market, engagement, { reg, renew });
  const tmScreen: TrademarkAssessment = assessTrademark(c.sld, c.parts);

  let out: UnderwriterOutput | null = null;
  let model = "none";
  let llmError: string | null = null;
  try {
    const res = await llm.complete(
      {
        task: "underwriting",
        tier: "underwriter",
        system: UNDERWRITER_SYSTEM,
        user: underwriterUser({
          domain: c.domain,
          concept: { name: ctx.concept.name, description: ctx.concept.description, durability: ctx.concept.durability, momentum: ctx.concept.momentum, sources: ctx.concept.sources, frequency: ctx.concept.frequency },
          candidate: { strategy: c.strategy, parts: c.parts, length: c.sld.length, tld: c.tld },
          trademark_screen: { risk: tmScreen.risk, matches: tmScreen.matches },
          facts: facts.map((f) => ({ id: f.id, category: f.category, claim: f.claim, source: f.source, url: f.source_url, mock: f.mock })),
        }),
        schema: UnderwriterSchema,
        maxTokens: 16000,
        mockResponse: () => mockUnderwriter(c, det, facts, ctx),
      },
      costs,
    );
    out = res.data;
    model = res.model;
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    llmError = e instanceof LLMRefusalError ? "llm_refusal" : `llm_error: ${(e as Error).message}`;
    log.error("underwriter", "llm_failed", { domain: c.domain, error: llmError });
  }

  // --- Evidence hygiene: FACT claims must cite existing fact IDs, otherwise downgraded.
  const evidence = (out?.evidence ?? []).map((ev) => {
    const valid = ev.fact_ids.filter((id) => factIds.has(id));
    if (ev.type === "FACT" && valid.length === 0) {
      log.warn("underwriter", "uncited_fact_downgraded", { domain: c.domain, claim: ev.claim.slice(0, 120) });
      return { ...ev, type: "INFERENCE" as const, fact_ids: [] };
    }
    return { ...ev, fact_ids: valid };
  });

  const llmComponents: Partial<ComponentScores> | null = out
    ? (Object.fromEntries(COMPONENTS.map((k) => [k, out!.component_scores[k].score])) as ComponentScores)
    : null;
  const components = mergeComponents(det, llmComponents);
  const tm = maxRisk(maxRisk(c.trademark_risk, tmScreen.risk), out?.trademark.risk ?? "LOW");
  const fs = finalScore(components, tm);

  const cap = confidenceCap({ md: c.market, liveAvailability: !c.availability.mock && !c.availability.sandbox, concept: ctx.concept }, cfg);
  const confidence = out ? Math.min(out.confidence, cap.cap) : 0;

  const retail = reconcileRetail(out?.estimated_retail ?? null, c.market);
  const ev =
    retail && reg !== null
      ? expectedValue({ tld: c.tld, reg, renew: renew ?? reg, retail, score: fs.final }, cfg)
      : null;

  const rejection = recommendationRules(
    { final_score: fs.final, confidence, trademark_risk: tm, ev, retail, verdict: out?.verdict ?? null, registrable: c.availability.registrable },
    cfg,
  );
  if (llmError) rejection.unshift(llmError);

  const risks = [...(out?.risks ?? [])];
  for (const n of cap.notes) risks.push({ risk: `Data gap: ${n}`, severity: "MEDIUM" });
  for (const m of tmScreen.matches) risks.push({ risk: `Trademark screen: ${m.detail}`, severity: tm === "HIGH" ? "HIGH" : "MEDIUM" });
  if (c.availability.mock || c.market.mock) risks.unshift({ risk: "MOCK DATA: availability/market data are synthetic — do not act on this.", severity: "HIGH" });

  return {
    run_id: runId,
    underwriter_version: UNDERWRITER_VERSION,
    model,
    components,
    components_deterministic: det,
    components_llm: llmComponents,
    weighted_score: fs.weighted,
    trademark_risk: tm,
    trademark_penalty: fs.penalty,
    final_score: fs.final,
    confidence,
    confidence_llm: out?.confidence ?? null,
    confidence_cap: cap.cap,
    thesis: out?.thesis ?? "",
    why_now: out?.why_now ?? "",
    risks,
    evidence,
    potential_buyers: out?.potential_buyer_categories ?? [],
    retail_estimate: retail,
    ev,
    recommended: rejection.length === 0,
    rejection_reasons: rejection,
    facts,
    raw_llm: out ? { ...out, kill_reasons: out.kill_reasons } : { error: llmError },
    created_at: nowIso(),
  };
}

/** Quant-only score used to choose which candidates are worth an LLM call. */
export function quantScore(c: UnderwritingInput, ctx: UnderwritingContext): number {
  const engagement = ctx.signals.reduce((s, x) => s + engagementOf(x), 0);
  const det = deterministicComponents(c, ctx.concept, c.market, engagement, { reg: c.availability.registration_cost, renew: c.availability.renewal_cost });
  return weightedScore(det) - (c.trademark_risk === "MEDIUM" ? 15 : 0);
}

// ------------------------------------------------------------------ mock (offline) underwriter

/** Deterministic stand-in for the LLM: stays close to the deterministic components, cites real fact IDs. */
export function mockUnderwriter(c: UnderwritingInput, det: ComponentScores, facts: FactItem[], ctx: UnderwritingContext): UnderwriterOutput {
  const j = (k: string) => Math.round((hashUnit(`${c.domain}:${k}`) - 0.5) * 10);
  const comp = (k: keyof ComponentScores, basis: "FACT" | "ESTIMATE" | "INFERENCE", why: string) => ({
    score: Math.round(clamp(det[k] + j(k))),
    basis,
    rationale: `[mock] ${why}`,
  });
  const cs = {
    demand_evidence: comp("demand_evidence", "FACT", `${ctx.concept.frequency} signals across ${ctx.concept.sources.length} sources`),
    historical_market: comp("historical_market", c.market.comps_summary ? "FACT" : "INFERENCE", c.market.comps_summary ? `median comp $${c.market.comps_summary.median}` : "no comparables"),
    buyer_universe: comp("buyer_universe", "INFERENCE", "startups and product teams in the concept space"),
    brandability: comp("brandability", "INFERENCE", `${c.sld.length} letters, ${c.parts.length} word(s)`),
    trend_momentum: comp("trend_momentum", "INFERENCE", `durability ${ctx.concept.durability}`),
    tld_quality: comp("tld_quality", "INFERENCE", `.${c.tld}`),
    capital_efficiency: comp("capital_efficiency", "FACT", `registration ${c.availability.registration_cost}`),
  };
  const weighted = weightedScore(Object.fromEntries(COMPONENTS.map((k) => [k, cs[k].score])) as ComponentScores);
  const s = c.market.comps_summary;
  const quality = clamp(det.brandability / 100, 0.3, 1);
  const retail = s
    ? { low: Math.round(s.p25 * 0.5 * quality), base: Math.round(s.median * quality), high: Math.round(s.p75 * quality), currency: "USD" as const, basis: "[mock] comparables scaled by brandability" }
    : null;
  const conf = Math.round(clamp(55 + (s ? 15 : 0) + (ctx.concept.sources.length >= 3 ? 10 : 0) + j("conf")));
  const factIdsBy = (cat: FactItem["category"]) => facts.filter((f) => f.category === cat).map((f) => f.id);
  return {
    domain: c.domain,
    verdict: weighted >= 75 && retail ? "INVEST" : weighted >= 65 ? "WATCH" : "REJECT",
    kill_reasons: weighted >= 75 ? [] : ["[mock] weighted score below investment bar"],
    component_scores: cs,
    confidence: conf,
    confidence_rationale: "[mock] heuristic confidence from data coverage",
    trademark: { risk: c.trademark_risk, rationale: "[mock] mirrors automated screen" },
    thesis: `[MOCK] ${c.domain} is a ${c.strategy.replace("_", "+")} name for the "${ctx.concept.name}" concept; buyers would be teams building products in that category.`,
    why_now: `[MOCK] "${ctx.concept.name}" appears in ${ctx.concept.frequency} recent signals across ${ctx.concept.sources.join(", ")}.`,
    risks: [
      { risk: "Concept could consolidate under an established vendor's brand.", severity: "MEDIUM" },
      { risk: "Hand-registered names have low annual sell-through; renewals compound.", severity: "MEDIUM" },
    ],
    evidence: [
      { claim: "Domain is registrable at the quoted price.", type: "FACT", fact_ids: [...factIdsBy("availability"), ...factIdsBy("pricing")] },
      { claim: "Concept has multi-source recent evidence.", type: "FACT", fact_ids: factIdsBy("trend_signal").slice(0, 3) },
      ...(s ? [{ claim: `Comparable median $${s.median}.`, type: "FACT" as const, fact_ids: factIdsBy("comps_summary") }] : []),
      { claim: "Retail range derived from comparables and brandability.", type: "ESTIMATE", fact_ids: factIdsBy("comps_summary") },
    ],
    estimated_retail: retail,
    potential_buyer_categories: ["early-stage startups in the category", "established vendors launching a product line", "agencies / consultancies"],
  };
}
