import { randomUUID } from "node:crypto";
import { redactedConfig, type Config } from "../config";
import { createLLM, type LLMProvider } from "../adapters/llm";
import { createMarket, type MarketDataProvider } from "../adapters/market";
import { createRegistrar, type RegistrarProvider } from "../adapters/registrar";
import { createSources, type TrendSource } from "../adapters/sources";
import { createStore, type TableStore } from "../adapters/store";
import { CostTracker } from "../core/cost";
import { Logger } from "../core/logger";
import { Repo } from "../core/repo";
import type { Concept, FunnelCounts, Opportunity, RawSignal, RunRecord, TrendSignal } from "../core/types";
import { nowIso } from "../core/util";
import { COMMON_WORDS } from "../data/lexicon";
import { assessAutoBuy } from "../trader/auto-trader";
import { budgetStatus } from "../trader/budget-guard";
import { checkAvailabilityStage } from "./availability";
import { extractConcepts } from "./concepts";
import { buildDigest, rankRecommended, type Digest, type DigestItem, type NearMiss } from "./digest";
import { enrichStage } from "./enrichment";
import { buildLexicon, generateForConcept } from "./generator";
import { minePhrases } from "./phrases";
import { prefilter } from "./prefilter";
import { prescore, selectForAvailability } from "./prescore";
import { quantScore, underwriteStage, type UnderwritingInput } from "./underwriter";

export interface RunDeps {
  store: TableStore;
  llm: LLMProvider;
  registrar: RegistrarProvider;
  market: MarketDataProvider;
  sources: TrendSource[];
  skippedSources: { name: string; reason: string }[];
}

export function createDeps(cfg: Config): RunDeps {
  const { sources, skipped } = createSources(cfg);
  return {
    store: createStore(cfg),
    llm: createLLM(cfg),
    registrar: createRegistrar(cfg),
    market: createMarket(cfg),
    sources,
    skippedSources: skipped,
  };
}

export interface RunResult {
  run: RunRecord;
  digest: Digest;
  surfaced: Opportunity[];
}

const MARKET = "domain" as const;

/**
 * RUN SCOUT — the whole Analyst pipeline, end to end:
 * sources → trend scout → concept extractor → domain generator → pre-filter → availability →
 * enrichment → underwriter → persistence → ranking (max 5) → digest.
 * Never buys anything.
 */
