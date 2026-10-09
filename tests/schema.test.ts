import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { runScout } from "../src/pipeline/run";
import { createStore, TABLES } from "../src/adapters/store";
import { Repo } from "../src/core/repo";
import { testConfig } from "./helpers";

/**
 * Applies the Supabase migrations to an embedded Postgres (PGlite) and inserts every row the
 * pipeline wrote in a mock run. Catches drift between src/core/types.ts and the SQL schema
 * (supabase-js rejects unknown columns at runtime).
 */
const ORDER = [
  "runs", "run_events", "costs", "trend_signals", "concepts", "concept_signals", "assets", "availability_checks",
  "market_keyword_stats", "opportunities", "evaluations", "evidence", "decisions", "positions",
] as const;

describe("SQL migrations vs. pipeline rows", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated;");
    const dir = path.resolve("supabase/migrations");
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  });

  it("every table the code uses exists", async () => {
    const res = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'");
    const tables = new Set(res.rows.map((r) => r.table_name));
    for (const t of TABLES) expect(tables).toContain(t);
  });

  it("every row written by a mock run (incl. a decision and a BUY position) fits the schema", async () => {
    const cfg = testConfig();
    const result = await runScout(cfg, { quiet: true });
    const store = createStore(cfg);
    const repo = new Repo(store);
    await repo.recordDecision(result.surfaced[0].id, { action: "BUY", reason: "bought by hand", human_or_agent: "human", acquisition_cost: 10.44 }, "diego");
    await store.upsert("market_keyword_stats", [{ keyword: "agent", source: "namebio_keyword_stats", as_of: "2026-10-01", sales_count: 10, avg_price: 1, median_price: 1, max_price: 1, mock: false }], ["keyword", "source"]);

    for (const table of ORDER) {
      const rows = await store.select<Record<string, unknown>>(table, { limit: 100000 });
      for (const row of rows) {
        const cols = Object.keys(row);
        const values = cols.map((c) => {
          const v = row[c];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        const sql = `insert into public.${table} (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`;
        try {
          await db.query(sql, values);
        } catch (e) {
          throw new Error(`${table}: ${(e as Error).message}\nrow keys: ${cols.join(",")}`);
        }
      }
    }
    const v = await db.query<{ n: number }>("select count(*)::int as n from public.v_feedback_dataset");
    expect(v.rows[0].n).toBe(1);
  }, 60_000);
});
