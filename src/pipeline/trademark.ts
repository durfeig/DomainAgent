import { BRANDS, type Brand } from "../data/brands";
import type { TrademarkRisk } from "../core/types";

/**
 * Basic trademark-risk screen. Conservative by design and NOT a substitute for legal review.
 *   HIGH   — exact/contained distinctive brand, or typosquatting a distinctive brand
 *   MEDIUM — brand that is also a generic word, or a short (4-letter) brand substring
 *   LOW    — nothing detected
 * The LLM underwriter may raise the risk but never lower it (max of both is kept).
 */
export interface TrademarkMatch {
  brand: string;
  type: "exact_part" | "contains" | "typo" | "generic_word_brand";
  detail: string;
}
export interface TrademarkAssessment {
  risk: TrademarkRisk;
  matches: TrademarkMatch[];
}

export const TRADEMARK_PENALTY: Record<TrademarkRisk, number> = { LOW: 0, MEDIUM: -15, HIGH: -40 };

export function maxRisk(a: TrademarkRisk, b: TrademarkRisk): TrademarkRisk {
  const order: TrademarkRisk[] = ["LOW", "MEDIUM", "HIGH"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

export function assessTrademark(sld: string, parts: string[] = [sld], knownWords: Set<string> = new Set(), brands: Brand[] = BRANDS): TrademarkAssessment {
  const s = sld.toLowerCase();
  const matches: TrademarkMatch[] = [];
  let risk: TrademarkRisk = "LOW";
  const bump = (r: TrademarkRisk) => (risk = maxRisk(risk, r));

  for (const b of brands) {
    const name = b.name;
    if (parts.includes(name) || s === name) {
      if (b.generic) {
        matches.push({ brand: name, type: "generic_word_brand", detail: `"${name}" is a brand and a common word` });
        bump("MEDIUM");
      } else {
        matches.push({ brand: name, type: "exact_part", detail: `contains brand "${name}" as a word` });
        bump("HIGH");
      }
      continue;
    }
    if (!b.generic && name.length >= 4 && s.includes(name)) {
      matches.push({ brand: name, type: "contains", detail: `"${name}" appears inside "${s}"` });
      bump(name.length >= 5 ? "HIGH" : "MEDIUM");
      continue;
    }
    if (!b.generic && name.length >= 5) {
      const candidates = [s, ...parts.filter((p) => p.length >= 5 && !knownWords.has(p))];
      for (const c of candidates) {
        if (c !== name && Math.abs(c.length - name.length) <= 1 && damerau(c, name) === 1) {
          matches.push({ brand: name, type: "typo", detail: `"${c}" is one edit away from "${name}" (typosquatting)` });
          bump("HIGH");
          break;
        }
      }
    }
  }
  return { risk, matches };
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function damerau(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
