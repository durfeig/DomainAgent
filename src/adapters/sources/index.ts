import type { Config } from "../../config";
import { GitHubSource } from "./github";
import { HackerNewsSource } from "./hackernews";
import { MockSource } from "./mock";
import { ProductHuntSource } from "./producthunt";
import { RedditSource } from "./reddit";
import { RssSource } from "./rss";
import type { TrendSource } from "./types";

export * from "./types";

export interface SourceSetup {
  sources: TrendSource[];
  skipped: { name: string; reason: string }[];
}

/** Builds enabled sources; sources missing credentials are skipped (logged), never faked. */
export function createSources(cfg: Config): SourceSetup {
  const sources: TrendSource[] = [];
  const skipped: SourceSetup["skipped"] = [];
  for (const name of cfg.TREND_SOURCES) {
    switch (name) {
      case "mock":
        sources.push(new MockSource());
        break;
      case "hackernews":
        sources.push(new HackerNewsSource(cfg.HN_MIN_POINTS));
        break;
      case "github":
        sources.push(new GitHubSource(cfg.GITHUB_TOKEN, cfg.GITHUB_MIN_STARS));
        break;
      case "rss":
        sources.push(new RssSource(cfg.RSS_FEEDS));
        break;
      case "reddit":
        if (cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET) {
          sources.push(new RedditSource(cfg.REDDIT_CLIENT_ID, cfg.REDDIT_CLIENT_SECRET, cfg.REDDIT_USER_AGENT, cfg.REDDIT_SUBREDDITS));
        } else skipped.push({ name, reason: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not set" });
        break;
      case "producthunt":
        if (cfg.PRODUCTHUNT_TOKEN) sources.push(new ProductHuntSource(cfg.PRODUCTHUNT_TOKEN));
        else skipped.push({ name, reason: "PRODUCTHUNT_TOKEN not set" });
        break;
      default:
        skipped.push({ name, reason: "unknown source" });
    }
  }
  return { sources, skipped };
}
