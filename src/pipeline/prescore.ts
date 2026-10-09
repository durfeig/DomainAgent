import type { Concept, DomainCandidate, GenerationStrategy, TrademarkRisk } from "../core/types";
import { clamp } from "../core/util";
import { maxConsonantRun } from "./prefilter";

/**
 * Deterministic pre-score (0–100) used to decide WHICH candidates are worth an availability
 * check and, later, which available names deserve paid enrichment and LLM underwriting.
 * It is a triage heuristic, not a valuation.
 */

export const TLD_QUALITY: Record<string, number> = { com: 100, ai: 75, io: 55, co: 45 };

const STRATEGY_WEIGHT: Record<GenerationStrategy, number> = {
  exact: 1,
  semantic: 0.85,
  noun_noun: 0.75,
  verb_noun: 0.75,
  brandable: 0.7,
  suffix: 0.55,
  prefix: 0.5,
};

/** Heuristic brandability 0–100: short, 1–2 words, pronounceable, no padding affixes. */
export function brandabilityHeuristic(c: Pick<DomainCandidate, "sld" | "parts" | "strategy">): number {
  const len = c.sld.length;
  const lenScore = len <= 6 ? 100 : len <= 8 ? 90 : len <= 10 ? 78 : len <= 12 ? 62 : len <= 14 ? 45 : 30;
  const wordScore = c.parts.length === 1 ? 95 : c.parts.length === 2 ? 85 : 55;
  const run = maxConsonantRun(c.sld);
  const pron = run <= 2 ? 100 : run === 3 ? 85 : 65;
  const padding = c.strategy === "suffix" || c.strategy === "prefix" ? 0.8 : 1;
  return Math.round(clamp((0.45 * lenScore + 0.3 * wordScore + 0.25 * pron) * padding));
}

export function prescore(c: DomainCandidate & { trademark_risk?: TrademarkRisk }, concept: Pick<Concept, "score" | "confidence">): number {
  const brand = brandabilityHeuristic(c);
  const tld = TLD_QUALITY[c.tld] ?? 35;
  const strat = STRATEGY_WEIGHT[c.strategy] * 100;
  const conceptStrength = (concept.score * concept.confidence) / 100;
  const tmPenalty = c.trademark_risk === "MEDIUM" ? 15 : 0;
  return Math.round(clamp(0.3 * brand + 0.2 * tld + 0.2 * strat + 0.3 * conceptStrength - tmPenalty));
}

/**
 * Pick the top `budget` candidates with a per-concept quota proportional to concept strength
 * (min 10% of the budget each) so one hot concept cannot starve the others.
 */
export function selectForAvailability<T extends DomainCandidate & { prescore: number }>(cands: T[], concepts: Concept[], budget: number): T[] {
  if (cands.length <= budget) return [...cands].sort((a, b) => b.prescore - a.prescore);
  const total = concepts.reduce((s, c) => s + Math.max(1, c.score), 0);
  const byConcept = new Map<string, T[]>();
  for (const c of cands) {
    const list = byConcept.get(c.concept_slug) ?? [];
    list.push(c);
    byConcept.set(c.concept_slug, list);
  }
  const picked: T[] = [];
  const leftovers: T[] = [];
  for (const concept of concepts) {
    const list = (byConcept.get(concept.slug) ?? []).sort((a, b) => b.prescore - a.prescore);
    const quota = Math.max(Math.floor(budget * 0.1), Math.floor((budget * Math.max(1, concept.score)) / total));
    picked.push(...list.slice(0, quota));
    leftovers.push(...list.slice(quota));
  }
  leftovers.sort((a, b) => b.prescore - a.prescore);
  for (const c of leftovers) {
    if (picked.length >= budget) break;
    picked.push(c);
  }
  return picked.slice(0, budget).sort((a, b) => b.prescore - a.prescore);
}
