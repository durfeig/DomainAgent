import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import { fetchJson } from "../../core/util";
import type { FetchOptions, TrendSource } from "./types";

/** Hacker News via the public Algolia API (no key). https://hn.algolia.com/api */
export class HackerNewsSource implements TrendSource {
  readonly name = "hackernews";
  readonly mock = false;
  constructor(private readonly minPoints: number) {}

  async fetch(opts: FetchOptions, costs: CostTracker, _log: Logger): Promise<RawSignal[]> {
    const since = Math.floor(opts.now.getTime() / 1000) - opts.lookbackDays * 86400;
    const out: RawSignal[] = [];
    // Stories + Show HN / Launch HN (launches are strong "new category" signals).
    for (const tags of ["story", "show_hn", "launch_hn"]) {
      for (let page = 0; page < 3; page++) {
        const url =
          `https://hn.algolia.com/api/v1/search_by_date?tags=${tags}` +
          `&numericFilters=${encodeURIComponent(`created_at_i>${since},points>${this.minPoints}`)}` +
          `&hitsPerPage=200&page=${page}`;
        const res = await fetchJson<{ hits: HNHit[]; nbPages: number }>(url);
        costs.call("hackernews", "search", 1, 0);
        for (const h of res.hits) {
          if (!h.title) continue;
          out.push({
            source: "hackernews",
            source_id: h.objectID,
            source_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
            title: h.title,
            text: h.url ?? null,
            published_at: h.created_at,
            engagement: { points: h.points ?? 0, comments: h.num_comments ?? 0 },
            tags: (h._tags ?? []).filter((t) => !t.startsWith("author_") && !t.startsWith("story_")),
            mock: false,
          });
        }
        if (page + 1 >= res.nbPages) break;
      }
    }
    return dedupe(out);
  }
}

interface HNHit {
  objectID: string;
  title: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at: string;
  _tags?: string[];
}

function dedupe(s: RawSignal[]) {
  const seen = new Set<string>();
  return s.filter((x) => (seen.has(x.source_id) ? false : (seen.add(x.source_id), true)));
}
