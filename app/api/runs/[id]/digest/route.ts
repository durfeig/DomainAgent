import { getRepo } from "../../../../../src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = id === "latest" ? (await getRepo().listRuns(1))[0] : await getRepo().getRun(id);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ run_id: run.id, status: run.status, mode: run.mode, funnel: run.funnel, digest_text: run.digest_text });
}
