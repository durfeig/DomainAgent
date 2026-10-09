-- Arbitrage OS — initial schema (Analyst MVP, vertical 1: domains)
-- Market-agnostic core: opportunities point to assets of a `market` (domain | api | etsy_product | stock_asset | ...).
-- Column names mirror src/core/types.ts; supabase-js rejects unknown columns, so keep them in sync.

-- gen_random_uuid() is built into Postgres >= 13 (Supabase runs 15+): no extension needed.

-- ------------------------------------------------------------------ runs & observability
create table if not exists public.runs (
  id               uuid primary key default gen_random_uuid(),
  status           text not null check (status in ('running','succeeded','failed')),
  trigger          text not null default 'manual',
  mode             text not null check (mode in ('mock','mixed','live')),
  adapters         jsonb not null default '{}',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  duration_ms      integer,
  funnel           jsonb not null default '{}',
  discard_reasons  jsonb not null default '{}',
  llm_cost_usd     numeric(12,4) not null default 0,
  api_cost_usd     numeric(12,4) not null default 0,
  total_cost_usd   numeric(12,4) not null default 0,
  tokens_in        bigint not null default 0,
  tokens_out       bigint not null default 0,
  api_calls        jsonb not null default '{}',
  errors           jsonb not null default '[]',
  warnings         jsonb not null default '[]',
  config           jsonb not null default '{}',   -- redacted: secrets are never stored
  digest_text      text
);
create index if not exists runs_started_at_idx on public.runs (started_at desc);

create table if not exists public.run_events (
  id       uuid primary key default gen_random_uuid(),
  run_id   uuid references public.runs(id) on delete cascade,
  ts       timestamptz not null default now(),
  level    text not null check (level in ('debug','info','warn','error')),
  stage    text not null,
  event    text not null,
  data     jsonb
);
create index if not exists run_events_run_idx on public.run_events (run_id, ts);
create index if not exists run_events_level_idx on public.run_events (level) where level in ('warn','error');

create table if not exists public.costs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references public.runs(id) on delete cascade,
  provider    text not null,
  kind        text not null check (kind in ('llm','api')),
  operation   text not null,
  model       text,
  units       integer not null default 1,
  tokens_in   integer not null default 0,
  tokens_out  integer not null default 0,
  usd         numeric(12,6),            -- null = price unknown (never guessed)
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists costs_run_idx on public.costs (run_id);

-- ------------------------------------------------------------------ trend scouting
create table if not exists public.trend_signals (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references public.runs(id) on delete set null,
  source        text not null,
  source_id     text not null,
  source_url    text not null,
  title         text not null,
  text          text,
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  engagement    jsonb not null default '{}',
  tags          jsonb not null default '[]',
  mock          boolean not null default false,
  hash          text not null unique          -- sha1(source|source_id)
);
create index if not exists trend_signals_published_idx on public.trend_signals (published_at desc);

create table if not exists public.concepts (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  description           text,
  commercial_rationale  text,
  keywords              jsonb not null default '[]',
  durability            text not null check (durability in ('DURABLE','HYPE','UNCLEAR')),
  durability_reason     text,
  frequency             integer not null default 0,
  sources               jsonb not null default '[]',
  momentum              numeric(10,2),        -- null = unknown (not enough history)
  confidence            integer not null check (confidence between 0 and 100),
  score                 integer not null check (score between 0 and 100),
  evidence_signal_ids   jsonb not null default '[]',
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  last_run_id           uuid references public.runs(id) on delete set null
);

create table if not exists public.concept_signals (
  id          uuid primary key default gen_random_uuid(),
  concept_id  uuid not null references public.concepts(id) on delete cascade,
  signal_id   uuid not null references public.trend_signals(id) on delete cascade,
  run_id      uuid references public.runs(id) on delete set null,
  unique (concept_id, signal_id)
);

-- ------------------------------------------------------------------ assets (market-agnostic)
create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  market      text not null,                 -- 'domain' today
  identifier  text not null,                 -- e.g. 'agentpassport.com'
  attributes  jsonb not null default '{}',   -- vertical-specific (sld, tld, parts, strategy...)
  created_at  timestamptz not null default now(),
  unique (market, identifier)
);

create table if not exists public.availability_checks (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid references public.runs(id) on delete set null,
  domain             text not null,
  provider           text not null,
  registrar          text not null,
  sandbox            boolean not null default false,
  mock               boolean not null default false,
  registrable        boolean not null,
  reason             text,
  tier               text,
  currency           text,
  registration_cost  numeric(12,2),
  renewal_cost       numeric(12,2),
  checked_at         timestamptz not null default now(),
  raw                jsonb,
  unique (domain, provider)
);
create index if not exists availability_checked_idx on public.availability_checks (checked_at desc);

create table if not exists public.market_keyword_stats (
  id            uuid primary key default gen_random_uuid(),
  keyword       text not null,
  source        text not null,               -- e.g. 'namebio_keyword_stats'
  as_of         date,
  sales_count   integer,
  avg_price     numeric(14,2),
  median_price  numeric(14,2),
  max_price     numeric(14,2),
  mock          boolean not null default false,
  unique (keyword, source)
);

