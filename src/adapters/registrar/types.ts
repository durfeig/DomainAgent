import type { CostTracker } from "../../core/cost";
import type { AvailabilityResult } from "../../core/types";

export interface PriceQuote {
  domain: string;
  currency: string | null;
  registration_cost: number | null;
  renewal_cost: number | null;
  tier: string | null;
}

export interface RegisterRequest {
  domain: string;
  years: number;
  /** Echo of the quoted price, as an explicit fee acknowledgement (required by Cloudflare for premium). */
  acknowledged_price: number;
  approved_by: string;
  opportunity_id: string;
}

export class PurchaseBlockedError extends Error {
  constructor(domain: string, why: string) {
    super(`registerDomain(${domain}) blocked: ${why}`);
  }
}

/**
 * Registrar abstraction. checkAvailability/getPrice are read-only.
 * registerDomain is intentionally blocked in the Analyst MVP (see src/trader/auto-trader.ts).
 */
export interface RegistrarProvider {
  readonly name: string;
  readonly sandbox: boolean;
  readonly mock: boolean;
  /** Max domains per request supported by the backend. */
  readonly batchSize: number;
  checkAvailability(domains: string[], costs: CostTracker): Promise<AvailabilityResult[]>;
  getPrice(domain: string, costs: CostTracker): Promise<PriceQuote | null>;
  registerDomain(req: RegisterRequest): Promise<never>;
}
