# Arbitrage OS — Analyst MVP (Domain Arbitrage)

Agente que busca oportunidades de arbitraje digital, las evalúa cuantitativamente y presenta **como máximo 5** por ejecución para aprobación humana. Vertical 1: **dominios**.

> **Analyst, no trader.** No compra ni publica nada. `registerDomain()` está bloqueado en código y `AUTO_BUY_ENABLED=false` por default (doble candado).
>
> *Lose little on losers. Scale winners.* — *Do not optimize for number of opportunities. Optimize for quality of capital allocation.*

```
SOURCES → TREND SCOUT → CONCEPT EXTRACTOR → DOMAIN GENERATOR → PRE-FILTER → AVAILABILITY
       → MARKET DATA → UNDERWRITER → SUPABASE → RANKING (máx. 5) → DIGEST / DASHBOARD → APPROVE / REJECT / WATCH
```

## Quick start (sin credenciales, todo mock)

```bash
npm install
cp .env.example .env          # defaults: mocks + store local en .data/
npm run scout                 # RUN SCOUT end-to-end → digest en consola + out/digest-*.md
npm run dev                   # dashboard en http://localhost:3000
npm test                      # 34 tests (incluye migraciones SQL aplicadas en Postgres embebido)
```

Un run mock típico: ~2.900 dominios generados → ~1.800 pasan pre-filtros → 400 chequeos de disponibilidad → ~30 disponibles → 25 enriquecidos → 12 underwritten → ≤5 en el digest. Todo marcado `MOCK` en digest y dashboard.

## Pasar a producción (por partes, cada adapter es independiente)

| Pieza | Variable | Qué activa |
|---|---|---|
| Persistencia | `STORE_PROVIDER=supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase/Postgres (aplicar `supabase/migrations/`) |
| LLM | `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | Concept extractor, lexicon, underwriter reales |
| Disponibilidad | `REGISTRAR_PROVIDER=cloudflare_sandbox` → `cloudflare` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Registrar API `domain-check` (solo lectura) |
| Market data | `MARKET_PROVIDER=namebio` + `NAMEBIO_EMAIL` + `NAMEBIO_API_KEY` | NameBio Comps API (paga, 25 créditos/llamada) |
| Keyword stats | `npm run import:namebio-keywords -- file.csv --as-of YYYY-MM-DD` | Estadísticas por keyword como FACT |
| Tendencias | `TREND_SOURCES=hackernews,github,rss[,reddit,producthunt]` | Fuentes reales (HN, GitHub, RSS no requieren key) |

Detalle: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · credenciales: [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run scout` | RUN SCOUT completo. `-- --quiet` solo digest; `-- --slack` lo postea a `SLACK_WEBHOOK_URL` |
| `npm run decide -- <id\|dominio> APPROVE "motivo"` | Registra decisión humana (feedback loop). También `REJECT`, `WATCH`, `BUY --cost 10.44` (BUY = compra que hiciste vos a mano) |
| `npm run digest [-- <run-id>]` | Reimprime el digest del último run |
| `npm run import:namebio-keywords -- file.csv --as-of 2026-10-01` | Importa keyword stats |
| `npm run export:schemas` | Regenera `/schemas/*.json` desde los Zod schemas |
| `npm run dev` / `build` / `start` | Dashboard + API (Next.js) |
| `npm test` / `npm run typecheck` | Tests / typecheck |

## API (para n8n)

Todas requieren `Authorization: Bearer $API_SECRET` (o la Basic Auth del dashboard), salvo `/api/health`.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/runs` | RUN SCOUT. Devuelve funnel, costos, oportunidades y `digest_text` |
| `GET` | `/api/runs` | Últimos runs (observabilidad) |
| `GET` | `/api/runs/{id\|latest}/digest` | Digest de un run |
| `GET` | `/api/opportunities?status=NEW` | Oportunidades por estado |
| `POST` | `/api/opportunities/{id}/decision` | `{ "action": "APPROVE"\|"REJECT"\|"WATCH"\|"BUY", "reason": "..." }` |
| `GET` | `/api/health` | Health check (público) |

## Estructura

```
src/
  config.ts                 env → config tipada (zod); defaults seguros
  core/                     tipos, schemas estrictos, logger estructurado, costos, repo (persistencia)
  adapters/
    llm/                    anthropic (structured outputs) | openai | mock
    registrar/              cloudflare (+sandbox) | mock — registerDomain() bloqueado
    market/                 namebio (comps) | none | mock
    sources/                hackernews | github | reddit | producthunt | rss | mock | google-trends (stub)
    store/                  supabase | file (JSON local)
  pipeline/                 phrases, concepts, generator, prefilter, trademark, prescore,
                            availability, enrichment, scoring, underwriter, digest, run (orquestador)
  prompts/                  concept-extractor, domain-lexicon, underwriter (versionados)
  trader/                   budget-guard, auto-trader (Fase 2, deshabilitado)
  verticals/                contrato para futuros asset types
  cli/                      scout, decide, digest, import, export-schemas
app/                        dashboard (Next.js) + API routes; proxy.ts = auth
supabase/migrations/        esquema + vistas (feedback dataset, funnel, capital)
n8n/                        workflows exportables (scout 2x/día + error alerts)
schemas/                    JSON Schemas de outputs LLM y API
tests/                      unit + e2e + consistencia SQL (PGlite)
docs/                       arquitectura, deployment, credenciales, decisiones pendientes, backlog
```

## Documentación

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura, scoring, EV, reglas, observabilidad, qué APIs están realmente disponibles.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase, Vercel, n8n, paso a producción.
- [docs/CREDENTIALS.md](docs/CREDENTIALS.md) — lista exacta de credenciales.
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisiones pendientes (costos, riesgos, credenciales).
- [docs/BACKLOG.md](docs/BACKLOG.md) — backlog Fase 2.
