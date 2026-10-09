import type { CostTracker } from "../../core/cost";
import type { AvailabilityResult } from "../../core/types";
import { hashUnit, nowIso } from "../../core/util";
import { PurchaseBlockedError, type PriceQuote, type RegisterRequest, type RegistrarProvider } from "./types";

/**
 * Deterministic offline registrar. Availability and prices are SYNTHETIC (mock=true on every row)
 * and exist only to exercise the pipeline without credentials.
 */
const MOCK_PRICES: Record<string, { reg: number; renew: number }> = {
  com: { reg: 10.5, renew: 10.5 },
  ai: { reg: 80, renew: 80 },
  io: { reg: 50, renew: 50 },
  co: { reg: 25, renew: 25 },
};

export class MockRegistrar implements RegistrarProvider {
  readonly name = "mock";
  readonly sandbox = true;
  readonly mock = true;
  readonly batchSize = 20;

  async checkAvailability(domains: string[], costs: CostTracker): Promise<AvailabilityResult[]> {
    costs.call("mock", "domain-check", 1, 0);
    const ts = nowIso();
    return domains.map((domain) => {
      const [sld, tld] = domain.split(".");
      const base = tld === "com" ? 0.03 : tld === "ai" ? 0.1 : 0.2;
      const lengthBoost = sld.length >= 12 ? 3 : sld.length >= 9 ? 2 : 1;
      const registrable = hashUnit(`avail:${domain}`) < base * lengthBoost;
      const premium = registrable && hashUnit(`prem:${domain}`) < 0.05;
      const price = MOCK_PRICES[tld] ?? { reg: 30, renew: 30 };
      return {
        domain,
        provider: "mock",
        sandbox: true,
        mock: true,
        registrable,
        reason: registrable ? null : "domain_unavailable",
        tier: registrable ? (premium ? "premium" : "standard") : null,
        currency: registrable ? "USD" : null,
        registration_cost: registrable ? (premium ? 2500 : price.reg) : null,
        renewal_cost: registrable ? price.renew : null,
        registrar: "mock",
        checked_at: ts,
      };
    });
  }

  async getPrice(domain: string, costs: CostTracker): Promise<PriceQuote | null> {
    const [r] = await this.checkAvailability([domain], costs);
    return r.registrable ? { domain, currency: r.currency, registration_cost: r.registration_cost, renewal_cost: r.renewal_cost, tier: r.tier } : null;
  }

  async registerDomain(req: RegisterRequest): Promise<never> {
    throw new PurchaseBlockedError(req.domain, "mock registrar never registers domains");
  }
}
