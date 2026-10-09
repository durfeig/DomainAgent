import { describe, expect, it } from "vitest";
import { generateForConcept, mockLexicon, overlapBlend } from "../src/pipeline/generator";
import { checkCandidate, prefilter } from "../src/pipeline/prefilter";
import { assessTrademark, damerau } from "../src/pipeline/trademark";
import type { Concept } from "../src/core/types";

const concept: Concept = {
  id: "c1", slug: "agent-identity", name: "agent identity", description: "", commercial_rationale: "", keywords: ["agent", "identity"],
  durability: "DURABLE", durability_reason: "", frequency: 6, sources: ["github", "hackernews", "producthunt"], momentum: null,
  confidence: 80, evidence_signal_ids: [], first_seen_at: "", last_seen_at: "", score: 70,
};

describe("domain generator", () => {
  const lex = mockLexicon([concept]).concepts[0];
  const cands = generateForConcept(concept, lex, ["com", "ai"], 300);

  it("generates 50–300 SLDs per concept across all strategies, crossed with TLDs", () => {
    const slds = new Set(cands.map((c) => c.sld));
    expect(slds.size).toBeGreaterThanOrEqual(50);
    expect(slds.size).toBeLessThanOrEqual(300);
    expect(cands.length).toBe(slds.size * 2);
    const strategies = new Set(cands.map((c) => c.strategy));
    for (const s of ["exact", "semantic", "noun_noun", "verb_noun", "prefix", "suffix", "brandable"]) expect(strategies).toContain(s);
  });

  it("includes the spec's examples", () => {
    const domains = new Set(cands.map((c) => c.domain));
    expect(domains).toContain("agentidentity.com");
    expect(domains).toContain("agentpassport.com");
    expect(domains).toContain("agentproof.com");
    expect(domains).toContain("agenttrust.com");
    expect(domains).toContain("verifyagent.com");
  });

  it("blends overlapping words", () => {
    expect(overlapBlend("agent", "entity")).toBe("agentity");
    expect(overlapBlend("agent", "agent")).toBeNull();
  });
});

describe("pre-filters", () => {
  const c = (sld: string, parts: string[], tld = "com") => ({ domain: `${sld}.${tld}`, sld, tld, parts, strategy: "noun_noun" as const, concept_slug: "x" });
  it("rejects long, hyphenated, numeric, confusing and hard-to-pronounce names", () => {
    expect(checkCandidate(c("agentidentityplatform", ["agent", "identity", "platform"]))).toContain("TOO_LONG");
    expect(checkCandidate(c("agent-id", ["agent", "id"]))).toContain("HAS_HYPHEN");
    expect(checkCandidate(c("agent2", ["agent2"]))).toContain("HAS_DIGIT");
    expect(checkCandidate(c("agenttrust", ["agent", "trust"]))).toContain("BOUNDARY_DOUBLE_LETTER");
    expect(checkCandidate(c("agentsstrkt", ["agents", "strkt"]))).toContain("HARD_TO_PRONOUNCE");
    expect(checkCandidate(c("agentai", ["agent", "ai"], "ai"))).toContain("TLD_REDUNDANT");
    expect(checkCandidate(c("agentpassport", ["agent", "passport"]))).toEqual([]);
  });
  it("drops trademark HIGH before any API call", () => {
    const r = prefilter([c("openaiagent", ["openai", "agent"]), c("agentpassport", ["agent", "passport"])]);
    expect(r.passed.map((p) => p.sld)).toEqual(["agentpassport"]);
    expect(r.reasonCounts.TRADEMARK_HIGH).toBe(1);
  });
});

describe("trademark screen", () => {
  it("flags brands, typosquats and generic-word brands", () => {
    expect(assessTrademark("claudeagent", ["claude", "agent"]).risk).toBe("HIGH");
    expect(assessTrademark("gogleagent", ["gogle", "agent"]).risk).toBe("HIGH"); // typosquat of google
    expect(assessTrademark("chatgtp", ["chatgtp"]).risk).toBe("HIGH"); // typosquat of chatgpt
    expect(assessTrademark("myshopifyagent", ["my", "shopify", "agent"]).risk).toBe("HIGH");
    expect(assessTrademark("appleagent", ["apple", "agent"]).risk).toBe("MEDIUM");
    expect(assessTrademark("agentpassport", ["agent", "passport"]).risk).toBe("LOW");
    expect(damerau("chatgtp", "chatgpt")).toBe(1);
  });
});
