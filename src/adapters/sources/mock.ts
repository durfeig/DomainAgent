import type { CostTracker } from "../../core/cost";
import type { Logger } from "../../core/logger";
import type { RawSignal } from "../../core/types";
import type { FetchOptions, TrendSource } from "./types";

/**
 * Offline fixture: hand-written signal titles so the pipeline can run end-to-end without network.
 * URLs use the mock:// scheme so they can never be mistaken for real evidence.
 */
const FIXTURE: [source: string, title: string, daysAgo: number, points: number][] = [
  ["hackernews", "Show HN: Verifiable agent identity for autonomous AI agents", 0.5, 412],
  ["hackernews", "Agent identity is the missing layer of the agentic web", 1.2, 233],
  ["github", "agent identity: open protocol for issuing credentials to AI agents", 1.0, 1800],
  ["producthunt", "Passport for agents: agent identity and verification in one API", 2.0, 640],
  ["rss:techcrunch.com", "Startup raises $12M seed to build agent identity infrastructure", 1.5, 0],
  ["reddit", "How are you handling agent identity and auth for tool calls?", 3.0, 310],
  ["hackernews", "Agent payments: letting AI agents pay for APIs with scoped wallets", 0.8, 388],
  ["rss:techcrunch.com", "Agent payments startup lands Series A as AI checkout heats up", 1.1, 0],
  ["github", "agent payments sdk: spending limits and receipts for autonomous agents", 2.2, 950],
  ["producthunt", "AI checkout that lets agents complete purchases on any store", 0.9, 720],
  ["hackernews", "AI checkout conversion: what happens when the buyer is an agent", 2.5, 190],
  ["reddit", "Anyone testing AI checkout flows for agent shoppers?", 4.0, 120],
  ["hackernews", "Show HN: AI receptionist that answers calls for dental clinics", 1.3, 276],
  ["producthunt", "AI receptionist for small businesses: books appointments 24/7", 0.6, 830],
  ["reddit", "My AI receptionist booked 40 appointments this week", 2.1, 540],
  ["rss:techcrunch.com", "Voice AI receptionist startup raises $20M", 3.5, 0],
  ["hackernews", "Context engineering is replacing prompt engineering", 1.0, 501],
  ["github", "context engineering toolkit: memory, retrieval and compaction for LLM apps", 1.7, 2600],
  ["reddit", "Context engineering resources for production agents?", 2.8, 260],
  ["hackernews", "Agent security: prompt injection is now a supply chain problem", 0.7, 444],
  ["github", "agent security scanner: red-team your tool-using agents", 2.4, 1300],
  ["rss:techcrunch.com", "Agent security firm raises $30M to protect enterprise AI agents", 1.9, 0],
  ["hackernews", "Voice commerce is finally working thanks to realtime models", 5.5, 150],
  ["reddit", "Voice commerce for restaurants: ordering by phone with AI", 6.0, 95],
  ["hackernews", "OpenAI announces new ChatGPT agent mode", 0.4, 1200],
  ["hackernews", "Claude Code tips from power users", 1.4, 600],
  ["hackernews", "Show HN: I built a Rust game engine in a weekend", 0.3, 300],
  ["github", "awesome rust gamedev list", 1.1, 700],
  ["hackernews", "Ask HN: What are you working on this month?", 2.0, 400],
  ["rss:techcrunch.com", "Nvidia earnings beat expectations again", 0.2, 0],
];

export class MockSource implements TrendSource {
  readonly name = "mock";
  readonly mock = true;

  async fetch(opts: FetchOptions, costs: CostTracker, _log: Logger): Promise<RawSignal[]> {
    costs.call("mock", "trend_fixture", 1, 0);
    return FIXTURE.filter(([, , d]) => d <= opts.lookbackDays).map(([source, title, daysAgo, points], i) => ({
      source,
      source_id: `mock-${i}`,
      source_url: `mock://${source.replace(/[^a-z.]/g, "")}/${i}`,
      title,
      text: null,
      published_at: new Date(opts.now.getTime() - daysAgo * 86400_000).toISOString(),
      engagement: source === "github" ? { stars: points } : source === "producthunt" ? { votes: points } : { points },
      tags: [],
      mock: true,
    }));
  }
}
