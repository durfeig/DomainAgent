import { notFound } from "next/navigation";
import { getRepo } from "../../../src/server";
import { dt, usd } from "../../fmt";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const run = await repo.getRun(id);
  if (!run) notFound();
  const events = await repo.runEvents(id);
  const problems = events.filter((e) => e.level === "warn" || e.level === "error");
  const reasons = Object.entries(run.discard_reasons).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <p className="muted"><a href="/runs">← Runs</a></p>
      <h1>Run {dt(run.started_at)} <span className="pill">{run.status}</span> <span className="pill">{run.mode}</span></h1>
      <div className="cards">
        <div className="card"><div className="v">{usd(run.llm_cost_usd)}</div><div className="k">LLM cost</div></div>
        <div className="card"><div className="v">{usd(run.api_cost_usd)}</div><div className="k">API cost</div></div>
        <div className="card"><div className="v">{usd(run.total_cost_usd)}</div><div className="k">Total</div></div>
        <div className="card"><div className="v">{run.tokens_in.toLocaleString()}</div><div className="k">Tokens in</div></div>
        <div className="card"><div className="v">{run.tokens_out.toLocaleString()}</div><div className="k">Tokens out</div></div>
        <div className="card"><div className="v">{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}</div><div className="k">Duration</div></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Funnel</h2>
          <table><tbody>{Object.entries(run.funnel).map(([kk, v]) => <tr key={kk}><td>{kk}</td><td className="num">{Number(v).toLocaleString()}</td></tr>)}</tbody></table>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Discard reasons</h2>
          <table><tbody>{reasons.map(([kk, v]) => <tr key={kk}><td>{kk}</td><td className="num">{v.toLocaleString()}</td></tr>)}</tbody></table>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>API calls</h2>
          <table><tbody>{Object.entries(run.api_calls).map(([kk, v]) => <tr key={kk}><td>{kk}</td><td className="num">{v}</td></tr>)}</tbody></table>
          <p className="muted">Adapters: {Object.entries(run.adapters).map(([a, b]) => `${a}=${b}`).join(" · ")}</p>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Errors &amp; warnings</h2>
          <ul className="tight">
            {[...run.errors.map((x) => `ERROR ${x}`), ...run.warnings.map((x) => `WARN ${x}`)].map((x, i) => <li key={i}>{x}</li>)}
            {problems.map((p) => <li key={p.id}>{p.level.toUpperCase()} {p.stage}/{p.event} {p.data ? JSON.stringify(p.data).slice(0, 200) : ""}</li>)}
          </ul>
        </div>
      </div>
      <h2>Digest</h2>
      <pre>{run.digest_text ?? "—"}</pre>
      <h2>Structured log</h2>
      <details className="panel"><summary>{events.length} events</summary><pre>{events.map((e) => JSON.stringify(e)).join("\n")}</pre></details>
    </>
  );
}
