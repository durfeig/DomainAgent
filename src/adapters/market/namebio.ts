import type { CostTracker } from "../../core/cost";
import type { ComparableSale } from "../../core/types";
import { round } from "../../core/cost";
import { fetchJson } from "../../core/util";
import type { CompsResult, MarketDataProvider } from "./types";

/**
 * NameBio API — Comps endpoint (paid, 25 credits/call, Business members on request).
 * Docs: https://api.namebio.com/docs/
 *   URL: https://api.namebio.com/comps/   params: email, key, domain (CamelCase recommended),
 *   price_from (default/min 1000), price_to, order_by (price|date), order_dir, months_old, match_sld_any_tld
 * NOTE: the response field names were not verifiable from this environment, so the parser below
 * is defensive and anything it cannot read becomes null — never a guessed number.
 * NOTE: because price_from has a floor of $1,000, comps are CONDITIONAL on a ≥$1k sale.
 */
export class NameBioMarket implements MarketDataProvider {
  readonly name = "namebio";
  readonly mock = false;
  private calls = 0;

  constructor(
    private readonly email: string,
    private readonly apiKey: string,
    private readonly opts: { maxCallsPerRun: number; monthsOld: number; usdPerCredit: number | null },
  ) {}

  async getComps(domain: string, parts: string[], costs: CostTracker): Promise<CompsResult> {
    if (this.calls >= this.opts.maxCallsPerRun) {
      return { comps: null, credits_used: 0, credits_remaining: null, notes: ["namebio call cap reached for this run"], error: null };
    }
    this.calls++;
    const camel = camelCaseDomain(domain, parts);
    const form = new URLSearchParams({
      email: this.email,
      key: this.apiKey,
      domain: camel,
      order_by: "date",
      order_dir: "desc",
      months_old: String(this.opts.monthsOld),
      match_sld_any_tld: "false",
    });
    try {
      const body = await fetchJson<unknown>("https://api.namebio.com/comps/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        timeoutMs: 30_000,
        retries: 1,
      });
      const credits = 25;
      costs.call("namebio", "comps", 1, this.opts.usdPerCredit === null ? null : round(credits * this.opts.usdPerCredit), { credits });
      const parsed = parseNameBioComps(body);
      return { ...parsed, credits_used: credits };
    } catch (e) {
      costs.call("namebio", "comps_error", 1, 0);
      return { comps: null, credits_used: 0, credits_remaining: null, notes: [], error: (e as Error).message };
    }
  }
}

export function camelCaseDomain(domain: string, parts: string[]): string {
  const [sld, ...rest] = domain.split(".");
  if (parts.length > 0 && parts.join("") === sld) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") + "." + rest.join(".");
  }
  return sld.charAt(0).toUpperCase() + sld.slice(1) + "." + rest.join(".");
}

/** Defensive parser for the comps response. Unknown shapes -> comps: null with an explanatory note. */
export function parseNameBioComps(body: unknown): Omit<CompsResult, "credits_used"> {
  const notes: string[] = [];
  const b = body as Record<string, unknown> | unknown[] | null;
  if (!b) return { comps: null, credits_remaining: null, notes: ["empty response"], error: "empty response" };

  const obj = Array.isArray(b) ? {} : (b as Record<string, unknown>);
  const status = String(obj.status ?? "").toLowerCase();
  if (status === "error" || obj.error) {
    return { comps: null, credits_remaining: num(obj.credits_remaining), notes, error: String(obj.status_message ?? obj.error ?? "namebio error") };
  }
  const arr: unknown[] | undefined = Array.isArray(b)
    ? b
    : (["comps", "results", "sales", "data"].map((k) => obj[k]).find((v) => Array.isArray(v)) as unknown[] | undefined);
  if (!arr) {
    return { comps: null, credits_remaining: num(obj.credits_remaining), notes: ["unrecognized response shape; comps set to null"], error: null };
  }
  const comps: ComparableSale[] = [];
  for (const item of arr) {
    const r = item as Record<string, unknown>;
    const domain = str(r.domain ?? r.name ?? r.domain_name);
    const price = num(r.price ?? r.amount ?? r.sale_price);
    if (!domain || price === null) continue; // incomplete rows are dropped, not patched
    comps.push({
      domain: domain.toLowerCase(),
      price,
      currency: str(r.currency) ?? "USD",
      date: str(r.date ?? r.sale_date ?? r.date_sold),
      venue: str(r.venue ?? r.marketplace),
      source: "namebio",
      source_url: `https://namebio.com/${encodeURIComponent(domain.toLowerCase())}`,
    });
  }
  if (arr.length > 0 && comps.length === 0) notes.push("rows present but no parsable domain/price fields");
  return { comps, credits_remaining: num(obj.credits_remaining), notes, error: null };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
