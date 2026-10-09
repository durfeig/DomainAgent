import { getConfig, getRepo } from "../../../../../src/server";
import { DecisionInputSchema } from "../../../../../src/core/schemas";

export const dynamic = "force-dynamic";

/**
 * Record a decision (feedback loop). Accepts JSON (n8n / scripts) or a form post (dashboard).
 * BUY only records a purchase executed manually by a human — nothing is registered here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isForm = (req.headers.get("content-type") ?? "").includes("form");
  const raw = isForm ? Object.fromEntries((await req.formData()).entries()) : await req.json().catch(() => ({}));
  const parsed = DecisionInputSchema.safeParse({
    ...raw,
    acquisition_cost: raw.acquisition_cost === undefined || raw.acquisition_cost === "" ? undefined : Number(raw.acquisition_cost),
  });
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  try {
    const decision = await getRepo().recordDecision(id, parsed.data, getConfig().DECISION_ACTOR);
    if (isForm) return Response.redirect(new URL(`/o/${id}?saved=${decision.action}`, req.url), 303);
    return Response.json(decision);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
