import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import { fetchJson } from "../../core/util";
import type { FetchOptions, TrendSource } from "./types";

/** Reddit via OAuth (application-only, client_credentials). Requires a registered Reddit app. */
export class RedditSource implements TrendSource {
  readonly name = "reddit";
  readonly mock = false;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly userAgent: string,
    private readonly subreddits: string[],
  ) {}

  async fetch(opts: FetchOptions, costs: CostTracker, log: Logger): Promise<RawSignal[]> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const tok = await fetchJson<{ access_token: string }>("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", "user-agent": this.userAgent },
      body: "grant_type=client_credentials",
    });
    costs.call("reddit", "oauth_token", 1, 0);
    const minTs = opts.now.getTime() / 1000 - opts.lookbackDays * 86400;
    const out: RawSignal[] = [];
    for (const sub of this.subreddits) {
      try {
        const res = await fetchJson<{ data: { children: { data: RedditPost }[] } }>(
          `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/top?t=week&limit=100`,
          { headers: { authorization: `Bearer ${tok.access_token}`, "user-agent": this.userAgent } },
        );
        costs.call("reddit", "subreddit_top", 1, 0);
        for (const { data: p } of res.data.children) {
          if (p.created_utc < minTs || p.stickied) continue;
          out.push({
            source: "reddit",
            source_id: p.id,
            source_url: `https://www.reddit.com${p.permalink}`,
            title: p.title,
            text: p.selftext ? p.selftext.slice(0, 500) : null,
            published_at: new Date(p.created_utc * 1000).toISOString(),
            engagement: { points: p.score, comments: p.num_comments },
            tags: [`r/${sub}`],
            mock: false,
          });
        }
      } catch (e) {
        log.warn("trend_scout", "reddit_subreddit_failed", { sub, error: (e as Error).message });
      }
    }
    return out;
  }
}

interface RedditPost {
  id: string;
  title: string;
  selftext?: string;
  permalink: string;
  score: number;
  num_comments: number;
  created_utc: number;
  stickied?: boolean;
}
