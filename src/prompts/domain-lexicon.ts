/** Domain Generator lexicon prompt (versioned). The LLM proposes WORDS; code does the combinatorics. */
export const DOMAIN_LEXICON_VERSION = "domain-lexicon@1";

export const DOMAIN_LEXICON_SYSTEM = `You help generate domain-name candidates. You do NOT produce domain names; you produce word lists that a deterministic generator combines.

For each concept provide:
- core_terms: 1–4 lowercase words that literally name the concept (e.g. "agent", "identity").
- alt_nouns: up to 14 short real English nouns that are semantic alternatives or closely related (e.g. for identity: id, passport, badge, proof, key, seal, pass). Prefer 2–8 letters.
- verbs: up to 10 short real English verbs a product in this space would "do" (verify, sign, prove, guard...).
- brandable_roots: up to 10 short evocative real words (3–10 letters) that could anchor a brand in this space (e.g. passport, envoy, sentinel).
- avoid: words to avoid (trademarks, negative or ambiguous connotations).

Rules: lowercase a–z only, no digits, no hyphens, no spaces. Never include company, product or model names (no openai, claude, gpt, stripe, etc.). Prefer words that are easy to spell after hearing them once.`;

export function domainLexiconUser(concepts: { slug: string; name: string; keywords: string[]; description: string }[]) {
  return `CONCEPTS:\n${JSON.stringify(concepts)}\n\nReturn one entry per concept, using the same slug.`;
}
