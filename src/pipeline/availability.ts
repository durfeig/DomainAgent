import type { RegistrarProvider } from "../adapters/registrar";
import type { TableStore } from "../adapters/store";
import type { CostTracker } from "../core/cost";
import type { Logger } from "../core/logger";
import type { AvailabilityResult, DomainCandidate } from "../core/types";
import { chunk, mapLimit } from "../core/util";

export interface AvailabilityStageResult<T> {
  available: (T & { availability: AvailabilityResult })[];
  checked: number;
  cached: number;
  reasonCounts: Record<string, number>;
  errors: string[];
}

/**
 * Real-time availability + price via the registrar adapter (read-only).
 * Negative results are cached for AVAILABILITY_CACHE_DAYS to save calls; positive results are
 * always re-checked because availability can change at any moment.
 */
export async function checkAvailabilityStage<T extends DomainCandidate>(
  cands: T[],
  deps: { registrar: RegistrarProvider; store: TableStore; costs: CostTracker; log: Logger },
  opts: { cacheDays: number; maxAnalysisCost: number; runId: string },
): Promise<AvailabilityStageResult<T>> {
  const { registrar, store, costs, log } = deps;
  const reasonCounts: Record<string, number> = {};
  const errors: string[] = [];
  const bump = (r: string) => (reasonCounts[r] = (reasonCounts[r] ?? 0) + 1);

  const since = new Date(Date.now() - opts.cacheDays * 86400_000).toISOString();
  const cachedRows = cands.length
    ? await store.select<AvailabilityResult & { id: string }>("availability_checks", {
        in: { domain: cands.map((c) => c.domain) },
        eq: { provider: registrar.name, registrable: false },
        gte: { checked_at: since },
      })
    : [];
  const cachedNegative = new Set(cachedRows.map((r) => r.domain));
  const toCheck = cands.filter((c) => !cachedNegative.has(c.domain));
  for (let i = 0; i < cachedNegative.size; i++) bump("UNAVAILABLE_CACHED");

  const results = new Map<string, AvailabilityResult>();
  await mapLimit(chunk(toCheck, registrar.batchSize), 2, async (batch) => {
    try {
      const rs = await registrar.checkAvailability(batch.map((c) => c.domain), costs);
      for (const r of rs) results.set(r.domain, r);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      log.error("availability", "batch_failed", { size: batch.length, error: msg });
      for (const c of batch) bump("CHECK_ERROR");
    }
  });

  if (results.size) {
    await store.upsert(
      "availability_checks",
      [...results.values()].map((r) => ({ ...r, run_id: opts.runId, raw: r.raw ?? null })),
      ["domain", "provider"],
    );
  }

  const available: AvailabilityStageResult<T>["available"] = [];
  for (const c of toCheck) {
    const r = results.get(c.domain);
    if (!r) continue;
    if (!r.registrable) {
      bump("UNAVAILABLE");
      continue;
    }
    if (r.tier && r.tier.toLowerCase().includes("premium")) {
      bump("PREMIUM"); // premium registration is out of scope (not supported by the registrar API beta)
      continue;
    }
    if (r.registration_cost === null) {
      bump("PRICE_UNKNOWN");
      continue;
    }
    if (r.registration_cost > opts.maxAnalysisCost) {
      bump("PRICE_ABOVE_ANALYSIS_CAP");
      continue;
    }
    available.push({ ...c, availability: r });
  }
  log.info("availability", "done", { requested: cands.length, checked: results.size, cached_negative: cachedNegative.size, available: available.length });
  return { available, checked: results.size, cached: cachedNegative.size, reasonCounts, errors };
}
