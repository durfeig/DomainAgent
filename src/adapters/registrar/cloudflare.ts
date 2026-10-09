import type { CostTracker } from "../../core/cost";
import type { AvailabilityResult } from "../../core/types";
import { fetchJson, nowIso } from "../../core/util";
import { PurchaseBlockedError, type PriceQuote, type RegisterRequest, type RegistrarProvider } from "./types";

/**
 * Cloudflare Registrar API (beta, 2026).
 *   POST /accounts/{account_id}/registrar/domain-check          (live, read-only, real-time registry check)
 *   POST /accounts/{account_id}/registrar-sandbox/domain-check  (sandbox, for development)
 * Body: { "domains": ["example.com", ...] } — up to 20 per request.
 * Result: result.domains[] = { name, registrable, reason?, tier?, pricing?: { currency, registration_cost, renewal_cost } }
 * `pricing` is only present when registrable=true. Prices are strings.
 * Premium names are not registrable through the API (beta): we exclude them.
 */
export class CloudflareRegistrar implements RegistrarProvider {
  readonly name: string;
  readonly mock = false;
  readonly batchSize = 20;

  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    readonly sandbox: boolean,
  ) {
    this.name = sandbox ? "cloudflare_sandbox" : "cloudflare";
  }

  private get base() {
    const segment = this.sandbox ? "registrar-sandbox" : "registrar";
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/${segment}`;
  }

  async checkAvailability(domains: string[], costs: CostTracker): Promise<AvailabilityResult[]> {
    if (domains.length === 0) return [];
    if (domains.length > this.batchSize) throw new Error(`Cloudflare domain-check accepts at most ${this.batchSize} domains per request`);
    const body = await fetchJson<unknown>(`${this.base}/domain-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ domains }),
      timeoutMs: 30_000,
    });
    costs.call(this.name, "domain-check", 1, 0, { domains: domains.length });
    return parseCloudflareCheck(body, domains, { provider: this.name, sandbox: this.sandbox });
  }

  async getPrice(domain: string, costs: CostTracker): Promise<PriceQuote | null> {
    const [r] = await this.checkAvailability([domain], costs);
    if (!r || !r.registrable) return null;
    return { domain, currency: r.currency, registration_cost: r.registration_cost, renewal_cost: r.renewal_cost, tier: r.tier };
  }

  async registerDomain(req: RegisterRequest): Promise<never> {
    throw new PurchaseBlockedError(req.domain, "Analyst MVP: registration is not implemented. See docs/BACKLOG.md (Phase 2).");
  }
}

interface CfDomain {
  name?: string;
  registrable?: boolean;
  reason?: string | null;
  tier?: string | null;
  pricing?: { currency?: string; registration_cost?: string | number; renewal_cost?: string | number } | null;
}

/** Defensive parser: tolerates `result` being an array or `{ domains: [...] }`. Unknown fields -> null. */
export function parseCloudflareCheck(
  body: unknown,
  requested: string[],
  meta: { provider: string; sandbox: boolean },
): AvailabilityResult[] {
  const b = body as { success?: boolean; errors?: unknown[]; result?: unknown };
  if (b && b.success === false) {
    throw new Error(`Cloudflare domain-check error: ${JSON.stringify(b.errors ?? []).slice(0, 300)}`);
  }
  const list: CfDomain[] = Array.isArray(b?.result)
    ? (b.result as CfDomain[])
    : Array.isArray((b?.result as { domains?: unknown })?.domains)
      ? ((b.result as { domains: CfDomain[] }).domains)
      : [];
  const byName = new Map(list.filter((d) => d.name).map((d) => [d.name!.toLowerCase(), d]));
  const ts = nowIso();
  return requested.map((domain) => {
    const d = byName.get(domain.toLowerCase());
    if (!d) {
      return {
        domain, provider: meta.provider, sandbox: meta.sandbox, mock: false, registrable: false,
        reason: "missing_from_response", tier: null, currency: null, registration_cost: null, renewal_cost: null,
        registrar: "cloudflare", checked_at: ts,
      };
    }
    const toNum = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const registrable = d.registrable === true;
    return {
      domain,
      provider: meta.provider,
      sandbox: meta.sandbox,
      mock: false,
      registrable,
      reason: registrable ? null : (d.reason ?? "not_registrable"),
      tier: d.tier ?? null,
      currency: d.pricing?.currency ?? null,
      registration_cost: registrable ? toNum(d.pricing?.registration_cost) : null,
      renewal_cost: registrable ? toNum(d.pricing?.renewal_cost) : null,
      registrar: "cloudflare",
      checked_at: ts,
      raw: d,
    };
  });
}
