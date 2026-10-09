import type { Config } from "../config";
import type { RegistrarProvider } from "../adapters/registrar";
import { PurchaseBlockedError } from "../adapters/registrar";
import type { Opportunity } from "../core/types";
import { budgetViolations, type BudgetStatus } from "./budget-guard";

/**
 * FUTURE AUTO-TRADER (Phase 2) — DISABLED.
 *
 * Phase-2 rule (from the spec):
 *   score >= 90 AND confidence >= 80 AND trademark = LOW AND cost <= $15 AND budget available
 *   THEN register -> list -> price -> monitor
 *
 * In the MVP we only *evaluate* eligibility (dry run, logged for calibration).
 * Execution is double-locked:
 *   1. AUTO_BUY_ENABLED must be true (default false), AND
 *   2. RegistrarProvider.registerDomain() is not implemented and always throws.
 */
export interface AutoBuyAssessment {
  eligible: boolean;
  reasons: string[];
}

export function assessAutoBuy(
  o: Pick<Opportunity, "score" | "confidence" | "trademark_risk" | "registration_cost" | "mock" | "recommended">,
  budget: BudgetStatus,
  cfg: Config,
): AutoBuyAssessment {
  const reasons: string[] = [];
  if (!o.recommended) reasons.push("not recommended by underwriter");
  if (o.score < cfg.AUTO_BUY_MIN_SCORE) reasons.push(`score ${o.score} < ${cfg.AUTO_BUY_MIN_SCORE}`);
  if (o.confidence < cfg.AUTO_BUY_MIN_CONFIDENCE) reasons.push(`confidence ${o.confidence} < ${cfg.AUTO_BUY_MIN_CONFIDENCE}`);
  if (o.trademark_risk !== "LOW") reasons.push(`trademark ${o.trademark_risk}`);
  if (o.mock) reasons.push("mock data");
  reasons.push(...budgetViolations(o.registration_cost, budget));
  return { eligible: reasons.length === 0, reasons };
}

export async function executeAutoBuy(
  o: Opportunity,
  assessment: AutoBuyAssessment,
  registrar: RegistrarProvider,
  cfg: Config,
): Promise<never> {
  if (!cfg.AUTO_BUY_ENABLED) throw new PurchaseBlockedError(o.asset_identifier, "AUTO_BUY_ENABLED=false");
  if (!assessment.eligible) throw new PurchaseBlockedError(o.asset_identifier, `not eligible: ${assessment.reasons.join("; ")}`);
  // Even with the flag on, the MVP registrar refuses to register (see adapters/registrar).
  return registrar.registerDomain({
    domain: o.asset_identifier,
    years: 1,
    acknowledged_price: o.registration_cost ?? 0,
    approved_by: "auto-trader",
    opportunity_id: o.id,
  });
}
