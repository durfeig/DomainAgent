import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import { fetchJson } from "../../core/util";
import type { FetchOptions, TrendSource } from "./types";

/**
 * GitHub: newly created repositories gaining stars fast (proxy for "GitHub Trending",
 * which has no official API). REST search API; token optional but raises rate limits.
 */
export class GitHubSource implements TrendSource {
  readonly name = "github";
  readonly mock = false;
  constructor(
    private readonly token: string | null,
    private readonly minStars: number,
  ) {}

  async fetch(opts: FetchOptions, costs: CostTracker, _log: Logger): Promise<RawSignal[]> {
    const since = new Date(opts.now.getTime() - Math.max(opts.lookbackDays, 14) * 86400_000).toISOString().slice(0, 10);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "arbitrage-os",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const out: RawSignal[] = [];
    for (let page = 1; page <= 2; page++) {
      const q = encodeURIComponent(`created:>${since} stars:>${this.minStars}`);
      const res = await fetchJson<{ items: GHRepo[] }>(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`,
        { headers },
      );
      costs.call("github", "search_repositories", 1, 0);
      for (const r of res.items) {
        out.push({
          source: "github",
          source_id: String(r.id),
          source_url: r.html_url,
          title: `${r.name.replace(/[-_]/g, " ")}: ${r.description ?? ""}`.slice(0, 300),
          text: r.description,
          published_at: r.created_at,
          engagement: { stars: r.stargazers_count },
          tags: r.topics ?? [],
          mock: false,
        });
      }
      if (res.items.length < 100) break;
    }
    return out;
  }
}

interface GHRepo {
  id: number;
  name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  stargazers_count: number;
  topics?: string[];
}
