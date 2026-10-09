import type { Config } from "../../config";
import { AnthropicLLM } from "./anthropic";
import { MockLLM } from "./mock";
import { OpenAILLM } from "./openai";
import type { LLMProvider } from "./types";

export * from "./types";

export function createLLM(cfg: Config): LLMProvider {
  switch (cfg.LLM_PROVIDER) {
    case "anthropic":
      return new AnthropicLLM(cfg);
    case "openai":
      return new OpenAILLM(cfg);
    default:
      return new MockLLM();
  }
}
