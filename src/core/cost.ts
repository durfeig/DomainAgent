/**
 * Cost tracking per run: LLM tokens/USD and external API calls/USD.
 * Prices for Anthropic come from the published per-MTok rates (see PRICING below);
 * anything we don't know is recorded as null USD rather than guessed.
 */

export interface CostEntry {
  provider: string; // anthropic | openai | cloudflare | namebio | github | ...
  kind: "llm" | "api";
  operation: string;
  model?: string | null;
  units: number; // api calls or 1 per LLM call
  tokens_in: number;
  tokens_out: number;
  usd: number | null; // null = unknown price (e.g. NameBio credit price not configured)
  meta?: Record<string, unknown>;
}

/** USD per 1M tokens (input, output). Source: Anthropic pricing table as of 2026-10. */
export const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export class BudgetExceededError extends Error {}

export class CostTracker {
  readonly entries: CostEntry[] = [];
  readonly apiCalls: Record<string, number> = {};

  constructor(private readonly llmBudgetUsd: number = Infinity) {}

  add(e: CostEntry) {
    this.entries.push(e);
    const key = `${e.provider}:${e.operation}`;
    this.apiCalls[key] = (this.apiCalls[key] ?? 0) + e.units;
  }

  /** Count an external API call with no known USD cost (free tiers, unknown pricing). */
  call(provider: string, operation: string, n = 1, usd: number | null = 0, meta?: Record<string, unknown>) {
    this.add({ provider, kind: "api", operation, units: n, tokens_in: 0, tokens_out: 0, usd, meta });
  }

  get llmUsd() {
    return round(this.entries.filter((e) => e.kind === "llm").reduce((s, e) => s + (e.usd ?? 0), 0));
  }
  get apiUsd() {
    return round(this.entries.filter((e) => e.kind === "api").reduce((s, e) => s + (e.usd ?? 0), 0));
  }
  get totalUsd() {
    return round(this.llmUsd + this.apiUsd);
  }
  get tokensIn() {
    return this.entries.reduce((s, e) => s + e.tokens_in, 0);
  }
  get tokensOut() {
    return this.entries.reduce((s, e) => s + e.tokens_out, 0);
  }
  get unknownPriceEntries() {
    return this.entries.filter((e) => e.usd === null).length;
  }

  /** Throws before an LLM call if the run already spent its LLM budget. */
  assertLlmBudget() {
    if (this.llmUsd >= this.llmBudgetUsd) {
      throw new BudgetExceededError(`Run LLM budget exhausted: $${this.llmUsd} >= $${this.llmBudgetUsd}`);
    }
  }
}

export function anthropicCostUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = ANTHROPIC_PRICING[model];
  if (!p) return null;
  return round((tokensIn * p.input + tokensOut * p.output) / 1_000_000, 6);
}

export function round(n: number, d = 4) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
