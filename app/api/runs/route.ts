import { getConfig, getRepo } from "../../../src/server";
import { runScout } from "../../../src/pipeline/run";

export const dynamic = "force-dynamic";
// A live run (sources + LLM + ~20 registrar calls + underwriting) usually fits well under this.
export const maxDuration = 300;

/** RUN SCOUT. Called by n8n on a schedule (Bearer API_SECRET) or manually. Never buys anything. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { trigger?: string };
  try {
    const result = await runScout(getConfig(), { trigger: body.trigger ?? "api" });
    return Response.json({
      run_id: result.run.id,
      status: result.run.status,
      mode: result.run.mode,
      funnel: result.run.funnel,
      costs: { llm_usd: result.run.llm_cost_usd, api_usd: result.run.api_cost_usd, total_usd: result.run.total_cost_usd },
      warnings: result.run.warnings,
      errors: result.run.errors,
      opportunities: result.digest.items,
      digest_title: result.digest.title,
      digest_text: result.digest.text,
    });
  } catch (e) {
    return Response.json({ status: "failed", error: (e as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const runs = await getRepo().listRuns(30);
  return Response.json(runs.map(({ config: _c, digest_text: _d, ...r }) => r));
}
