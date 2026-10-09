import { getRepo } from "../../src/server";
import { dt, usd } from "../fmt";

export const dynamic = "force-dynamic";

export default async function Runs() {
  const runs = await getRepo().listRuns(50);
  return (
    <>
      <h1>Runs</h1>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Started</th><th>Status</th><th>Mode</th><th className="num">Signals</th><th className="num">Generated</th><th className="num">Checked</th>
              <th className="num">Available</th><th className="num">Underwritten</th><th className="num">Passed</th><th className="num">Surfaced</th>
              <th className="num">LLM</th><th className="num">API</th><th className="num">Total</th><th className="num">Tokens in/out</th><th className="num">Duration</th><th className="num">Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><a href={`/runs/${r.id}`}>{dt(r.started_at)}</a></td>
                <td>{r.status}</td>
                <td>{r.mode}</td>
                <td className="num">{r.funnel.signals ?? 0}</td>
                <td className="num">{(r.funnel.generated ?? 0).toLocaleString()}</td>
                <td className="num">{r.funnel.availability_checked ?? 0}</td>
                <td className="num">{r.funnel.available ?? 0}</td>
                <td className="num">{r.funnel.underwritten ?? 0}</td>
                <td className="num">{r.funnel.recommended ?? 0}</td>
                <td className="num"><b>{r.funnel.surfaced ?? 0}</b></td>
                <td className="num">{usd(r.llm_cost_usd)}</td>
                <td className="num">{usd(r.api_cost_usd)}</td>
                <td className="num">{usd(r.total_cost_usd)}</td>
                <td className="num">{r.tokens_in.toLocaleString()} / {r.tokens_out.toLocaleString()}</td>
                <td className="num">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                <td className="num">{r.errors.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