export async function runScout(cfg: Config, opts: { trigger?: string; deps?: RunDeps; quiet?: boolean; now?: Date } = {}): Promise<RunResult> {
  const deps = opts.deps ?? createDeps(cfg);
  const repo = new Repo(deps.store);
  const runId = randomUUID();
  const log = new Logger(runId, { quiet: opts.quiet });
  const costs = new CostTracker(cfg.RUN_LLM_BUDGET_USD);
  const t0 = Date.now();
  const now = opts.now ?? new Date();

  const mockFlags = [deps.llm.mock, deps.registrar.mock, deps.market.mock, ...deps.sources.map((s) => s.mock)];
  const mode: RunRecord["mode"] = mockFlags.every(Boolean) ? "mock" : mockFlags.some(Boolean) || deps.registrar.sandbox ? "mixed" : "live";
  const run: RunRecord = {
    id: runId,
    status: "running",
    trigger: opts.trigger ?? "manual",
    mode,
    adapters: {
      store: deps.store.kind,
      llm: deps.llm.name,
      registrar: deps.registrar.name,
      market: deps.market.name,
      sources: deps.sources.map((s) => s.name).join(","),
    },
    started_at: new Date(t0).toISOString(),
    finished_at: null,
    duration_ms: null,
    funnel: {},
    discard_reasons: {},
    llm_cost_usd: 0,
    api_cost_usd: 0,
    total_cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    api_calls: {},
    errors: [],
    warnings: [],
    config: redactedConfig(cfg),
    digest_text: null,
  };
  await repo.createRun(run);
  const funnel: Partial<FunnelCounts> = {};
  const discard: Record<string, number> = {};
  const addDiscard = (counts: Record<string, number>, prefix: string) => {
    for (const [k, v] of Object.entries(counts)) discard[`${prefix}:${k}`] = (discard[`${prefix}:${k}`] ?? 0) + v;
  };
  for (const s of deps.skippedSources) run.warnings.push(`source ${s.name} skipped: ${s.reason}`);
  if (mode !== "live") run.warnings.push(`run mode ${mode}: synthetic data present`);
  log.info("run", "started", { mode, adapters: run.adapters });

  try {
    // ------------------------------------------------------------ 1. TREND SCOUT
    const raw: RawSignal[] = [];
    await Promise.all(
      deps.sources.map(async (src) => {
        const st = Date.now();
        try {
          const got = await src.fetch({ lookbackDays: cfg.TREND_LOOKBACK_DAYS, now }, costs, log);
          raw.push(...got);
          log.info("trend_scout", "source_done", { source: src.name, signals: got.length, ms: Date.now() - st });
        } catch (e) {
          const msg = `${src.name}: ${(e as Error).message}`;
          run.errors.push(msg);
          log.error("trend_scout", "source_failed", { source: src.name, error: msg });
        }
      }),
    );
    const signals = await repo.saveSignals(runId, raw);
    funnel.signals = signals.length;
    const history = await repo.historySignals(30, runId);

    const phrases = minePhrases(signals, { now, recentDays: cfg.TREND_RECENT_DAYS, history });
    funnel.phrases = phrases.length;
    log.info("trend_scout", "phrases", { count: phrases.length, top: phrases.slice(0, 10).map((p) => p.phrase) });
    if (phrases.length === 0) {
      run.warnings.push("no recurring phrases found in signals");
      return await finish([], [], []);
    }

    // ------------------------------------------------------------ 2. CONCEPT EXTRACTOR
    const extraction = await extractConcepts({ phrases, signals, maxConcepts: cfg.MAX_CONCEPTS, existing: new Map() }, deps.llm, costs, log);
    const prior = await repo.existingConcepts(extraction.concepts.map((c) => c.slug));
    const concepts = await repo.saveConcepts(
      runId,
      extraction.concepts.map((c) => ({ ...c, first_seen_at: prior.get(c.slug)?.first_seen_at ?? c.first_seen_at })),
    );
    funnel.concepts = concepts.length;
    for (const d of extraction.dropped) discard[`concept:${d.reason.split(" ")[0]}`] = (discard[`concept:${d.reason.split(" ")[0]}`] ?? 0) + 1;
    log.info("concept_extractor", "done", { concepts: concepts.map((c) => ({ name: c.name, score: c.score, conf: c.confidence, durability: c.durability })), dropped: extraction.dropped });
    if (!concepts.length) return await finish([], [], []);
    const conceptBySlug = new Map(concepts.map((c) => [c.slug, c]));

    // ------------------------------------------------------------ 3. DOMAIN GENERATOR
    const lexicon = await buildLexicon(concepts, deps.llm, costs, log);
    const generated = concepts.flatMap((c) => generateForConcept(c, lexicon.get(c.slug)!, cfg.TLDS, cfg.MAX_CANDIDATES_PER_CONCEPT));
    funnel.generated = generated.length;
    const known = new Set([...COMMON_WORDS, ...[...lexicon.values()].flatMap((l) => [...l.core_terms, ...l.alt_nouns, ...l.verbs, ...l.brandable_roots])]);

    // ------------------------------------------------------------ 4. PRE-FILTER (before any API call)
    const pf = prefilter(generated, known);
    funnel.prefiltered_out = pf.rejected.length;
    funnel.passed_prefilter = pf.passed.length;
    addDiscard(pf.reasonCounts, "prefilter");
    const decided = await repo.decidedIdentifiers(MARKET);
    const scored = pf.passed
      .filter((c) => {
        if (decided.has(c.domain)) {
          discard["prefilter:ALREADY_DECIDED"] = (discard["prefilter:ALREADY_DECIDED"] ?? 0) + 1;
          return false;
        }
        return true;
      })
      .map((c) => ({ ...c, prescore: prescore(c, conceptBySlug.get(c.concept_slug)!) }));
    const toCheck = selectForAvailability(scored, concepts, cfg.MAX_AVAILABILITY_CHECKS);
    discard["prescore:BELOW_CHECK_BUDGET"] = scored.length - toCheck.length;
    log.info("prefilter", "done", { generated: generated.length, passed: pf.passed.length, selected_for_check: toCheck.length, reasons: pf.reasonCounts });

    // ------------------------------------------------------------ 5. AVAILABILITY
    const av = await checkAvailabilityStage(toCheck, { registrar: deps.registrar, store: deps.store, costs, log }, { cacheDays: cfg.AVAILABILITY_CACHE_DAYS, maxAnalysisCost: cfg.ANALYSIS_MAX_ASSET_COST, runId });
    funnel.availability_checked = av.checked;
    funnel.availability_cached = av.cached;
    funnel.available = av.available.length;
    addDiscard(av.reasonCounts, "availability");
    run.errors.push(...av.errors.slice(0, 5));

    // ------------------------------------------------------------ 6. MARKET DATA ENRICHMENT
    const shortlist = [...av.available].sort((a, b) => b.prescore - a.prescore).slice(0, cfg.MAX_ENRICH);
    funnel.shortlisted = shortlist.length;
    discard["enrichment:BELOW_SHORTLIST"] = av.available.length - shortlist.length;
    const enriched = await enrichStage(shortlist, { market: deps.market, store: deps.store, costs, log });
    funnel.enriched = enriched.length;

    // ------------------------------------------------------------ 7. UNDERWRITER
    const signalById = new Map(signals.map((s) => [s.id, s] as [string, TrendSignal]));
    const ctxFor = (c: UnderwritingInput) => {
      const concept = conceptBySlug.get(c.concept_slug)!;
      return { concept, signals: concept.evidence_signal_ids.map((id) => signalById.get(id)).filter((s): s is TrendSignal => !!s) };
    };
    const forLlm = (enriched as UnderwritingInput[])
      .map((c) => ({ c, q: quantScore(c, ctxFor(c)) }))
      .sort((a, b) => b.q - a.q)
      .slice(0, cfg.MAX_UNDERWRITE)
      .map((x) => x.c);
    discard["underwriter:BELOW_QUANT_CUTOFF"] = enriched.length - forLlm.length;
    const uw = await underwriteStage(forLlm, ctxFor, { llm: deps.llm, costs, log, cfg }, runId);
    if (uw.stopped) run.warnings.push(uw.stopped);
    funnel.underwritten = uw.evaluations.length;

    // ------------------------------------------------------------ 8. PERSIST
    const persisted: { opp: Opportunity; ev: (typeof uw.evaluations)[number]; concept: Concept }[] = [];
    for (const ev of uw.evaluations) {
      const c = ev.candidate;
      const concept = conceptBySlug.get(c.concept_slug)!;
      const asset = await repo.upsertAsset(MARKET, c.domain, {
        sld: c.sld,
        tld: c.tld,
        parts: c.parts,
        strategy: c.strategy,
        length: c.sld.length,
        registrar: c.availability.registrar,
      });
      const prev = await repo.opportunityByIdentifier(MARKET, c.domain);
      const ts = nowIso();
      const opp = await repo.upsertOpportunity({
        market: MARKET,
        asset_id: asset.id,
        asset_identifier: c.domain,
        concept_id: concept.id,
        run_id: runId,
        thesis: ev.thesis,
        score: ev.final_score,
        confidence: ev.confidence,
        registration_cost: c.availability.registration_cost,
        renewal_cost: c.availability.renewal_cost,
        currency: c.availability.currency,
        estimated_value_low: ev.retail_estimate?.low ?? null,
        estimated_value_base: ev.retail_estimate?.base ?? null,
        estimated_value_high: ev.retail_estimate?.high ?? null,
        ev_base_36m: ev.ev?.scenarios.base["36m"].ev ?? null,
        trademark_risk: ev.trademark_risk,
        recommended: ev.recommended,
        rank: null,
        // Keep WATCH and pending NEW items; everything else is "analyzed, not surfaced" until ranking.
        status: prev?.status === "WATCH" ? "WATCH" : prev?.status === "NEW" && ev.recommended ? "NEW" : "ARCHIVED",
        surfaced_at: prev?.surfaced_at ?? null,
        mock: c.availability.mock || c.market.mock || deps.llm.mock,
        created_at: prev?.created_at ?? ts,
        updated_at: ts,
      });
      const { candidate: _c, ...evaluation } = ev;
      await repo.saveEvaluation({ ...evaluation, opportunity_id: opp.id });
      persisted.push({ opp, ev, concept });
      for (const r of ev.rejection_reasons) {
        const key = `underwriter:${r.split(/\s[\d$-]/)[0].slice(0, 48)}`;
        discard[key] = (discard[key] ?? 0) + 1;
      }
    }

    // ------------------------------------------------------------ 9. RANK (max 5) + DIGEST
    const recommended = persisted.filter((p) => p.ev.recommended);
    funnel.recommended = recommended.length;
    if (recommended.length > cfg.MAX_DIGEST * 3) {
      run.warnings.push(`calibration: ${recommended.length} candidates passed the rules — thresholds look loose`);
    }
    const ranked = rankRecommended(
      recommended.map((p) => ({ ...p, final_score: p.ev.final_score, confidence: p.ev.confidence, ev_base_36m: p.opp.ev_base_36m, concept_slug: p.concept.slug })),
      cfg.MAX_DIGEST,
      cfg.MAX_PER_CONCEPT_IN_DIGEST,
    );
    const budget = budgetStatus(await repo.positions(), cfg);
    const items: DigestItem[] = [];
    const surfaced: Opportunity[] = [];
    for (const [i, p] of ranked.entries()) {
      const updated = (await repo.updateOpportunity(p.opp.id, {
        rank: i + 1,
        status: p.opp.status === "WATCH" ? "WATCH" : "NEW",
        surfaced_at: nowIso(),
      }))!;
      surfaced.push(updated);
      const auto = assessAutoBuy(updated, budget, cfg);
      log.info("auto_trader", "dry_run", { domain: updated.asset_identifier, eligible: auto.eligible, reasons: auto.reasons, auto_buy_enabled: cfg.AUTO_BUY_ENABLED });
      items.push({ rank: i + 1, opportunity: updated, evaluation: p.ev, concept_name: p.concept.name, autobuy_dry_run: auto });
    }
    funnel.surfaced = surfaced.length;
    const nearMisses: NearMiss[] = persisted
      .filter((p) => !p.ev.recommended)
      .sort((a, b) => b.ev.final_score * b.ev.confidence - a.ev.final_score * a.ev.confidence)
      .slice(0, 3)
      .map((p) => ({ domain: p.opp.asset_identifier, score: p.ev.final_score, confidence: p.ev.confidence, reasons: p.ev.rejection_reasons }));
    return await finish(items, surfaced, nearMisses);
  } catch (e) {
    run.status = "failed";
    run.errors.push((e as Error).message);
    log.error("run", "failed", { error: (e as Error).message, stack: (e as Error).stack?.split("\n").slice(0, 5).join(" | ") });
    await finish([], [], [], true);
    throw e;
  }

  async function finish(items: DigestItem[], surfaced: Opportunity[], nearMisses: NearMiss[], failed = false): Promise<RunResult> {
    run.status = failed ? "failed" : "succeeded";
    run.finished_at = nowIso();
    run.duration_ms = Date.now() - t0;
    run.funnel = funnel;
    run.discard_reasons = Object.fromEntries(Object.entries(discard).filter(([, v]) => v > 0));
    run.llm_cost_usd = costs.llmUsd;
    run.api_cost_usd = costs.apiUsd;
    run.total_cost_usd = costs.totalUsd;
    run.tokens_in = costs.tokensIn;
    run.tokens_out = costs.tokensOut;
    run.api_calls = costs.apiCalls;
    if (costs.unknownPriceEntries) run.warnings.push(`${costs.unknownPriceEntries} cost entries have unknown USD price (e.g. NAMEBIO_USD_PER_CREDIT unset)`);
    const digest = buildDigest({ run, funnel, items, nearMisses, dashboardUrl: cfg.DASHBOARD_URL });
    run.digest_text = digest.text;
    log.info("run", failed ? "finished_with_error" : "finished", { funnel, cost: run.total_cost_usd, ms: run.duration_ms, surfaced: surfaced.length });
    await repo.updateRun(runId, run);
    await repo.saveEvents(log.drain());
    await repo.saveCosts(runId, costs.entries);
    return { run, digest, surfaced };
  }
}
