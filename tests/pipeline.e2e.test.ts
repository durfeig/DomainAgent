import { describe, expect, it } from "vitest";
import { runScout } from "../src/pipeline/run";
import { Repo } from "../src/core/repo";
import { createStore } from "../src/adapters/store";
import type { Opportunity } from "../src/core/types";
import { testConfig } from "./helpers";

describe("RUN SCOUT (all mocks, file store)", () => {
  it("considers thousands of candidates and surfaces at most 5", async () => {
    const cfg = testConfig();
    const res = await runScout(cfg, { quiet: true, trigger: "test" });
    const f = res.run.funnel;
    expect(res.run.status).toBe("succeeded");
    expect(res.run.mode).toBe("mock");
    expect(f.generated).toBeGreaterThan(1000);
    expect(f.availability_checked).toBeLessThanOrEqual(cfg.MAX_AVAILABILITY_CHECKS);
    expect(f.underwritten).toBeLessThanOrEqual(cfg.MAX_UNDERWRITE);
    expect(res.surfaced.length).toBeLessThanOrEqual(5);
    expect(res.digest.text).toContain("ARBITRAGE SCOUT");
    expect(res.digest.text).toContain("MOCK MODE");
    for (const o of res.surfaced) {
      expect(o.score).toBeGreaterThanOrEqual(cfg.MIN_SCORE);
      expect(o.confidence).toBeGreaterThanOrEqual(cfg.MIN_CONFIDENCE);
      expect(o.trademark_risk).not.toBe("HIGH");
      expect(o.mock).toBe(true);
    }
  });

  it("persists run, events, costs, evaluations and evidence", async () => {
    const cfg = testConfig();
    const res = await runScout(cfg, { quiet: true });
    const store = createStore(cfg);
    const repo = new Repo(store);
    expect((await repo.getRun(res.run.id))?.status).toBe("succeeded");
    expect((await repo.runEvents(res.run.id)).length).toBeGreaterThan(5);
    expect((await store.select("costs", { eq: { run_id: res.run.id } })).length).toBeGreaterThan(0);
    const evals = await store.select<{ facts: unknown[]; evidence: { type: string; fact_ids: string[] }[] }>("evaluations");
    expect(evals.length).toBe(res.run.funnel.underwritten);
    for (const e of evals) {
      for (const ev of e.evidence) if (ev.type === "FACT") expect(ev.fact_ids.length).toBeGreaterThan(0);
    }
    expect((await store.select("evidence")).length).toBeGreaterThan(0);
  });

  it("never surfaces a decided asset again and records the feedback snapshot", async () => {
    const cfg = testConfig();
    const first = await runScout(cfg, { quiet: true });
    const repo = new Repo(createStore(cfg));
    const target = first.surfaced[0] as Opportunity;
    expect(target).toBeDefined();
    const d = await repo.recordDecision(target.id, { action: "REJECT", reason: "test", human_or_agent: "human" }, "diego");
    expect(d.snapshot).toMatchObject({ asset: target.asset_identifier, score: target.score });
    const second = await runScout(cfg, { quiet: true });
    expect(second.surfaced.map((o) => o.asset_identifier)).not.toContain(target.asset_identifier);
    expect(second.run.discard_reasons["prefilter:ALREADY_DECIDED"]).toBeGreaterThan(0);
  });
});
