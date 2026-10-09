import type { Evaluation, FunnelCounts, Opportunity, RunRecord } from "../core/types";

export interface DigestItem {
  rank: number;
  opportunity: Opportunity;
  evaluation: Pick<Evaluation, "thesis" | "why_now" | "risks" | "evidence" | "potential_buyers" | "retail_estimate" | "ev" | "facts">;
  concept_name: string;
  autobuy_dry_run: { eligible: boolean; reasons: string[] };
}

export interface NearMiss {
  domain: string;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface Digest {
  title: string;
  text: string; // plain text / Slack mrkdwn
  items: { id: string; domain: string; score: number; confidence: number; url: string }[];
}

const k = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `${Math.round(n)}`;
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `$${n.toFixed(2)}`);
const int = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

export function buildDigest(args: {
  run: Pick<RunRecord, "id" | "mode" | "started_at" | "llm_cost_usd" | "api_cost_usd" | "total_cost_usd" | "warnings">;
  funnel: Partial<FunnelCounts>;
  items: DigestItem[];
  nearMisses: NearMiss[];
  dashboardUrl: string;
}): Digest {
  const date = new Date(args.run.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).toUpperCase();
  const title = `ARBITRAGE SCOUT — ${date}`;
  const f = args.funnel;
  const L: string[] = [];
  L.push(`*${title}*`);
  if (args.run.mode !== "live") {
    L.push(`⚠️ ${args.run.mode.toUpperCase()} MODE — some adapters return synthetic data. Do not act on these numbers.`);
  }
  L.push("");
  L.push("```");
  L.push(`Signals:        ${int(f.signals).padStart(7)}`);
  L.push(`Concepts:       ${int(f.concepts).padStart(7)}`);
  L.push(`Generated:      ${int(f.generated).padStart(7)}`);
  L.push(`Pre-filtered:   ${int(f.passed_prefilter).padStart(7)}`);
  L.push(`Checked:        ${int(f.availability_checked).padStart(7)}`);
  L.push(`Available:      ${int(f.available).padStart(7)}`);
  L.push(`Underwritten:   ${int(f.underwritten).padStart(7)}`);
  L.push(`Passed rules:   ${int(f.recommended).padStart(7)}`);
  L.push(`Surfaced:       ${int(f.surfaced).padStart(7)}`);
  L.push("");
  L.push(`LLM cost:       ${usd(args.run.llm_cost_usd).padStart(7)}`);
  L.push(`API cost:       ${usd(args.run.api_cost_usd).padStart(7)}`);
  L.push(`Total:          ${usd(args.run.total_cost_usd).padStart(7)}`);
  L.push("```");

  if (args.items.length === 0) {
    L.push("");
    L.push("*0 opportunities passed underwriting.* Capital preserved — nothing to approve today.");
    if (args.nearMisses.length) {
      L.push("Closest calls (for calibration):");
      for (const m of args.nearMisses.slice(0, 3)) L.push(`• ${m.domain} — score ${m.score}, conf ${m.confidence}: ${m.reasons.slice(0, 2).join("; ")}`);
    }
  }

  for (const it of args.items) {
    const o = it.opportunity;
    const e = it.evaluation;
    const evb = e.ev?.scenarios;
    const url = `${args.dashboardUrl.replace(/\/$/, "")}/o/${o.id}`;
    L.push("");
    L.push(`*#${it.rank} ${o.asset_identifier}*${o.status === "WATCH" ? " _(on your watchlist)_" : ""}`);
    L.push(`Score: *${o.score}* · Confidence: *${o.confidence}* · Trademark: ${o.trademark_risk}`);
    L.push(`Cost: ${usd(o.registration_cost)} · Renewal: ${usd(o.renewal_cost)}/yr`);
    if (e.retail_estimate) L.push(`Estimated retail (ESTIMATE): $${k(e.retail_estimate.low)}–${k(e.retail_estimate.high)} (base $${k(e.retail_estimate.base)})`);
    if (evb) {
      L.push(
        `EV 36m (ESTIMATE): base ${usd(evb.base["36m"].ev)} · bear ${usd(evb.bear["36m"].ev)} · bull ${usd(evb.bull["36m"].ev)} ` +
          `(P(sale) base ${(evb.base["36m"].p_sale * 100).toFixed(1)}%)`,
      );
    }
    L.push(`Concept: ${it.concept_name}`);
    if (e.thesis) L.push(`Thesis: ${e.thesis}`);
    if (e.why_now) L.push(`Why now: ${e.why_now}`);
    const facts = e.evidence.filter((x) => x.type === "FACT").slice(0, 3);
    if (facts.length) {
      L.push("Evidence:");
      const factMap = new Map(e.facts.map((x) => [x.id, x]));
      for (const x of facts) {
        const urls = x.fact_ids.map((id) => factMap.get(id)?.source_url).filter((u): u is string => !!u && u.startsWith("http"));
        L.push(`• [FACT] ${x.claim}${urls.length ? ` <${urls[0]}|source>` : ""}`);
      }
    }
    if (e.potential_buyers.length) L.push(`Potential buyers: ${e.potential_buyers.slice(0, 4).join(", ")}`);
    const risks = e.risks.filter((r) => r.severity !== "LOW").slice(0, 3);
    if (risks.length) L.push(`Risks: ${risks.map((r) => r.risk).join(" | ")}`);
    L.push(`Phase-2 auto-buy (dry run): ${it.autobuy_dry_run.eligible ? "would qualify" : "no — " + it.autobuy_dry_run.reasons.slice(0, 2).join("; ")}`);
    L.push(`<${url}?action=APPROVE|[APPROVE]>  <${url}?action=REJECT|[REJECT]>  <${url}?action=WATCH|[WATCH]>`);
  }

  if (args.run.warnings.length) {
    L.push("");
    L.push(`_Warnings: ${args.run.warnings.slice(0, 3).join(" · ")}_`);
  }
  L.push(`_Run ${args.run.id}_`);

  return {
    title,
    text: L.join("\n"),
    items: args.items.map((it) => ({
      id: it.opportunity.id,
      domain: it.opportunity.asset_identifier,
      score: it.opportunity.score,
      confidence: it.opportunity.confidence,
      url: `${args.dashboardUrl.replace(/\/$/, "")}/o/${it.opportunity.id}`,
    })),
  };
}

/** Rank recommended evaluations: quality-weighted score, EV tie-break, max N per concept, max total. */
export function rankRecommended<T extends { final_score: number; confidence: number; ev_base_36m: number | null; concept_slug: string }>(
  xs: T[],
  maxTotal: number,
  maxPerConcept: number,
): T[] {
  const sorted = [...xs].sort(
    (a, b) => b.final_score * b.confidence - a.final_score * a.confidence || (b.ev_base_36m ?? -1e9) - (a.ev_base_36m ?? -1e9),
  );
  const perConcept = new Map<string, number>();
  const out: T[] = [];
  for (const x of sorted) {
    if (out.length >= maxTotal) break;
    const n = perConcept.get(x.concept_slug) ?? 0;
    if (n >= maxPerConcept) continue;
    perConcept.set(x.concept_slug, n + 1);
    out.push(x);
  }
  return out;
}
