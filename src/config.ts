import { z } from "zod";

/**
 * Central configuration. Every value comes from the environment (.env) — never hardcode secrets.
 * Defaults are safe: mock adapters, file store, AUTO_BUY_ENABLED=false.
 */

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      if (typeof v === "boolean") return v;
      return ["1", "true", "yes", "on"].includes(v.toLowerCase());
    });

const num = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
      return n;
    });

const optNum = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

const list = (def: string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : v.split(",").map((s) => s.trim()).filter(Boolean)));

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v));

const EnvSchema = z.object({
  // ---------- Storage ----------
  STORE_PROVIDER: z.enum(["file", "supabase"]).optional().default("file"),
  DATA_DIR: str(".data"),
  SUPABASE_URL: optStr,
  SUPABASE_SERVICE_ROLE_KEY: optStr,

  // ---------- LLM ----------
  LLM_PROVIDER: z.enum(["mock", "anthropic", "openai"]).optional().default("mock"),
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL_FAST: str("claude-opus-5-5"),
  ANTHROPIC_MODEL_UNDERWRITER: str("claude-opus-5-5"),
  ANTHROPIC_EFFORT_FAST: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().default("low"),
  ANTHROPIC_EFFORT_UNDERWRITER: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().default("medium"),
  OPENAI_API_KEY: optStr,
  OPENAI_MODEL_FAST: optStr,
  OPENAI_MODEL_UNDERWRITER: optStr,
  OPENAI_PRICE_INPUT_PER_MTOK: optNum,
  OPENAI_PRICE_OUTPUT_PER_MTOK: optNum,
  RUN_LLM_BUDGET_USD: num(3),

  // ---------- Registrar ----------
  REGISTRAR_PROVIDER: z.enum(["mock", "cloudflare_sandbox", "cloudflare"]).optional().default("mock"),
  CLOUDFLARE_ACCOUNT_ID: optStr,
  CLOUDFLARE_API_TOKEN: optStr,

  // ---------- Market data ----------
  MARKET_PROVIDER: z.enum(["mock", "namebio", "none"]).optional().default("mock"),
  NAMEBIO_EMAIL: optStr,
  NAMEBIO_API_KEY: optStr,
  NAMEBIO_USD_PER_CREDIT: optNum,
  NAMEBIO_MAX_COMPS_CALLS_PER_RUN: num(20),
  NAMEBIO_COMPS_MONTHS_OLD: num(60),

  // ---------- Trend sources ----------
  TREND_SOURCES: list(["mock"]),
  TREND_LOOKBACK_DAYS: num(7),
  TREND_RECENT_DAYS: num(2),
  HN_MIN_POINTS: num(30),
  GITHUB_TOKEN: optStr,
  GITHUB_MIN_STARS: num(50),
  REDDIT_CLIENT_ID: optStr,
  REDDIT_CLIENT_SECRET: optStr,
  REDDIT_USER_AGENT: str("arbitrage-os/0.1 (analyst bot)"),
  REDDIT_SUBREDDITS: list(["SaaS", "startups", "artificial", "LocalLLaMA", "Entrepreneur"]),
  PRODUCTHUNT_TOKEN: optStr,
  RSS_FEEDS: list([
    "https://techcrunch.com/category/startups/feed/",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
  ]),

  // ---------- Generation / funnel ----------
  TLDS: list(["com", "ai"]),
  MAX_CONCEPTS: num(8),
  MAX_CANDIDATES_PER_CONCEPT: num(300),
  MAX_AVAILABILITY_CHECKS: num(400),
  AVAILABILITY_CACHE_DAYS: num(14),
  MAX_ENRICH: num(25),
  MAX_UNDERWRITE: num(12),
  MAX_DIGEST: num(5),
  MAX_PER_CONCEPT_IN_DIGEST: num(2),

  // ---------- Underwriting thresholds ----------
  MIN_SCORE: num(75),
  MIN_CONFIDENCE: num(60),
  REQUIRE_POSITIVE_EV: bool(true),
  CONFIDENCE_CAP_NO_MARKET_DATA: num(55),
  ANALYSIS_MAX_ASSET_COST: num(100),

  // ---------- Expected value assumptions (ESTIMATES, not facts) ----------
  SELL_THROUGH_ANNUAL_BASE: num(0.01),
  MARKETPLACE_FEE_PCT: num(0.2),

  // ---------- Budget guard (prepared for Phase 2 — no purchases in MVP) ----------
  MONTHLY_BUDGET: num(200),
  MAX_ASSET_COST: num(15),
  MAX_DAILY_ASSETS: num(2),
  MAX_MONTHLY_ASSETS: num(20),

  // ---------- Auto-trader (Phase 2 — disabled) ----------
  AUTO_BUY_ENABLED: bool(false),
  AUTO_BUY_MIN_SCORE: num(90),
  AUTO_BUY_MIN_CONFIDENCE: num(80),

  // ---------- Dashboard / API ----------
  API_SECRET: optStr,
  DASHBOARD_USER: str("diego"),
  DASHBOARD_PASSWORD: optStr,
  DASHBOARD_URL: str("http://localhost:3000"),
  DECISION_ACTOR: str("diego"),
  SLACK_WEBHOOK_URL: optStr,
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | null = null;

export function loadConfig(overrides: Record<string, unknown> = {}): Config {
  const merged: Record<string, unknown> = { ...process.env, ...overrides };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const cfg = parsed.data;
  // Hard cap from the product definition: never surface more than 5 per run.
  cfg.MAX_DIGEST = Math.min(Math.max(0, Math.floor(cfg.MAX_DIGEST)), 5);
  return cfg;
}

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For logs/run records: config with every secret removed. */
export function redactedConfig(cfg: Config): Record<string, unknown> {
  const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|EMAIL)/;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    out[k] = SECRET.test(k) ? (v ? "[set]" : null) : v;
  }
  return out;
}
