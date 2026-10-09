import { describe, expect, it } from "vitest";
import { parseCloudflareCheck, CloudflareRegistrar } from "../src/adapters/registrar/cloudflare";
import { MockRegistrar } from "../src/adapters/registrar/mock";
import { PurchaseBlockedError } from "../src/adapters/registrar";
import { parseNameBioComps, camelCaseDomain } from "../src/adapters/market/namebio";
import { parseFeed } from "../src/adapters/sources/rss";
import { XMLParser } from "fast-xml-parser";
import { assessAutoBuy, executeAutoBuy } from "../src/trader/auto-trader";
import { budgetStatus, budgetViolations } from "../src/trader/budget-guard";
import { CostTracker, anthropicCostUsd, BudgetExceededError } from "../src/core/cost";
import { redact } from "../src/core/logger";
import { loadConfig, redactedConfig } from "../src/config";
import type { Opportunity } from "../src/core/types";

describe("Cloudflare Registrar parser", () => {
  it("parses registrable / non-registrable / premium / missing domains", () => {
    const body = {
      success: true,
      errors: [],
      result: {
        domains: [
          { name: "agentpassport.com", registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.44", renewal_cost: "10.44" } },
          { name: "agent.com", registrable: false, reason: "domain_unavailable" },
          { name: "pay.ai", registrable: true, tier: "premium", pricing: { currency: "USD", registration_cost: "2500.00", renewal_cost: "80.00" } },
        ],
      },
    };
    const r = parseCloudflareCheck(body, ["agentpassport.com", "agent.com", "pay.ai", "ghost.com"], { provider: "cloudflare", sandbox: false });
    expect(r[0]).toMatchObject({ registrable: true, registration_cost: 10.44, renewal_cost: 10.44, currency: "USD", tier: "standard" });
    expect(r[1]).toMatchObject({ registrable: false, reason: "domain_unavailable", registration_cost: null });
    expect(r[2].tier).toBe("premium");
    expect(r[3]).toMatchObject({ registrable: false, reason: "missing_from_response" });
  });
  it("throws on API errors", () => {
    expect(() => parseCloudflareCheck({ success: false, errors: [{ code: 10000, message: "auth" }] }, ["a.com"], { provider: "cloudflare", sandbox: false })).toThrow();
  });
});

describe("registerDomain is blocked", () => {
  const req = { domain: "x.com", years: 1, acknowledged_price: 10, approved_by: "test", opportunity_id: "o" };
  it("mock and cloudflare registrars refuse to register", async () => {
    await expect(new MockRegistrar().registerDomain(req)).rejects.toBeInstanceOf(PurchaseBlockedError);
    await expect(new CloudflareRegistrar("acct", "token", true).registerDomain(req)).rejects.toBeInstanceOf(PurchaseBlockedError);
  });
  it("auto-trader refuses with AUTO_BUY_ENABLED=false even for a perfect opportunity", async () => {
    const cfg = loadConfig({ AUTO_BUY_ENABLED: "false" });
    expect(cfg.AUTO_BUY_ENABLED).toBe(false);
    const opp = { id: "o", asset_identifier: "x.com", score: 99, confidence: 99, trademark_risk: "LOW", registration_cost: 10, mock: false, recommended: true } as Opportunity;
    const budget = budgetStatus([], cfg);
    const a = assessAutoBuy(opp, budget, cfg);
    expect(a.eligible).toBe(true);
    await expect(executeAutoBuy(opp, a, new MockRegistrar(), cfg)).rejects.toThrow(/AUTO_BUY_ENABLED=false/);
    // Even if someone flips the flag, the registrar still refuses in the MVP.
    const on = loadConfig({ AUTO_BUY_ENABLED: "true" });
    await expect(executeAutoBuy(opp, a, new MockRegistrar(), on)).rejects.toBeInstanceOf(PurchaseBlockedError);
  });
});

describe("budget guard", () => {
  it("enforces max asset cost, monthly budget and daily count", () => {
    const cfg = loadConfig({ MONTHLY_BUDGET: "200", MAX_ASSET_COST: "15", MAX_DAILY_ASSETS: "2" });
    const now = new Date("2026-10-09T12:00:00Z");
    const b = budgetStatus(
      [
        { acquired_at: "2026-10-09T01:00:00Z", acquisition_cost: 10 },
        { acquired_at: "2026-10-09T02:00:00Z", acquisition_cost: 185 },
        { acquired_at: "2026-09-01T00:00:00Z", acquisition_cost: 50 },
      ],
      cfg,
      now,
    );
    expect(b.spent_this_month).toBe(195);
    const v = budgetViolations(20, b);
    expect(v.join("|")).toMatch(/max_asset_cost/);
    expect(v.join("|")).toMatch(/remaining monthly budget/);
    expect(v.join("|")).toMatch(/daily asset limit/);
  });
});

describe("NameBio comps parser", () => {
  it("parses rows defensively and never invents fields", () => {
    const r = parseNameBioComps({ status: "success", credits_remaining: 975, comps: [{ domain: "AgentHub.com", price: "4,500", date: "2025-03-01", venue: "Sedo" }, { domain: "x.com" }] });
    expect(r.comps).toHaveLength(1);
    expect(r.comps![0]).toMatchObject({ domain: "agenthub.com", price: 4500, venue: "Sedo" });
    expect(r.credits_remaining).toBe(975);
    expect(parseNameBioComps({ weird: true }).comps).toBeNull();
    expect(parseNameBioComps({ status: "error", status_message: "bad key" }).error).toBe("bad key");
  });
  it("CamelCases using known parts", () => {
    expect(camelCaseDomain("agentpassport.com", ["agent", "passport"])).toBe("AgentPassport.com");
  });
});

describe("RSS parser", () => {
  it("parses RSS items within the window", () => {
    const xml = `<rss><channel><item><title>Agent payments startup raises $10M</title><link>https://example.com/a</link><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>Old</title><link>https://example.com/b</link><pubDate>Thu, 01 Jan 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
    const out = parseFeed(doc, "https://techcrunch.com/feed/", new Date("2026-10-01").getTime());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "rss:techcrunch.com", source_url: "https://example.com/a", mock: false });
  });
});

describe("costs & secrets", () => {
  it("prices Anthropic tokens and returns null for unknown models", () => {
    expect(anthropicCostUsd("claude-opus-5-5", 1_000_000, 100_000)).toBeCloseTo(4 + 2, 6);
    expect(anthropicCostUsd("unknown-model", 1000, 1000)).toBeNull();
  });
  it("enforces the per-run LLM budget", () => {
    const c = new CostTracker(0.01);
    c.add({ provider: "anthropic", kind: "llm", operation: "x", units: 1, tokens_in: 0, tokens_out: 0, usd: 0.02 });
    expect(() => c.assertLlmBudget()).toThrow(BudgetExceededError);
  });
  it("never logs or stores secrets", () => {
    expect(redact({ api_key: "sk-123", nested: { authorization: "Bearer x", ok: 1 } })).toEqual({ api_key: "[redacted]", nested: { authorization: "[redacted]", ok: 1 } });
    const cfg = redactedConfig(loadConfig({ ANTHROPIC_API_KEY: "sk-secret", CLOUDFLARE_API_TOKEN: "cf-secret" }));
    expect(JSON.stringify(cfg)).not.toContain("secret");
    expect(cfg.ANTHROPIC_API_KEY).toBe("[set]");
  });
  it("hard-caps the digest at 5", () => {
    expect(loadConfig({ MAX_DIGEST: "50" }).MAX_DIGEST).toBe(5);
  });
});
