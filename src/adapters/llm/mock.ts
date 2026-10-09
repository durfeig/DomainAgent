import type { CostTracker } from "../../core/cost";
import type { LLMProvider, LLMRequest, LLMResult } from "./types";

/** Offline provider: returns the step's deterministic heuristic, validated by the same schema. */
export class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly mock = true;

  async complete<T>(req: LLMRequest<T>, costs: CostTracker): Promise<LLMResult<T>> {
    const data = req.schema.parse(req.mockResponse());
    costs.add({ provider: "mock", kind: "llm", operation: req.task, model: "mock", units: 1, tokens_in: 0, tokens_out: 0, usd: 0 });
    return { data, provider: "mock", model: "mock-heuristic", tokens_in: 0, tokens_out: 0, usd: 0, mock: true };
  }
}
