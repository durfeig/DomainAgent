import { XMLParser } from "fast-xml-parser";
import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import { sha1 } from "../../core/util";
import type { FetchOptions, TrendSource } from "./types";

/** Startup / funding news via RSS or Atom feeds (no key). Feed list configurable via RSS_FEEDS. */
export class RssSource implements TrendSource {
  readonly name = "rss";
  readonly mock = false;
  constructor(private readonly feeds: string[]) {}

  async fetch(opts: FetchOptions, costs: CostTracker, log: Logger): Promise<RawSignal[]> {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const minTs = opts.now.getTime() - opts.lookbackDays * 86400_000;
    const out: RawSignal[] = [];
    for (const feed of this.feeds) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20_000);
        const res = await fetch(feed, { headers: { "user-agent": "arbitrage-os/0.1" }, signal: ctrl.signal }).finally(() => clearTimeout(t));
        costs.call("rss", new URL(feed).host, 1, 0);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        out.push(...parseFeed(parser.parse(await res.text()), feed, minTs));
      } catch (e) {
        log.warn("trend_scout", "rss_feed_failed", { feed, error: (e as Error).message });
      }
    }
    return out;
  }
}

export function parseFeed(doc: Record<string, any>, feedUrl: string, minTs: number): RawSignal[] {
  const host = new URL(feedUrl).host;
  const items: any[] = toArray(doc?.rss?.channel?.item ?? doc?.feed?.entry);
  const out: RawSignal[] = [];
  for (const it of items) {
    const title = text(it.title);
    const link = typeof it.link === "string" ? it.link : (it.link?.["@_href"] ?? toArray(it.link)[0]?.["@_href"]);
    const date = new Date(text(it.pubDate ?? it.published ?? it.updated) ?? "");
    if (!title || !link || Number.isNaN(date.getTime()) || date.getTime() < minTs) continue;
    out.push({
      source: `rss:${host}`,
      source_id: sha1(link),
      source_url: link,
      title,
      text: (text(it.description ?? it.summary) ?? "").replace(/<[^>]+>/g, " ").slice(0, 500) || null,
      published_at: date.toISOString(),
      engagement: {},
      tags: toArray(it.category).map((c) => text(c)?.toLowerCase()).filter((c): c is string => !!c),
      mock: false,
    });
  }
  return out;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}
function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "#text" in (v as object)) return String((v as Record<string, unknown>)["#text"]).trim() || null;
  return null;
}
