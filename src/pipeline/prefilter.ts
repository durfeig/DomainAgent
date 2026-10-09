import type { DomainCandidate, TrademarkRisk } from "../core/types";
import { COMMON_WORDS } from "../data/lexicon";
import { assessTrademark } from "./trademark";

/**
 * Cheap deterministic filters applied BEFORE any paid/rate-limited availability call.
 * Every rejection carries machine-readable reasons, aggregated per run for observability.
 */

export const TLD_MAX_SLD: Record<string, number> = { com: 15, ai: 12, io: 12, co: 12 };

const VOWELS = /[aeiouy]/;

export interface PrefilterResult {
  passed: (DomainCandidate & { trademark_risk: TrademarkRisk })[];
  rejected: { domain: string; reasons: string[] }[];
  reasonCounts: Record<string, number>;
}

export function prefilter(cands: DomainCandidate[], knownWords: Set<string> = COMMON_WORDS): PrefilterResult {
  const passed: PrefilterResult["passed"] = [];
  const rejected: PrefilterResult["rejected"] = [];
  const reasonCounts: Record<string, number> = {};
  const seen = new Set<string>();
  const tmCache = new Map<string, TrademarkRisk>();

  for (const c of cands) {
    const reasons = checkCandidate(c, knownWords);
    if (seen.has(c.domain)) reasons.push("DUPLICATE");
    seen.add(c.domain);

    let tm = tmCache.get(c.sld);
    if (!tm) {
      tm = assessTrademark(c.sld, c.parts, knownWords).risk;
      tmCache.set(c.sld, tm);
    }
    if (tm === "HIGH") reasons.push("TRADEMARK_HIGH");

    if (reasons.length) {
      rejected.push({ domain: c.domain, reasons });
      for (const r of reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    } else {
      passed.push({ ...c, trademark_risk: tm });
    }
  }
  return { passed, rejected, reasonCounts };
}

export function checkCandidate(c: DomainCandidate, knownWords: Set<string> = COMMON_WORDS): string[] {
  const r: string[] = [];
  const s = c.sld;
  const maxLen = TLD_MAX_SLD[c.tld] ?? 12;
  if (s.length > maxLen) r.push("TOO_LONG");
  if (s.length < 3) r.push("TOO_SHORT");
  if (/\d/.test(s)) r.push("HAS_DIGIT");
  if (s.includes("-")) r.push("HAS_HYPHEN");
  if (!/^[a-z0-9-]+$/.test(s)) r.push("INVALID_CHARS");
  if (c.parts.length > 3) r.push("TOO_MANY_WORDS");
  if (new Set(c.parts).size !== c.parts.length) r.push("REPEATED_WORD");
  if (/(.)\1\1/.test(s) || /vv|ii|uu/.test(s)) r.push("CONFUSABLE_CHARS");
  for (let i = 0; i + 1 < c.parts.length; i++) {
    if (c.parts[i].slice(-1) === c.parts[i + 1][0]) {
      r.push("BOUNDARY_DOUBLE_LETTER"); // agent+trust -> "agenttrust": misheard / mistyped
      break;
    }
  }
  if (maxConsonantRun(s) > 4) r.push("HARD_TO_PRONOUNCE");
  const vowelRatio = [...s].filter((ch) => VOWELS.test(ch)).length / s.length;
  if (vowelRatio < 0.2) r.push("HARD_TO_PRONOUNCE_VOWELS");
  if (s.endsWith(c.tld) && c.parts.length > 1 && c.parts[c.parts.length - 1] === c.tld) r.push("TLD_REDUNDANT");
  if (/(19|20)\d\d/.test(s) || /v\d/.test(s)) r.push("TOO_SPECIFIC");
  // Linguistic quality: single-part names must be real words (or explicit brandable blends from the generator).
  if (c.parts.length === 1 && c.strategy !== "brandable" && !knownWords.has(s)) r.push("LOW_LINGUISTIC_QUALITY");
  return [...new Set(r)];
}

export function maxConsonantRun(s: string): number {
  let run = 0;
  let best = 0;
  for (const ch of s) {
    if (/[a-z]/.test(ch) && !VOWELS.test(ch)) best = Math.max(best, ++run);
    else run = 0;
  }
  return best;
}
