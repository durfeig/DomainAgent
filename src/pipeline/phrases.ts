import type { Phrase, TrendSignal } from "../core/types";
import { BRANDS } from "../data/brands";

/**
 * Deterministic phrase mining over trend signals (no LLM): bigrams/trigrams of content words,
 * document frequency, source diversity, engagement weight and momentum vs. stored history.
 * The LLM later only *groups and names* these phrases — it cannot add evidence.
 */

const STOP = new Set(
  (
    "a an the and or but of for to in on at by with from into over under about as is are was were be been being it its this that these those " +
    "i you we they he she my your our their me us them what which who whom how why when where can could should would will just not no yes " +
    "do does did done have has had more most less very new now than then there here so if out up down all any some your own via vs per " +
    "show hn ask tell launch launches launched introducing introduces announces announced released release using use used build built building " +
    "open source free tool tools app apps startup startups raises raised seed series million billion round funding company companies " +
    "weekend month week year today first best top guide tips list awesome help anyone working thing things way ways make makes made get got " +
    "one two three like vs into lands heats finally again just going let lets need needs want wants"
  ).split(/\s+/),
);

const DISTINCTIVE_BRANDS = new Set(BRANDS.filter((b) => !b.generic).map((b) => b.name));

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

export function contentNgrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n);
    if (g.some((t) => STOP.has(t) || /\d/.test(t))) continue;
    out.push(g.join(" "));
  }
  return out;
}

export function engagementWeight(s: Pick<TrendSignal, "engagement">): number {
  const e = s.engagement;
  const raw = (e.points ?? 0) + (e.comments ?? 0) * 0.5 + (e.stars ?? 0) * 0.3 + (e.votes ?? 0) * 0.5;
  return 1 + Math.log1p(raw) / 3;
}

export interface PhraseOptions {
  now: Date;
  recentDays: number;
  /** Signals from previous runs (for momentum). */
  history: Pick<TrendSignal, "id" | "title" | "published_at">[];
  minDocFreq?: number;
  maxPhrases?: number;
}

export function minePhrases(signals: TrendSignal[], opts: PhraseOptions): Phrase[] {
  const minDocFreq = opts.minDocFreq ?? 2;
  const map = new Map<string, { ids: Set<string>; sources: Set<string>; weight: number }>();
  for (const s of signals) {
    const toks = tokenize(`${s.title} ${s.tags.join(" ")}`);
    const grams = new Set([...contentNgrams(toks, 2), ...contentNgrams(toks, 3)]);
    for (const g of grams) {
      if (g.split(" ").some((t) => DISTINCTIVE_BRANDS.has(t))) continue; // company-specific phrases are not concepts
      const m = map.get(g) ?? { ids: new Set(), sources: new Set(), weight: 0 };
      if (!m.ids.has(s.id)) {
        m.ids.add(s.id);
        m.sources.add(s.source.split(":")[0]);
        m.weight += engagementWeight(s);
      }
      map.set(g, m);
    }
  }

  // Momentum: per-day rate in the recent window vs. the older baseline from stored history.
  const all = dedupeById([...signals, ...opts.history]);
  const recentCut = opts.now.getTime() - opts.recentDays * 86400_000;
  const oldest = Math.min(...all.map((s) => new Date(s.published_at).getTime()));
  const baselineDays = (recentCut - oldest) / 86400_000;
  const hasBaseline = baselineDays >= 7; // need at least a week of older data to talk about momentum

  const phrases: Phrase[] = [];
  for (const [phrase, m] of map) {
    if (m.ids.size < minDocFreq) continue;
    let recent = 0;
    let baseline = 0;
    for (const s of all) {
      if (!tokenize(s.title).join(" ").includes(phrase)) continue;
      if (new Date(s.published_at).getTime() >= recentCut) recent++;
      else baseline++;
    }
    const momentum = hasBaseline ? (recent / opts.recentDays + 0.1) / (baseline / baselineDays + 0.1) : null;
    phrases.push({
      phrase,
      doc_freq: m.ids.size,
      sources: [...m.sources].sort(),
      weight: Math.round(m.weight * 100) / 100,
      signal_ids: [...m.ids],
      recent_freq: recent,
      baseline_freq: hasBaseline ? baseline : null,
      momentum: momentum === null ? null : Math.round(momentum * 100) / 100,
    });
  }

  // Drop trigrams fully explained by a more frequent contained bigram.
  const byPhrase = new Map(phrases.map((p) => [p.phrase, p]));
  const pruned = phrases.filter((p) => {
    const toks = p.phrase.split(" ");
    if (toks.length < 3) return true;
    const subs = [toks.slice(0, 2).join(" "), toks.slice(1).join(" ")];
    return !subs.some((sub) => (byPhrase.get(sub)?.doc_freq ?? 0) >= p.doc_freq);
  });

  return pruned.sort((a, b) => b.weight - a.weight).slice(0, opts.maxPhrases ?? 60);
}

function dedupeById<T extends { id: string }>(xs: T[]): T[] {
  const m = new Map<string, T>();
  for (const x of xs) m.set(x.id, x);
  return [...m.values()];
}
