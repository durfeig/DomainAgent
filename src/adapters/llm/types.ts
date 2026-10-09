import type { z } from "zod";
import type { CostTracker } from "../../core/cost";

export type LLMTask = "concept_extraction" | "domain_lexicon" | "underwriting";
export type LLMTier = "fast" | "underwriter";

export interface LLMRequest<T> {
  task: LLMTask;
  tier: LLMTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Deterministic heuristic used by the mock provider (no network, no cost). */
  mockResponse: () => T;
}

export interface LLMResult<T> {
  data: T;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  usd: number | null;
  mock: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly mock: boolean;
  complete<T>(req: LLMRequest<T>, costs: CostTracker): Promise<LLMResult<T>>;
}

export class LLMRefusalError extends Error {}
export class LLMOutputError extends Error {}
