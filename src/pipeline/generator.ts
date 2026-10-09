import type { LLMProvider } from "../adapters/llm";
import type { CostTracker } from "../core/cost";
import type { Logger } from "../core/logger";
import { LexiconSchema, type Lexicon } from "../core/schemas";
import type { Concept, DomainCandidate, GenerationStrategy } from "../core/types";
import { GENERIC_VERBS, PREFIXES, SUFFIXES, THESAURUS } from "../data/lexicon";
import { DOMAIN_LEXICON_SYSTEM, domainLexiconUser } from "../prompts/domain-lexicon";

export type LexiconEntry = Lexicon["concepts"][number];

/** One LLM call for all concepts: the model proposes words, code does the combinatorics. */
export async function buildLexicon(concepts: Concept[], llm: LLMProvider, costs: CostTracker, log: Logger): Promise<Map<string, LexiconEntry>> {
  const res = await llm.complete(
    {
      task: "domain_lexicon",
      tier: "fast",
      system: DOMAIN_LEXICON_SYSTEM,
      user: domainLexiconUser(concepts.map((c) => ({ slug: c.slug, name: c.name, keywords: c.keywords, description: c.description }))),
      schema: LexiconSchema,
      maxTokens: 8000,
      mockResponse: () => mockLexicon(concepts),
    },
    costs,
  );
  const map = new Map<string, LexiconEntry>();
  for (const e of res.data.concepts) map.set(e.slug, e);
  for (const c of concepts) {
    if (!map.has(c.slug)) {
      log.warn("domain_generator", "lexicon_missing_concept_fallback", { slug: c.slug });
      map.set(c.slug, mockLexicon([c]).concepts[0]);
    }
  }
  return map;
}

export function mockLexicon(concepts: Concept[]): Lexicon {
  return {
    concepts: concepts.map((c) => {
      const kws = c.keywords.filter((k) => /^[a-z]{2,14}$/.test(k));
      const th = kws.map((k) => THESAURUS[k]).filter(Boolean);
      const uniq = (xs: string[], n: number, re: RegExp) => [...new Set(xs)].filter((x) => re.test(x)).slice(0, n);
      return {
        slug: c.slug,
        core_terms: kws.slice(0, 4).length ? kws.slice(0, 4) : ["name"],
        alt_nouns: uniq(th.flatMap((t) => t.nouns), 14, /^[a-z]{2,12}$/),
        verbs: uniq(th.flatMap((t) => t.verbs), 10, /^[a-z]{2,10}$/),
        brandable_roots: uniq(th.flatMap((t) => t.roots), 10, /^[a-z]{3,12}$/),
        avoid: [],
      };
    }),
  };
}

/**
 * Deterministic candidate generation for one concept.
 * Strategies: exact, semantic (one core term swapped for an alternative), noun+noun,
 * verb+noun, prefix, suffix, brandable (overlap blends + evocative roots).
 * Returns up to `max` unique SLDs, in strategy-priority order, each crossed with every TLD.
 */
export function generateForConcept(concept: Concept, lex: LexiconEntry, tlds: string[], max: number): DomainCandidate[] {
  const avoid = new Set(lex.avoid.map((a) => a.toLowerCase()));
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()).filter((x) => /^[a-z]{2,14}$/.test(x) && !avoid.has(x)))];
  const core = clean(lex.core_terms.length ? lex.core_terms : concept.keywords);
  const alts = clean(lex.alt_nouns).filter((a) => !core.includes(a));
  const verbs = clean([...lex.verbs, ...GENERIC_VERBS.slice(0, 6)]);
  const roots = clean(lex.brandable_roots);
  const head = core[0];
  const tail = core.slice(1);

  const out = new Map<string, { parts: string[]; strategy: GenerationStrategy }>();
  const add = (parts: string[], strategy: GenerationStrategy) => {
    const ps = parts.filter(Boolean);
    if (ps.length === 0) return;
    const sld = ps.join("");
    if (!out.has(sld)) out.set(sld, { parts: ps, strategy });
  };

  // exact match (and singular/plural variant of the last word)
  add(core, "exact");
  if (core.length >= 2) add([...core.slice(0, -1), pluralToggle(core[core.length - 1])], "exact");
  if (core.length >= 3) add(core.slice(0, 2), "exact");

  // semantic: swap each non-head core term for an alternative noun ("agent" + "passport")
  for (const a of alts) add([head, a], "semantic");
  for (const a of alts) for (const t of tail) add([a, t], "semantic");

  // noun + noun, both orders, across core and alternatives
  for (const a of alts) add([a, head], "noun_noun");
  for (const a of alts) for (const b of alts) if (a !== b) add([a, b], "noun_noun");

  // verb + noun
  for (const v of verbs) add([v, head], "verb_noun");
  for (const v of verbs) for (const t of tail) add([v, t], "verb_noun");
  for (const v of verbs) add([head, v], "verb_noun");

  // prefix / suffix around the exact phrase and the head term
  const exact = core.length <= 2 ? core : core.slice(0, 2);
  for (const p of PREFIXES) add([p, ...exact], "prefix");
  for (const p of PREFIXES) add([p, head], "prefix");
  for (const s of SUFFIXES) add([...exact, s], "suffix");
  for (const s of SUFFIXES) add([head, s], "suffix");
  for (const s of SUFFIXES) for (const a of alts.slice(0, 4)) add([a, s], "suffix");

  // brandable: evocative roots alone and with the head term, plus overlap blends (agent+entity -> agentity)
  for (const r of roots) add([r], "brandable");
  for (const r of roots) add([head, r], "brandable");
  for (const r of roots) add([r, head], "brandable");
  for (const a of [head, ...tail, ...alts]) {
    for (const b of [head, ...tail, ...alts, ...roots]) {
      const blend = overlapBlend(a, b);
      if (blend) add([blend], "brandable");
    }
  }

  const slds = [...out.entries()].slice(0, max);
  const cands: DomainCandidate[] = [];
  for (const [sld, { parts, strategy }] of slds) {
    for (const tld of tlds) cands.push({ domain: `${sld}.${tld}`, sld, tld, parts, strategy, concept_slug: concept.slug });
  }
  return cands;
}

/** Blend two words that share a 2–4 letter overlap: "agent" + "entity" -> "agentity". */
export function overlapBlend(a: string, b: string): string | null {
  if (a === b || a.length < 3 || b.length < 3) return null;
  for (let k = Math.min(4, a.length - 1, b.length - 1); k >= 2; k--) {
    if (a.slice(-k) === b.slice(0, k)) {
      const blend = a + b.slice(k);
      if (blend.length >= 5 && blend.length <= 12 && blend !== a + b) return blend;
    }
  }
  return null;
}

function pluralToggle(w: string): string {
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.endsWith("y") && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}
