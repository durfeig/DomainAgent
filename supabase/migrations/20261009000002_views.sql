-- Analytical views (read with the service role or from the Supabase SQL editor).

-- Calibration dataset: every human decision with what the system believed at that moment.
create or replace view public.v_feedback_dataset as
select
  d.id                    as decision_id,
  d.created_at            as decided_at,
  d.actor,
  d.human_or_agent,
  d.action,
  d.reason,
  o.market,
  o.asset_identifier,
  c.name                  as concept,
  (d.snapshot->>'score')::int        as score_at_decision,
  (d.snapshot->>'confidence')::int   as confidence_at_decision,
  d.snapshot->>'trademark_risk'      as trademark_risk_at_decision,
  (d.snapshot->>'recommended')::boolean as recommended_at_decision,
  (d.snapshot->>'mock')::boolean     as mock,
  d.snapshot->'components'           as components,
  d.snapshot->'components_deterministic' as components_deterministic,
  d.snapshot->'components_llm'       as components_llm,
  d.snapshot->>'underwriter_version' as underwriter_version,
  d.snapshot->>'model'               as model,
  (a.attributes->>'length')::int     as sld_length,
  a.attributes->>'tld'               as tld,
  a.attributes->>'strategy'          as strategy
from public.decisions d
join public.opportunities o on o.id = d.opportunity_id
join public.assets a on a.id = o.asset_id
left join public.concepts c on c.id = o.concept_id;

-- One row per run with the funnel flattened (for dashboards / alerts).
create or replace view public.v_run_funnel as
select
  r.id, r.started_at, r.status, r.mode, r.trigger, r.duration_ms,
  (r.funnel->>'signals')::int              as signals,
  (r.funnel->>'concepts')::int             as concepts,
  (r.funnel->>'generated')::int            as generated,
  (r.funnel->>'passed_prefilter')::int     as passed_prefilter,
  (r.funnel->>'availability_checked')::int as availability_checked,
  (r.funnel->>'available')::int            as available,
  (r.funnel->>'underwritten')::int         as underwritten,
  (r.funnel->>'recommended')::int          as recommended,
  (r.funnel->>'surfaced')::int             as surfaced,
  r.llm_cost_usd, r.api_cost_usd, r.total_cost_usd, r.tokens_in, r.tokens_out,
  jsonb_array_length(r.errors)             as error_count
from public.runs r;

-- Monthly spend vs budget (positions are only created by manual BUY decisions in the MVP).
create or replace view public.v_capital_deployed as
select
  date_trunc('month', acquired_at) as month,
  count(*)                         as assets,
  sum(acquisition_cost)            as capital_deployed
from public.positions
group by 1
order by 1 desc;

-- Views run with the privileges of the caller; keep them away from anon/authenticated roles.
revoke all on public.v_feedback_dataset from anon, authenticated;
revoke all on public.v_run_funnel from anon, authenticated;
revoke all on public.v_capital_deployed from anon, authenticated;
