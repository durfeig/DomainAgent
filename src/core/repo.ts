import type { TableStore } from "../adapters/store";
import type { CostEntry } from "./cost";
import type { LogEvent } from "./logger";
import type { DecisionInput } from "./schemas";
import type {
  Concept,
  DecisionAction,
  Evaluation,
  Opportunity,
  OpportunityStatus,
  RawSignal,
  RunRecord,
  TrendSignal,
} from "./types";
import { nowIso, sha1 } from "./util";

/**
 * Persistence helpers on top of the table store. All reads/writes for the pipeline,
 * the API and the dashboard go through here so both backends behave the same.
 */

export const DECIDED_STATUSES: OpportunityStatus[] = ["APPROVED", "REJECTED", "BOUGHT"];

export interface DecisionRow {
  id: string;
  opportunity_id: string;
  action: DecisionAction;
  reason: string;
  human_or_agent: "human" | "agent";
  actor: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface AssetRow {
  id: string;
  market: string;
  identifier: string;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface PositionRow {
  id: string;
  opportunity_id: string;
  asset_id: string;
  acquired_at: string;
  acquisition_cost: number;
  renewal_cost: number | null;
  currency: string;
  status: "HELD" | "LISTED" | "SOLD" | "DROPPED";
  executed_by: "human" | "agent";
  notes: string | null;
}

export class Repo {
  constructor(readonly store: TableStore) {}

  // ---------------------------------------------------------------- runs & observability
  async createRun(run: RunRecord) {
    await this.store.insert("runs", [run]);
  }
  async updateRun(id: string, patch: Partial<RunRecord>) {
    await this.store.update<RunRecord>("runs", id, patch);
  }
  async saveEvents(events: LogEvent[]) {
    if (events.length) await this.store.insert("run_events", events.map((e) => ({ ...e, data: e.data ?? null })));
  }
  async saveCosts(runId: string, entries: CostEntry[]) {
    if (entries.length) {
      await this.store.insert(
        "costs",
        entries.map((e) => ({ ...e, run_id: runId, model: e.model ?? null, meta: e.meta ?? null, created_at: nowIso() })),
      );
    }
  }
  async listRuns(limit = 30) {
    return this.store.select<RunRecord>("runs", { order: { column: "started_at", ascending: false }, limit });
  }
  async getRun(id: string) {
    return this.store.get<RunRecord>("runs", id);
  }
  async runEvents(runId: string) {
    return this.store.select<LogEvent & { id: string }>("run_events", { eq: { run_id: runId }, order: { column: "ts", ascending: true } });
  }

  // ---------------------------------------------------------------- trend signals & concepts
  async saveSignals(runId: string, raw: RawSignal[]): Promise<TrendSignal[]> {
    const fetched = nowIso();
    const rows = raw.map((s) => ({ ...s, run_id: runId, fetched_at: fetched, hash: sha1(`${s.source}|${s.source_id}`) }));
    const unique = [...new Map(rows.map((r) => [r.hash, r])).values()];
    return this.store.upsert<TrendSignal>("trend_signals", unique as TrendSignal[], ["hash"]);
  }

  async historySignals(days: number, excludeRunId: string) {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = await this.store.select<TrendSignal>("trend_signals", { gte: { published_at: since }, limit: 20000 });
    return rows.filter((r) => r.run_id !== excludeRunId);
  }

  async existingConcepts(slugs: string[]) {
    if (!slugs.length) return new Map<string, { id: string; first_seen_at: string }>();
    const rows = await this.store.select<Concept>("concepts", { in: { slug: slugs } });
    return new Map(rows.map((r) => [r.slug, { id: r.id, first_seen_at: r.first_seen_at }]));
  }

  async saveConcepts(runId: string, concepts: Concept[]): Promise<Concept[]> {
    if (!concepts.length) return [];
    const saved = await this.store.upsert<Concept & { last_run_id: string }>(
      "concepts",
      concepts.map(({ id: _id, ...c }) => ({ ...c, last_run_id: runId }) as Concept & { last_run_id: string }),
      ["slug"],
    );
    const bySlug = new Map(saved.map((c) => [c.slug, c]));
    const links = concepts.flatMap((c) =>
      c.evidence_signal_ids.map((signal_id) => ({ concept_id: bySlug.get(c.slug)!.id, signal_id, run_id: runId })),
    );
    if (links.length) await this.store.upsert("concept_signals", links, ["concept_id", "signal_id"]);
    return concepts.map((c) => ({ ...c, id: bySlug.get(c.slug)!.id }));
  }

  // ---------------------------------------------------------------- assets & opportunities
  async decidedIdentifiers(market: string): Promise<Set<string>> {
    const opps = await this.store.select<Opportunity>("opportunities", { eq: { market }, in: { status: DECIDED_STATUSES } });
    return new Set(opps.map((o) => o.asset_identifier));
  }

  async opportunityByIdentifier(market: string, identifier: string) {
    const rows = await this.store.select<Opportunity>("opportunities", { eq: { market, asset_identifier: identifier }, limit: 1 });
    return rows[0] ?? null;
  }

  async upsertAsset(market: string, identifier: string, attributes: Record<string, unknown>): Promise<AssetRow> {
    const [a] = await this.store.upsert<AssetRow>(
      "assets",
      [{ market, identifier, attributes, created_at: nowIso() } as AssetRow],
      ["market", "identifier"],
    );
    return a;
  }

  async upsertOpportunity(o: Omit<Opportunity, "id">): Promise<Opportunity> {
    const [row] = await this.store.upsert<Opportunity>("opportunities", [o as Opportunity], ["market", "asset_id"]);
    return row;
  }

  async updateOpportunity(id: string, patch: Partial<Opportunity>) {
    return this.store.update<Opportunity>("opportunities", id, { ...patch, updated_at: nowIso() });
  }

  async saveEvaluation(e: Omit<Evaluation, "id">): Promise<Evaluation> {
    const [row] = await this.store.insert<Evaluation>("evaluations", [e as Evaluation]);
    const evidenceRows = [
      ...e.facts.map((f) => ({
        opportunity_id: e.opportunity_id,
        evaluation_id: row.id,
        concept_id: null,
        kind: f.kind,
        category: f.category,
        claim: f.claim,
        source: f.source,
        source_url: f.source_url,
        fact_ref: f.id,
        mock: f.mock,
        value: f.value ?? null,
        created_at: e.created_at,
      })),
      ...e.evidence.map((ev) => ({
        opportunity_id: e.opportunity_id,
        evaluation_id: row.id,
        concept_id: null,
        kind: ev.type,
        category: "underwriter_claim",
        claim: ev.claim,
        source: "underwriter",
        source_url: null,
        fact_ref: ev.fact_ids.join(",") || null,
        mock: false,
        value: null,
        created_at: e.created_at,
      })),
    ];
    if (evidenceRows.length) await this.store.insert("evidence", evidenceRows);
    return row;
  }

  async listOpportunities(filter: { status?: OpportunityStatus | "ALL"; limit?: number } = {}) {
    const q = filter.status && filter.status !== "ALL" ? { eq: { status: filter.status } } : {};
    return this.store.select<Opportunity>("opportunities", { ...q, order: { column: "updated_at", ascending: false }, limit: filter.limit ?? 200 });
  }

  async opportunityDetail(id: string) {
    const opp = await this.store.get<Opportunity>("opportunities", id);
    if (!opp) return null;
    const [evaluations, decisions, evidence, concept] = await Promise.all([
      this.store.select<Evaluation>("evaluations", { eq: { opportunity_id: id }, order: { column: "created_at", ascending: false }, limit: 10 }),
      this.store.select<DecisionRow>("decisions", { eq: { opportunity_id: id }, order: { column: "created_at", ascending: false } }),
      this.store.select<Record<string, unknown>>("evidence", { eq: { opportunity_id: id }, limit: 500 }),
      opp.concept_id ? this.store.get<Concept>("concepts", opp.concept_id) : Promise.resolve(null),
    ]);
    const signalLinks = concept ? await this.store.select<{ signal_id: string }>("concept_signals", { eq: { concept_id: concept.id } }) : [];
    const signals = signalLinks.length
      ? await this.store.select<TrendSignal>("trend_signals", { in: { id: signalLinks.map((l) => l.signal_id) }, limit: 50 })
      : [];
    return { opportunity: opp, evaluations, decisions, evidence, concept, signals };
  }

  // ---------------------------------------------------------------- decisions (feedback loop)
  async recordDecision(opportunityId: string, input: DecisionInput, defaultActor: string): Promise<DecisionRow> {
    const opp = await this.store.get<Opportunity>("opportunities", opportunityId);
    if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);
    const [latest] = await this.store.select<Evaluation>("evaluations", {
      eq: { opportunity_id: opportunityId },
      order: { column: "created_at", ascending: false },
      limit: 1,
    });
    // Snapshot everything the system believed at decision time: this is the calibration dataset.
    const snapshot = {
      asset: opp.asset_identifier,
      status_before: opp.status,
      score: opp.score,
      confidence: opp.confidence,
      trademark_risk: opp.trademark_risk,
      registration_cost: opp.registration_cost,
      renewal_cost: opp.renewal_cost,
      estimated_value: [opp.estimated_value_low, opp.estimated_value_base, opp.estimated_value_high],
      ev_base_36m: opp.ev_base_36m,
      recommended: opp.recommended,
      rank: opp.rank,
      mock: opp.mock,
      evaluation_id: latest?.id ?? null,
      components: latest?.components ?? null,
      components_deterministic: latest?.components_deterministic ?? null,
      components_llm: latest?.components_llm ?? null,
      underwriter_version: latest?.underwriter_version ?? null,
      model: latest?.model ?? null,
    };
    const [row] = await this.store.insert<DecisionRow>("decisions", [
      {
        opportunity_id: opportunityId,
        action: input.action,
        reason: input.reason ?? "",
        human_or_agent: input.human_or_agent ?? "human",
        actor: input.actor ?? defaultActor,
        snapshot,
        created_at: nowIso(),
      } as Omit<DecisionRow, "id"> as DecisionRow,
    ]);
    const status: Record<DecisionAction, OpportunityStatus> = { APPROVE: "APPROVED", REJECT: "REJECTED", WATCH: "WATCH", BUY: "BOUGHT" };
    await this.updateOpportunity(opportunityId, { status: status[input.action] });
    if (input.action === "BUY") {
      // BUY records a purchase executed MANUALLY by a human outside the system. Nothing is registered here.
      await this.store.insert<PositionRow>("positions", [
        {
          opportunity_id: opportunityId,
          asset_id: opp.asset_id,
          acquired_at: nowIso(),
          acquisition_cost: input.acquisition_cost ?? opp.registration_cost ?? 0,
          renewal_cost: opp.renewal_cost,
          currency: opp.currency ?? "USD",
          status: "HELD",
          executed_by: "human",
          notes: input.reason || null,
        } as PositionRow,
      ]);
    }
    return row;
  }

  async positions() {
    return this.store.select<PositionRow>("positions", { order: { column: "acquired_at", ascending: false } });
  }

  async stats() {
    const [opps, positions, runs] = await Promise.all([
      this.store.select<Opportunity>("opportunities", { limit: 20000 }),
      this.positions(),
      this.store.select<RunRecord>("runs", { order: { column: "started_at", ascending: false }, limit: 1000 }),
    ]);
    const count = (s: OpportunityStatus) => opps.filter((o) => o.status === s).length;
    return {
      capital_deployed: Math.round(positions.reduce((s, p) => s + (p.acquisition_cost ?? 0), 0) * 100) / 100,
      opportunities_analyzed: opps.length,
      active: count("NEW") + count("WATCH"),
      new: count("NEW"),
      approved: count("APPROVED"),
      rejected: count("REJECTED"),
      watch: count("WATCH"),
      bought: count("BOUGHT"),
      runs: runs.length,
      total_run_cost: Math.round(runs.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0) * 100) / 100,
      last_run: runs[0] ?? null,
    };
  }
}
