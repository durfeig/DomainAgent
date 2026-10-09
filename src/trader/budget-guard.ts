import type { Config } from "../config";
import type { PositionRow } from "../core/repo";

/**
 * Budget guard (prepared for Phase 2). Pure function over recorded positions so it can be
 * unit-tested and reused by the auto-trader and by the dashboard. It never spends anything.
 */
export interface BudgetStatus {
  monthly_budget: number;
  spent_this_month: number;
  remaining_this_month: number;
  assets_today: number;
  assets_this_month: number;
  max_asset_cost: number;
  max_daily_assets: number;
  max_monthly_assets: number;
}

export function budgetStatus(positions: Pick<PositionRow, "acquired_at" | "acquisition_cost">[], cfg: Config, now = new Date()): BudgetStatus {
  const month = now.toISOString().slice(0, 7);
  const day = now.toISOString().slice(0, 10);
  const thisMonth = positions.filter((p) => p.acquired_at.slice(0, 7) === month);
  const spent = thisMonth.reduce((s, p) => s + (p.acquisition_cost ?? 0), 0);
  return {
    monthly_budget: cfg.MONTHLY_BUDGET,
    spent_this_month: Math.round(spent * 100) / 100,
    remaining_this_month: Math.round((cfg.MONTHLY_BUDGET - spent) * 100) / 100,
    assets_today: positions.filter((p) => p.acquired_at.slice(0, 10) === day).length,
    assets_this_month: thisMonth.length,
    max_asset_cost: cfg.MAX_ASSET_COST,
    max_daily_assets: cfg.MAX_DAILY_ASSETS,
    max_monthly_assets: cfg.MAX_MONTHLY_ASSETS,
  };
}

/** Would buying an asset of `cost` respect every budget limit? Returns the list of violations. */
export function budgetViolations(cost: number | null, b: BudgetStatus): string[] {
  const v: string[] = [];
  if (cost === null) v.push("unknown cost");
  else {
    if (cost > b.max_asset_cost) v.push(`cost $${cost} > max_asset_cost $${b.max_asset_cost}`);
    if (cost > b.remaining_this_month) v.push(`cost $${cost} > remaining monthly budget $${b.remaining_this_month}`);
  }
  if (b.assets_today >= b.max_daily_assets) v.push(`daily asset limit reached (${b.max_daily_assets})`);
  if (b.assets_this_month >= b.max_monthly_assets) v.push(`monthly asset limit reached (${b.max_monthly_assets})`);
  return v;
}
