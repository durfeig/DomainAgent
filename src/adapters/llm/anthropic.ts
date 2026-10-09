import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Config } from "../../config";
import { anthropicCostUsd, type CostTracker } from "../../core/cost";
import { LLMOutputError, LLMRefusalError, type LLMProvider, type LLMRequest, type LLMResult } from "./types";

/**
 * Claude via the official SDK with structured outputs (schema-constrained JSON, validated by Zod).
 * Server-side refusal fallbacks are enabled (`fallbacks: "default"`); a remaining refusal is
 * surfaced as LLMRefusalError and the caller treats it conservatively (no recommendation).
 */
export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";
  readonly mock = false;
  private client: Anthropic;

  constructor(private readonly cfg: Config) {
    if (!cfg.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  }

  async complete<T>(req: LLMRequest<T>, costs: CostTracker): Promise<LLMResult<T>> {
    costs.assertLlmBudget();
    const model = req.tier === "underwriter" ? this.cfg.ANTHROPIC_MODEL_UNDERWRITER : this.cfg.ANTHROPIC_MODEL_FAST;
    const effort = req.tier === "underwriter" ? this.cfg.ANTHROPIC_EFFORT_UNDERWRITER : this.cfg.ANTHROPIC_EFFORT_FAST;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.beta.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.user }],
        output_config: { effort, format: betaZodOutputFormat(req.schema) },
      });

      const servedModel = response.model ?? model;
      const tokensIn =
        (response.usage.input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0);
      const tokensOut = response.usage.output_tokens ?? 0;
      const usd = anthropicCostUsd(servedModel, tokensIn, tokensOut);
      costs.add({
        provider: "anthropic",
        kind: "llm",
        operation: req.task,
        model: servedModel,
        units: 1,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        usd,
        meta: { stop_reason: response.stop_reason, attempt, cache_read: response.usage.cache_read_input_tokens ?? 0 },
      });

      if (response.stop_reason === "refusal") {
        throw new LLMRefusalError(`Model refused ${req.task}`);
      }
      if (response.stop_reason === "max_tokens") {
        lastError = new LLMOutputError(`${req.task}: output truncated (max_tokens)`);
        continue;
      }
      const parsed = req.schema.safeParse(response.parsed_output);
      if (parsed.success) {
        return { data: parsed.data, provider: "anthropic", model: servedModel, tokens_in: tokensIn, tokens_out: tokensOut, usd, mock: false };
      }
      lastError = new LLMOutputError(`${req.task}: schema validation failed: ${parsed.error.message.slice(0, 500)}`);
    }
    throw lastError;
  }
}
