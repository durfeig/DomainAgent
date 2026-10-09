import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import { fetchJson } from "../../core/util";
import type { FetchOptions, TrendSource } from "./types";

/**
 * Product Hunt GraphQL API v2 (developer token). Check Product Hunt's API terms before
 * commercial use — see docs/DECISIONS.md.
 */
export class ProductHuntSource implements TrendSource {
  readonly name = "producthunt";
  readonly mock = false;
  constructor(private readonly token: string) {}

  async fetch(opts: FetchOptions, costs: CostTracker, _log: Logger): Promise<RawSignal[]> {
    const postedAfter = new Date(opts.now.getTime() - opts.lookbackDays * 86400_000).toISOString();
    const query = `query($after: DateTime!) {
      posts(order: VOTES, postedAfter: $after, first: 50) {
        edges { node { id name tagline url votesCount commentsCount createdAt
          topics(first: 5) { edges { node { name } } } } }
      }
    }`;
    const res = await fetchJson<{ data?: { posts: { edges: { node: PHPost }[] } }; errors?: unknown[] }>(
      "https://api.producthunt.com/v2/api/graphql",
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables: { after: postedAfter } }),
      },
    );
    costs.call("producthunt", "graphql_posts", 1, 0);
    if (!res.data) throw new Error(`Product Hunt error: ${JSON.stringify(res.errors ?? []).slice(0, 200)}`);
    return res.data.posts.edges.map(({ node: p }) => ({
      source: "producthunt",
      source_id: p.id,
      source_url: p.url,
      title: `${p.name}: ${p.tagline}`,
      text: p.tagline,
      published_at: p.createdAt,
      engagement: { votes: p.votesCount, comments: p.commentsCount },
      tags: p.topics.edges.map((t) => t.node.name.toLowerCase()),
      mock: false,
    }));
  }
}

interface PHPost {
  id: string;
  name: string;
  tagline: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics: { edges: { node: { name: string } }[] };
}
