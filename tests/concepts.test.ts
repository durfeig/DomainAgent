import { describe, expect, it } from "vitest";
import { extractConcepts } from "../src/pipeline/concepts";
import { minePhrases } from "../src/pipeline/phrases";
import { CostTracker } from "../src/core/cost";
import { Logger } from "../src/core/logger";
import type { LLMProvider, LLMRequest } from "../src/adapters/llm";
import type { TrendSignal } from "../src/core/types";

const now = new Date("2026-10-09T12:00:00Z");
const sig = (id: string, source: string, title: string, daysAgo = 1): TrendSignal => ({
  id, run_id: "r", source, source_id: id, source_url: `https://example.com/${id}`, title, text: null,
  published_at: new Date(now.getTime() - daysAgo * 86400_000).toISOString(), engagement: { points: 100 }, tags: [], mock: false, fetched_at: "", hash: id,
});

const signals = [
  sig("s1", "hackernews", "Agent identity for autonomous agents"),
  sig("s2", "github", "agent identity protocol"),
  sig("s3", "producthunt", "Agent identity API"),
  sig("s4", "hackernews", "OpenAI agent identity announcement"),
];

/** An LLM that tries to cite signals that don't exist and to sneak in a company concept. */
const liar: LLMProvider = {
  name: "liar",
  mock: false,
  async complete<T>(req: LLMRequest<T>) {
    const data = req.schema.parse({
      concepts: [
        { name: "agent identity", keywords: ["agent", "identity"], description: "", commercial_rationale: "x", durability: "DURABLE", durability_reason: "", evidence_signal_ids: ["s1", "s2", "invented-99"], merged_phrases: ["agent identity"], references_specific_company: false, confidence: 95 },
        { name: "ghost trend", keywords: ["ghost"], description: "", commercial_rationale: "x", durability: "DURABLE", durability_reason: "", evidence_signal_ids: ["nope-1", "nope-2"], merged_phrases: [], references_specific_company: false, confidence: 99 },
        { name: "openai agents", keywords: ["openai", "agents"], description: "", commercial_rationale: "x", durability: "HYPE", durability_reason: "", evidence_signal_ids: ["s4", "s1"], merged_phrases: [], references_specific_company: true, confidence: 80 },
      ],
      rejected_phrases: [],
    });
    return { data, provider: "liar", model: "liar", tokens_in: 0, tokens_out: 0, usd: 0, mock: false };
  },
};

describe("concept extractor guards", () => {
  it("mines multi-source phrases deterministically", () => {
    const p = minePhrases(signals, { now, recentDays: 2, history: [] });
    const ai = p.find((x) => x.phrase === "agent identity")!;
    expect(ai.doc_freq).toBe(4);
    expect(ai.sources).toEqual(["github", "hackernews", "producthunt"]);
    expect(ai.momentum).toBeNull(); // no history => unknown, not invented
  });

  it("drops invented evidence, unsupported concepts and company-specific concepts", async () => {
    const phrases = minePhrases(signals, { now, recentDays: 2, history: [] });
    const res = await extractConcepts({ phrases, signals, maxConcepts: 5, existing: new Map() }, liar, new CostTracker(), new Logger(null, { quiet: true }));
    expect(res.concepts.map((c) => c.name)).toEqual(["agent identity"]);
    expect(res.concepts[0].evidence_signal_ids).toEqual(["s1", "s2"]);
    expect(res.concepts[0].confidence).toBeLessThanOrEqual(75); // 2 sources => capped
    expect(res.dropped.map((d) => d.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/insufficient_evidence/), "company_specific"]));
  });
});
