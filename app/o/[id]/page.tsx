import { notFound } from "next/navigation";
import { getRepo } from "../../../src/server";
import { COMPONENTS, type Evaluation, type Horizon, type Scenario } from "../../../src/core/types";
import { WEIGHTS } from "../../../src/pipeline/scoring";
import { dt, k, usd } from "../../fmt";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getRepo().opportunityDetail(id);
  if (!detail) notFound();
  const { opportunity: o, evaluations, decisions, concept, signals } = detail;
  const e = evaluations[0] as Evaluation | undefined;
  const pre = (sp.action ?? "").toUpperCase();
  const factById = new Map((e?.facts ?? []).map((f) => [f.id, f]));
  const comps = (e?.facts ?? []).filter((f) => f.category === "comparable_sale" || f.category === "comps_summary" || f.category === "keyword_stats");

  return (
    <>
      <p className="muted"><a href="/">← Opportunities</a></p>
      <h1>
        {o.asset_identifier} <span className={`pill s-${o.status}`}>{o.status}</span>{" "}
        {o.rank ? <span className="pill">rank #{o.rank}</span> : null}
      </h1>
      {o.mock && <div className="banner">MOCK DATA — availability, prices, comparables and/or trend evidence are synthetic. Do not act on this row.</div>}
      {sp.saved && <div className="ok">Decision saved: {sp.saved}</div>}

      <div className="cards">
        <div className="card"><div className="v">{o.score}</div><div className="k">Score</div></div>
        <div className="card"><div className="v">{o.confidence}</div><div className="k">Confidence (independent)</div></div>
        <div className="card"><div className="v">{usd(o.registration_cost)}</div><div className="k">Registration</div></div>
        <div className="card"><div className="v">{usd(o.renewal_cost)}</div><div className="k">Renewal / yr</div></div>
        <div className="card"><div className="v">{o.estimated_value_low !== null ? `${k(o.estimated_value_low)}–${k(o.estimated_value_high)}` : "—"}</div><div className="k">Retail (ESTIMATE)</div></div>
        <div className="card"><div className={`v tm-${o.trademark_risk}`}>{o.trademark_risk}</div><div className="k">Trademark risk</div></div>
      </div>

      <h2>Decision</h2>
      <div className="panel">
        <form method="post" action={`/api/opportunities/${o.id}/decision`} className="actions">
          <input type="text" name="reason" placeholder="Reason (optional, used for calibration)" />
          <button name="action" value="APPROVE" className={`approve ${pre === "APPROVE" ? "pre" : ""}`}>Approve</button>
          <button name="action" value="REJECT" className={`reject ${pre === "REJECT" ? "pre" : ""}`}>Reject</button>
          <button name="action" value="WATCH" className={`watch ${pre === "WATCH" ? "pre" : ""}`}>Watch</button>
        </form>
        <details style={{ marginTop: 10 }}>
          <summary className="muted">I bought it manually (record a BUY — the system never registers domains)</summary>
          <form method="post" action={`/api/opportunities/${o.id}/decision`} className="actions" style={{ marginTop: 8 }}>
            <input type="number" step="0.01" name="acquisition_cost" placeholder="Price paid (USD)" required />
            <input type="text" name="reason" placeholder="Where / notes" />
            <button name="action" value="BUY">Record BUY</button>
          </form>
        </details>
        {decisions.length > 0 && (
          <ul className="tight">
            {decisions.map((d) => (
              <li key={d.id}>{dt(d.created_at)} — <b>{d.actor}</b> {d.action}{d.reason ? `: ${d.reason}` : ""}</li>
            ))}
          </ul>
        )}
      </div>

      {!e ? (
        <p className="muted">No evaluation stored.</p>
      ) : (
        <>
          <div className="grid2">
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Thesis</h2>
              <p>{e.thesis || "—"}</p>
              <p><b>Why now:</b> {e.why_now || "—"}</p>
              <p><b>Potential buyers:</b> {e.potential_buyers.join(", ") || "—"}</p>
              <p className="muted">Underwriter {e.underwriter_version} · model {e.model} · {dt(e.created_at)}</p>
            </div>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Verdict</h2>
              {e.recommended ? <div className="ok">Passed every hard rule.</div> : (
                <>
                  <p>Not recommended:</p>
                  <ul className="tight">{e.rejection_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </>
              )}
              <p className="muted">Confidence: LLM {e.confidence_llm ?? "—"} · data-coverage cap {e.confidence_cap} · final {e.confidence}</p>
            </div>
          </div>

          <h2>Scoring</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Component</th><th className="num">Weight</th><th className="num">Deterministic</th><th className="num">LLM</th><th className="num">Final</th></tr></thead>
              <tbody>
                {COMPONENTS.map((c) => (
                  <tr key={c}>
                    <td>{c.replace(/_/g, " ")}</td>
                    <td className="num">{Math.round(WEIGHTS[c] * 100)}%</td>
                    <td className="num">{e.components_deterministic[c] ?? "—"}</td>
                    <td className="num">{e.components_llm?.[c] ?? "—"}</td>
                    <td className="num"><b>{e.components[c]}</b></td>
                  </tr>
                ))}
                <tr><td>weighted</td><td /><td /><td /><td className="num">{e.weighted_score}</td></tr>
                <tr><td>trademark penalty ({e.trademark_risk})</td><td /><td /><td /><td className="num">{e.trademark_penalty}</td></tr>
                <tr><td><b>final score</b></td><td /><td /><td /><td className="num"><b>{e.final_score}</b></td></tr>
              </tbody>
            </table>
          </div>

          <h2>Expected value <span className="kind kind-ESTIMATE">ESTIMATE</span></h2>
          {e.ev ? (
            <>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Scenario</th><th className="num">Sell-through / yr</th>{(["12m", "24m", "36m"] as Horizon[]).map((h) => <th key={h} className="num">EV {h} (P sale)</th>)}</tr></thead>
                  <tbody>
                    {(["bear", "base", "bull"] as Scenario[]).map((s) => (
                      <tr key={s}>
                        <td>{s} — sale {k(e.ev!.scenarios[s]["12m"].sale_price)}</td>
                        <td className="num">{(e.ev!.assumptions.sell_through_annual[s] * 100).toFixed(2)}%</td>
                        {(["12m", "24m", "36m"] as Horizon[]).map((h) => (
                          <td key={h} className="num">{usd(e.ev!.scenarios[s][h].ev)} <span className="muted">({(e.ev!.scenarios[s][h].p_sale * 100).toFixed(1)}%)</span></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">{e.ev.assumptions.note} Marketplace fee {Math.round(e.ev.assumptions.marketplace_fee_pct * 100)}%.</p>
            </>
          ) : <p className="muted">Not computed (no retail estimate — insufficient evidence).</p>}
          {e.retail_estimate && <p className="muted">Retail basis: {e.retail_estimate.basis}</p>}

          <div className="grid2">
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Evidence (underwriter claims)</h2>
              <ul className="tight">
                {e.evidence.map((x, i) => (
                  <li key={i}>
                    <span className={`kind kind-${x.type}`}>{x.type}</span>{x.claim}{" "}
                    {x.fact_ids.map((fid) => {
                      const f = factById.get(fid);
                      return f?.source_url?.startsWith("http") ? <a key={fid} href={f.source_url} target="_blank" rel="noreferrer">[{fid}]</a> : <span key={fid} className="muted">[{fid}]</span>;
                    })}
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Risks</h2>
              <ul className="tight">
                {e.risks.map((r, i) => <li key={i}><span className={`tm-${r.severity}`}>{r.severity}</span> — {r.risk}</li>)}
              </ul>
            </div>
          </div>

          <h2>Market data &amp; comparables <span className="kind kind-FACT">FACT</span></h2>
          <div className="panel">
            {comps.length ? (
              <ul className="tight">{comps.map((f) => <li key={f.id}><span className="muted">{f.id}</span> {f.claim} {f.mock && <span className="pill">mock</span>}</li>)}</ul>
            ) : <p className="muted">No market data (NULL). Confidence was capped accordingly.</p>}
          </div>

          <h2>Fact sheet given to the underwriter</h2>
          <div className="panel">
            <ul className="tight">
              {e.facts.map((f) => (
                <li key={f.id}>
                  <span className="muted">{f.id} [{f.category}]</span> {f.claim}{" "}
                  {f.source_url?.startsWith("http") && <a href={f.source_url} target="_blank" rel="noreferrer">source</a>}
                  {f.mock && <span className="pill">mock</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {concept && (
        <>
          <h2>Trend: {concept.name}</h2>
          <div className="panel">
            <p>{concept.commercial_rationale}</p>
            <p className="muted">
              Durability {concept.durability} ({concept.durability_reason}) · momentum {concept.momentum ?? "unknown"} · {concept.frequency} signals ·
              sources {concept.sources.join(", ")} · first seen {dt(concept.first_seen_at)}
            </p>
            <ul className="tight">
              {signals.slice(0, 15).map((s) => (
                <li key={s.id}>
                  <span className="muted">{s.source} · {s.published_at.slice(0, 10)}</span>{" "}
                  {s.source_url.startsWith("http") ? <a href={s.source_url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
                  {s.mock && <span className="pill">mock</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Raw data</h2>
      <details className="panel">
        <summary>Opportunity, latest evaluation and LLM output (JSON)</summary>
        <pre>{JSON.stringify({ opportunity: o, evaluation: e ?? null }, null, 2)}</pre>
      </details>
    </>
  );
}
