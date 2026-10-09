import { z } from "zod";
import type { Config } from "../../config";
import { round, type CostTracker } from "../../core/cost";
import { fetchJson } from "../../core/util";
import { LLMOutputError, LLMRefusalError, type LLMProvider, type LLMRequest, type LLMResult } from "./types";

/**
 * OpenAI adapter (Chat Completions + json_schema response_format), kept so the LLM is
 * swappable. Model ids and prices are NOT defaulted — set them explicitly in .env.
 */
export class OpenAILLM implements LLMProvider {
  readonly name = "openai";
  readonly mock = false;

  constructor(private readonly cfg: Config) {
    if (!cfg.OPENAI_API_KEY) throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY");
    if (!cfg.OPENAI_MODEL_FAST || !cfg.OPENAI_MODEL_UNDERWRITER) {
      throw new Error("LLM_PROVIDER=openai requires OPENAI_MODEL_FAST and OPENAI_MODEL_UNDERWRITER");
    }
  }

  async complete<T>(req: LLMRequest<T>, costs: CostTracker): Promise<LLMResult<T>> {
    costs.assertLlmBudget();
    const model = (req.tier === "underwriter" ? this.cfg.OPENAI_MODEL_UNDERWRITER : this.cfg.OPENAI_MODEL_FAST)!;
    const schema = z.toJSONSchema(req.schema, { target: "draft-7" });
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchJson<{
        model: string;
        choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      }>("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.OPENAI_API_KEY}` },
        timeoutMs: 120_000,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: req.task, schema, strict: false } },
        }),
      });
      const tokensIn = res.usage?.prompt_tokens ?? 0;
      const tokensOut = res.usage?.completion_tokens ?? 0;
      const pIn = this.cfg.OPENAI_PRICE_INPUT_PER_MTOK;
      const pOut = this.cfg.OPENAI_PRICE_OUTPUT_PER_MTOK;
      const usd = pIn !== null && pOut !== null ? round((tokensIn * pIn + tokensOut * pOut) / 1e6, 6) : null;
      costs.add({ provider: "openai", kind: "llm", operation: req.task, model: res.model, units: 1, tokens_in: tokensIn, tokens_out: tokensOut, usd });

      const choice = res.choices[0];
      if (choice?.message.refusal) throw new LLMRefusalError(`OpenAI refused ${req.task}`);
      try {
        const parsed = req.schema.safeParse(JSON.parse(choice?.message.content ?? ""));
        if (parsed.success) {
          return { data: parsed.data, provider: "openai", model: res.model, tokens_in: tokensIn, tokens_out: tokensOut, usd, mock: false };
        }
        lastError = new LLMOutputError(`${req.task}: schema validation failed: ${parsed.error.message.slice(0, 500)}`);
      } catch (e) {
        lastError = new LLMOutputError(`${req.task}: invalid JSON: ${(e as Error).message}`);
      }
    }
    throw lastError;
  }
}
