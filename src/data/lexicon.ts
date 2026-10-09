/**
 * Static lexicon used by the domain generator. The LLM (when enabled) adds concept-specific
 * semantic alternatives; this file provides affixes and an offline thesaurus for mock runs.
 */

export const PREFIXES = ["get", "try", "use", "go", "my", "the", "hey", "on"];

export const SUFFIXES = ["hq", "hub", "labs", "kit", "base", "stack", "ly", "ify", "os", "app", "api", "cloud", "works", "flow"];

export const GENERIC_VERBS = ["verify", "trust", "check", "sign", "prove", "pass", "guard", "pay", "build", "run", "ship", "find", "book", "call"];

/** Offline thesaurus for mock lexicon generation (lowercase, real words only). */
export const THESAURUS: Record<string, { nouns: string[]; verbs: string[]; roots: string[] }> = {
  agent: { nouns: ["agent", "bot", "agents"], verbs: ["delegate", "act"], roots: ["proxy", "envoy"] },
  agents: { nouns: ["agent", "bot"], verbs: ["delegate"], roots: ["envoy"] },
  identity: { nouns: ["id", "passport", "badge", "proof", "trust", "key", "pass", "seal"], verbs: ["verify", "prove", "sign", "trust"], roots: ["passport", "seal", "creds"] },
  payments: { nouns: ["pay", "wallet", "billing", "spend", "ledger", "card"], verbs: ["pay", "spend", "settle"], roots: ["tender", "coin", "purse"] },
  checkout: { nouns: ["checkout", "cart", "basket", "till"], verbs: ["buy", "pay", "order"], roots: ["till", "cart"] },
  receptionist: { nouns: ["receptionist", "reception", "desk", "concierge", "frontdesk"], verbs: ["answer", "book", "greet", "call"], roots: ["concierge", "greeter"] },
  security: { nouns: ["security", "guard", "shield", "sentinel", "safe", "armor"], verbs: ["guard", "protect", "secure"], roots: ["sentinel", "aegis", "bastion"] },
  context: { nouns: ["context", "memory", "recall", "state"], verbs: ["remember", "recall"], roots: ["recall", "memo"] },
  engineering: { nouns: ["engineering", "ops", "works", "forge"], verbs: ["build", "craft"], roots: ["forge", "craft"] },
  commerce: { nouns: ["commerce", "shop", "store", "market", "cart"], verbs: ["buy", "sell", "shop"], roots: ["bazaar", "mart"] },
  voice: { nouns: ["voice", "speech", "talk", "call"], verbs: ["speak", "talk", "say", "call"], roots: ["vox", "echo"] },
  ai: { nouns: ["ai"], verbs: [], roots: [] },
};

/** Words considered "real" for linguistic-quality checks, merged with whatever the lexicon produces. */
export const COMMON_WORDS = new Set<string>([
  ...PREFIXES,
  ...SUFFIXES,
  ...GENERIC_VERBS,
  ...Object.keys(THESAURUS),
  ...Object.values(THESAURUS).flatMap((t) => [...t.nouns, ...t.verbs, ...t.roots]),
]);
