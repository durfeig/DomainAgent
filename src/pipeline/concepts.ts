import type { LLMProvider } from "../adapters/llm";
import type { CostTracker } from "../core/cost";
import type { Logger } from "../core/logger";
import { ConceptExtractionSchema, type ConceptExtraction } from "../core/schemas";
import type { Concept, Durability, Phrase, TrendSignal } from "../core/types";
import { clamp, nowIso, slugify } from "../core/util";
import { CONCEPT_EXTRACTOR_SYSTEM, conceptExtractorUser } from "../prompts/concept-extractor";
import { BRANDS } from "../data/brands";
import { assessTrademark } from "./trademark";

const MIN_CONCEPT_SIGNALS = 2;

export interface ConceptStageResult {
  concepts: Concept[];
  dropped: { name: string; reason: string }[];
  raw: ConceptExtraction;
}

export async function extractConcepts(
  args: { phrases: Phrase[]; signals: TrendSignal[]; maxConcepts: number; existing: Map<string, { id: string; first_seen_at: string }> },
  llm: LLMProvider,
  costs: CostTracker,
  log: Logger,
): Promise<ConceptStageResult> {
  const { phrases, signals } = args;
  const used = new Set(phrases.flatMap((p) => p.signal_ids));
  const sigById = new Map(signals.map((s) => [s.id, s]));
  const signalPayload = [...used]
    .map((id) => sigById.get(id))
    .filter((s): s is TrendSignal => !!s)
    .map((s) => ({ id: s.id, source: s.source, title: s.title, engagement: s.engagement, published_at: s.published_at.slice(0, 10) }));

  const res = await llm.complete(
    {
      task: "concept_extraction",
      tier: "fast",
      system: CONCEPT_EXTRACTOR_SYSTEM,
      user: conceptExtractorUser({
        phrases: phrases.map((p) => ({ phrase: p.phrase, doc_freq: p.doc_freq, sources: p.sources, weight: p.weight, momentum: p.momentum, signal_ids: p.signal_ids })),
        signals: signalPayload,
      }),
      schema: ConceptExtractionSchema,
      maxTokens: 12000,
      mockResponse: () => mockConceptExtraction(phrases, sigById),
    },
    costs,
  );

  const dropped: ConceptStageResult["dropped"] = [];
  const concepts: Concept[] = [];
  const validIds = new Set(signalPayload.map((s) => s.id));

  for (const c of res.data.concepts) {
    const invented = c.evidence_signal_ids.filter((id) => !validIds.has(id));
    if (invented.length) log.warn("concept_extractor", "uncited_signal_ids_dropped", { concept: c.name, invented });
    const evidence = [...new Set(c.evidence_signal_ids.filter((id) => validIds.has(id)))];
    const supporting = evidence.map((id) => sigById.get(id)!).filter(Boolean);
    const sources = [...new Set(supporting.map((s) => s.source.split(":")[0]))].sort();

    if (c.references_specific_company) {
      dropped.push({ name: c.name, reason: "company_specific" });
      continue;
    }
    if (supporting.length < MIN_CONCEPT_SIGNALS) {
      dropped.push({ name: c.name, reason: `insufficient_evidence (${supporting.length} valid signals)` });
      continue;
    }
    const keywords = c.keywords.map((k) => k.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
    const tm = assessTrademark(keywords.join(""), keywords);
    if (tm.risk === "HIGH") {
      dropped.push({ name: c.name, reason: `trademark: ${tm.matches.map((m) => m.brand).join(",")}` });
      continue;
    }

    const merged = phrases.filter((p) => c.merged_phrases.includes(p.phrase) || p.phrase === c.name);
    const momenta = merged.map((p) => p.momentum).filter((m): m is number => m !== null);
    const momentum = momenta.length ? Math.max(...momenta) : null;
    const engagement = supporting.reduce((s, x) => s + (x.engagement.points ?? 0) + (x.engagement.stars ?? 0) * 0.3 + (x.engagement.votes ?? 0) * 0.5, 0);

    const evidenceCap = sources.length >= 3 ? 90 : sources.length === 2 ? 75 : 50;
    const slug = slugify(c.name);
    const prev = args.existing.get(slug);
    const score = conceptScore({ sources: sources.length, frequency: supporting.length, engagement, momentum, durability: c.durability });

    concepts.push({
      id: prev?.id ?? "",
      slug,
      name: c.name.toLowerCase(),
      description: c.description,
      commercial_rationale: c.commercial_rationale,
      keywords,
      durability: c.durability,
      durability_reason: c.durability_reason,
      frequency: supporting.length,
      sources,
      momentum,
      confidence: Math.min(c.confidence, evidenceCap),
      evidence_signal_ids: evidence,
      first_seen_at: prev?.first_seen_at ?? nowIso(),
      last_seen_at: nowIso(),
      score,
    });
  }

  // Merge duplicates by slug (LLM may emit near-identical names) and keep the strongest N.
  const bySlug = new Map<string, Concept>();
  for (const c of concepts) {
    const ex = bySlug.get(c.slug);
    if (!ex || c.score > ex.score) bySlug.set(c.slug, c);
  }
  const ranked = [...bySlug.values()].sort((a, b) => b.score * b.confidence - a.score * a.confidence);
  for (const c of ranked.slice(args.maxConcepts)) dropped.push({ name: c.name, reason: "below_top_n" });
  return { concepts: ranked.slice(0, args.maxConcepts), dropped, raw: res.data };
}

/** Deterministic concept strength 0–100: source diversity, frequency, engagement, momentum, durability. */
export function conceptScore(x: { sources: number; frequency: number; engagement: number; momentum: number | null; durability: Durability }): number {
  const div = Math.min(1, x.sources / 4);
  const freq = Math.min(1, Math.log2(1 + x.frequency) / Math.log2(1 + 12));
  const eng = Math.min(1, Math.log10(1 + x.engagement) / 4);
  const mom = x.momentum === null ? 0.35 : Math.min(1, Math.max(0, (x.momentum - 0.5) / 2.5));
  const dur = x.durability === "DURABLE" ? 1 : x.durability === "UNCLEAR" ? 0.85 : 0.6;
  return Math.round(clamp((40 * div + 25 * freq + 20 * eng + 15 * mom) * dur));
}

/** Offline heuristic: each strong phrase becomes a concept; phrases contained in a stronger one are merged. */
export function mockConceptExtraction(phrases: Phrase[], sigById: Map<string, TrendSignal>): ConceptExtraction {
  const brandSet = new Set(BRANDS.map((b) => b.name));
  const chosen: { phrase: Phrase; merged: Phrase[] }[] = [];
  for (const p of [...phrases].sort((a, b) => b.weight - a.weight)) {
    const toks = p.phrase.split(" ");
    const host = chosen.find((c) => {
      const ct = c.phrase.phrase.split(" ");
      return ct.every((t) => toks.includes(t)) || toks.every((t) => ct.includes(t));
    });
    if (host) host.merged.push(p);
    else chosen.push({ phrase: p, merged: [p] });
  }
  const concepts = chosen.slice(0, 12).map(({ phrase, merged }) => {
    const ids = [...new Set(merged.flatMap((m) => m.signal_ids))];
    const sources = new Set(ids.map((id) => sigById.get(id)?.source.split(":")[0]));
    const toks = phrase.phrase.split(" ");
    return {
      name: phrase.phrase,
      keywords: toks.slice(0, 4),
      description: `Products and infrastructure around "${phrase.phrase}".`,
      commercial_rationale: `Multiple teams are shipping under this label (${ids.length} signals); a short exact-match name could anchor a product or category page.`,
      durability: (sources.size >= 3 ? "DURABLE" : sources.size === 2 ? "UNCLEAR" : "HYPE") as Durability,
      durability_reason: `[mock heuristic] ${sources.size} distinct source types`,
      evidence_signal_ids: ids,
      merged_phrases: merged.map((m) => m.phrase),
      references_specific_company: toks.some((t) => brandSet.has(t)),
      confidence: Math.min(95, 40 + sources.size * 15),
    };
  });
  return { concepts, rejected_phrases: [] };
}
