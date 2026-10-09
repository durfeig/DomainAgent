import { getRepo } from "../src/server";
import type { Concept, OpportunityStatus } from "../src/core/types";
import { dt, k, usd } from "./fmt";

export const dynamic = "force-dynamic";

const FILTERS: (OpportunityStatus | "ALL")[] = ["NEW", "WATCH", "APPROVED", "REJECTED", "BOUGHT", "ARCHIVED", "ALL"];

export default async function Home({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (FILTERS.includes((sp.status ?? "NEW").toUpperCase() as OpportunityStatus) ? (sp.status ?? "NEW").toUpperCase() : "NEW") as OpportunityStatus | "ALL";
  const repo = getRepo();
  const [stats, opps, concepts] = await Promise.all([
    repo.stats(),
    repo.listOpportunities({ status }),
    repo.store.select<Concept>("concepts", { limit: 1000 }),
  ]);
  const conceptName = new Map(concepts.map((c) => [c.id, c.name]));
  const sorted = [...opps].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score * b.confidence - a.score * a.confidence);

  return (
    <>
      <h1>Opportunities</h1>
      {stats.last_run?.mode && stats.last_run.mode !== "live" && (
        <div className="banner">Last run was in {stats.last_run.mode.toUpperCase()} mode — synthetic data present. Do not act on mock rows.</div>
      )}
      <div className="cards">
        <div className="card"><div className="v">{usd(stats.capital_deployed)}</div><div className="k">Capital deployed</div></div>
        <div className="card"><div className="v">{stats.opportunities_analyzed}</div><div className="k">Opportunities analyzed</div></div>
        <div className="card"><div className="v">{stats.active}</div><div className="k">Active (new + watch)</div></div>
        <div className="card"><div className="v">{stats.approved}</div><div className="k">Approved</div></div>
        <div className="card"><div className="v">{stats.rejected}</div><div className="k">Rejected</div></div>
        <div className="card"><div className="v">{usd(stats.total_run_cost)}</div><div className="k">Total run cost ({stats.runs} runs)</div></div>
      </div>
      <p className="muted">Last run: {stats.last_run ? <a href={`/runs/${stats.last_run.id}`}>{dt(stats.last_run.started_at)} · {stats.last_run.status}</a> : "none yet — run `npm run scout`"}</p>

      <div className="tabs">
        {FILTERS.map((f) => (
          <a key={f} href={`/?status=${f}`} className={f === status ? "on" : ""}>{f === "ARCHIVED" ? "ANALYZED (not surfaced)" : f}</a>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Domain</th><th>Concept</th><th className="num">Score</th><th className="num">Conf.</th>
              <th className="num">Cost</th><th className="num">Renewal</th><th className="num">Est. value</th><th className="num">EV 36m</th><th>TM</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={11} className="muted">Nothing here. Few opportunities is the expected state — the underwriter is built to say no.</td></tr>
            )}
            {sorted.map((o) => (
              <tr key={o.id}>
                <td className="muted">{o.rank ?? ""}</td>
                <td><a href={`/o/${o.id}`}><b>{o.asset_identifier}</b></a>{o.mock && <span className="pill" style={{ marginLeft: 6 }}>mock</span>}</td>
                <td>{(o.concept_id && conceptName.get(o.concept_id)) || "—"}</td>
                <td className="num"><b>{o.score}</b></td>
                <td className="num">{o.confidence}</td>
                <td className="num">{usd(o.registration_cost)}</td>
                <td className="num">{usd(o.renewal_cost)}</td>
                <td className="num">{o.estimated_value_low !== null ? `${k(o.estimated_value_low)}–${k(o.estimated_value_high)}` : "—"}</td>
                <td className="num">{usd(o.ev_base_36m)}</td>
                <td className={`tm-${o.trademark_risk}`}>{o.trademark_risk}</td>
                <td className={`s-${o.status}`}>{o.status}{o.recommended ? "" : <span className="muted"> · not rec.</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