-- ------------------------------------------------------------------ opportunities & underwriting
create table if not exists public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  market                text not null,
  asset_id              uuid not null references public.assets(id) on delete cascade,
  asset_identifier      text not null,
  concept_id            uuid references public.concepts(id) on delete set null,
  run_id                uuid references public.runs(id) on delete set null,   -- last run that evaluated it
  thesis                text,
  score                 integer not null check (score between 0 and 100),
  confidence            integer not null check (confidence between 0 and 100),
  registration_cost     numeric(12,2),
  renewal_cost          numeric(12,2),
  currency              text,
  estimated_value_low   numeric(14,2),
  estimated_value_base  numeric(14,2),
  estimated_value_high  numeric(14,2),
  ev_base_36m           numeric(14,2),
  trademark_risk        text not null check (trademark_risk in ('LOW','MEDIUM','HIGH')),
  recommended           boolean not null default false,
  rank                  integer,
  status                text not null default 'NEW'
                        check (status in ('NEW','APPROVED','REJECTED','WATCH','BOUGHT','ARCHIVED')),
  surfaced_at           timestamptz,
  mock                  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (market, asset_id)
);
create index if not exists opportunities_status_idx on public.opportunities (status, updated_at desc);
create index if not exists opportunities_identifier_idx on public.opportunities (market, asset_identifier);

create table if not exists public.evaluations (
  id                        uuid primary key default gen_random_uuid(),
  opportunity_id            uuid not null references public.opportunities(id) on delete cascade,
  run_id                    uuid references public.runs(id) on delete set null,
  underwriter_version       text not null,
  model                     text not null,
  components                jsonb not null,           -- final component scores (0-100)
  components_deterministic  jsonb not null,
  components_llm            jsonb,
  weighted_score            numeric(6,2) not null,
  trademark_risk            text not null check (trademark_risk in ('LOW','MEDIUM','HIGH')),
  trademark_penalty         integer not null,
  final_score               integer not null,
  confidence                integer not null,
  confidence_llm            integer,
  confidence_cap            integer not null,
  thesis                    text,
  why_now                   text,
  risks                     jsonb not null default '[]',
  evidence                  jsonb not null default '[]',
  potential_buyers          jsonb not null default '[]',
  retail_estimate           jsonb,                     -- ESTIMATE
  ev                        jsonb,                     -- ESTIMATE: bear/base/bull x 12/24/36m
  recommended               boolean not null,
  rejection_reasons         jsonb not null default '[]',
  facts                     jsonb not null default '[]',
  raw_llm                   jsonb,
  created_at                timestamptz not null default now()
);
create index if not exists evaluations_opp_idx on public.evaluations (opportunity_id, created_at desc);

create table if not exists public.evidence (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid references public.opportunities(id) on delete cascade,
  evaluation_id   uuid references public.evaluations(id) on delete cascade,
  concept_id      uuid references public.concepts(id) on delete cascade,
  kind            text not null check (kind in ('FACT','ESTIMATE','INFERENCE')),
  category        text not null,
  claim           text not null,
  source          text not null,
  source_url      text,
  fact_ref        text,
  mock            boolean not null default false,
  value           jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists evidence_opp_idx on public.evidence (opportunity_id);

-- ------------------------------------------------------------------ human decisions (feedback loop)
create table if not exists public.decisions (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  action          text not null check (action in ('APPROVE','REJECT','WATCH','BUY')),
  reason          text not null default '',
  human_or_agent  text not null check (human_or_agent in ('human','agent')),
  actor           text not null,
  snapshot        jsonb not null default '{}',   -- what the system believed at decision time
  created_at      timestamptz not null default now()
);
create index if not exists decisions_opp_idx on public.decisions (opportunity_id, created_at desc);

-- Positions: assets actually acquired. In the MVP only via a manual BUY decision (purchase done by a human).
create table if not exists public.positions (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid references public.opportunities(id) on delete set null,
  asset_id          uuid references public.assets(id) on delete set null,
  acquired_at       timestamptz not null default now(),
  acquisition_cost  numeric(12,2) not null,
  renewal_cost      numeric(12,2),
  currency          text not null default 'USD',
  status            text not null default 'HELD' check (status in ('HELD','LISTED','SOLD','DROPPED')),
  executed_by       text not null check (executed_by in ('human','agent')),
  notes             text
);

-- ------------------------------------------------------------------ security
-- RLS on, no policies: only the service role (server-side) can read/write. Never expose the anon key with these tables.
alter table public.runs                 enable row level security;
alter table public.run_events           enable row level security;
alter table public.costs                enable row level security;
alter table public.trend_signals        enable row level security;
alter table public.concepts             enable row level security;
alter table public.concept_signals      enable row level security;
alter table public.assets               enable row level security;
alter table public.availability_checks  enable row level security;
alter table public.market_keyword_stats enable row level security;
alter table public.opportunities        enable row level security;
alter table public.evaluations          enable row level security;
alter table public.evidence             enable row level security;
alter table public.decisions            enable row level security;
alter table public.positions            enable row level security;
