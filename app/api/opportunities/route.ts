import { getRepo } from "../../../src/server";
import type { OpportunityStatus } from "../../../src/core/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = (new URL(req.url).searchParams.get("status") ?? "ALL").toUpperCase() as OpportunityStatus | "ALL";
  return Response.json(await getRepo().listOpportunities({ status }));
}
