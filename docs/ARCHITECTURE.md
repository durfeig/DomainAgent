# Arquitectura

## Principios

1. **Simplicidad**: un solo proceso TypeScript ejecuta el pipeline completo (`runScout`). n8n solo agenda y notifica.
2. **Bajo costo**: el LLM nunca recorre miles de candidatos. Todo lo masivo es determinístico (generación, filtros, pre-score); el LLM solo agrupa conceptos (1 llamada), propone palabras (1 llamada) y underwritea el top N (default 12).
3. **Observabilidad**: cada run guarda funnel, motivos de descarte, llamadas a APIs, tokens, costos, errores, duración y un log estructurado por etapa.
4. **Componentes reemplazables**: cada integración es un adapter con mock (`LLMProvider`, `RegistrarProvider`, `MarketDataProvider`, `TrendSource`, `TableStore`).
5. **Datos verificables**: el LLM solo puede citar hechos de una *fact sheet* construida por código, con IDs (`F1…Fn`). Claims FACT sin cita se degradan a INFERENCE. Datos faltantes = `null`, nunca inventados.
6. **Sin scraping frágil**: solo APIs oficiales/estables (Algolia HN, GitHub REST, Reddit OAuth, Product Hunt GraphQL, RSS, Cloudflare, NameBio).

## Flujo de un run

```
             ┌───────────── n8n (cron 08:45 / 17:45 ART) ──────────────┐
             │  POST /api/runs (Bearer)  →  digest_text  →  Slack      │
             └────────────────────────────────────────────────────────┘
                                   │
runScout()  (src/pipeline/run.ts)  ▼
 1 TREND SCOUT        sources/* → trend_signals (dedupe por hash)          [sin LLM]
                      phrases.ts: bigramas/trigramas, doc-freq, diversidad de fuentes,
                      engagement, momentum vs historial (null si < 7 días de historia)
 2 CONCEPT EXTRACTOR  1 llamada LLM: agrupa frases → conceptos genéricos + durabilidad
                      Guardas en código: IDs de evidencia deben existir, ≥2 señales,
                      sin conceptos de una empresa, trademark HIGH fuera, confidence ≤ cap por fuentes
 3 DOMAIN GENERATOR   1 llamada LLM: lexicon (sinónimos, verbos, raíces) por concepto
                      Combinatoria determinística: exact, semantic, noun+noun, verb+noun,
                      prefix, suffix, brandable (blends) × TLDs → 50–300 SLDs por concepto
 4 PRE-FILTER         largo, dígitos, guiones, caracteres confusos, doble letra en la unión,
                      pronunciabilidad, TLD redundante, trademark HIGH, ya decidido   [sin API]
                      pre-score + cuota por concepto → top MAX_AVAILABILITY_CHECKS
 5 AVAILABILITY       Cloudflare domain-check (20 por request), cache de negativos 14 días.
                      Fuera: no registrable, premium, precio desconocido, precio > ANALYSIS_MAX_ASSET_COST
 6 MARKET DATA        keyword stats (tabla importada) + NameBio comps (top MAX_ENRICH)
 7 UNDERWRITER        quant score → top MAX_UNDERWRITE al LLM. Fact sheet → LLM (structured output)
                      → merge pesimista con componentes determinísticos → score, confidence (con cap),
                      retail (clamp a comparables), EV, reglas duras
 8 PERSIST            assets, opportunities (1 por asset), evaluations (1 por run), evidence
 9 RANK + DIGEST      score×confidence, desempate por EV, máx. 2 por concepto, máx. 5 total.
                      Auto-trader en dry-run (solo log). Digest → run.digest_text
```

## Qué APIs están realmente disponibles (verificado oct-2026)

| Fuente | Estado | Notas |
|---|---|---|
| Cloudflare Registrar API | **Beta**. `POST /accounts/{id}/registrar/domain-check` (≤20 dominios, real-time, read-only) y `/registrar-sandbox/domain-check` | `pricing` (`currency`, `registration_cost`, `renewal_cost` como strings) solo si `registrable=true`. Premium no registrable vía API → lo excluimos. |
| NameBio | **API paga** (Business, a pedido). Comps: `https://api.namebio.com/comps/`, 25 créditos/llamada, `price_from` mínimo $1.000 | Nombres exactos de campos de respuesta **no verificables desde este entorno** → parser defensivo; lo no parseable queda `null`. Keyword stats: planilla gratuita en su página de API → importador CSV. Revisar ToS (prohíbe usar datos para entrenar IA). |
| Hacker News | Algolia API pública, sin key | `search_by_date` con `created_at_i` y `points`. |
| GitHub | REST search, token opcional | No existe API oficial de "Trending": usamos repos creados recientemente ordenados por estrellas. |
| Reddit | OAuth app (client_credentials) | Requiere app registrada y User-Agent. |
| Product Hunt | GraphQL v2 con developer token | Revisar términos para uso comercial. |
| Google Trends | **API oficial en alpha, solo por aplicación** | Adapter stub deshabilitado (`google-trends.ts`). pytrends archivado. No scrapeamos. |
| Noticias / funding | RSS (TechCrunch startups + AI por default) | Configurable `RSS_FEEDS`. |

> Desde el contenedor donde se construyó el MVP la red saliente estaba restringida: los adapters live se escribieron contra la documentación y se testearon con fixtures; la primera corrida real es parte del checklist de deployment.

## Underwriter

**Objetivo: preservar capital.** El prompt completo está en `src/prompts/underwriter.ts`.

### Componentes (0–100) y pesos

| Componente | Peso | Determinístico (código) | LLM | Final |
|---|---|---|---|---|
| demand_evidence | 25% | fuentes distintas, engagement, frecuencia | sí | **mín(det, llm)** |
| historical_market | 20% | comps (mediana, profundidad, recencia, TLD) + keyword stats; sin datos = 25 | sí | **mín(det, llm)** |
| buyer_universe | 15% | heurística (solo mock/fallback) | sí | llm |
| brandability | 15% | largo, palabras, clusters de consonantes, padding | sí | promedio |
| trend_momentum | 10% | momentum (null = 40) ± durabilidad | sí | **mín(det, llm)** |
| tld_quality | 10% | tabla (.com 100, .ai 75/85 si encaja, .io 55, .co 45) | — | det |
| capital_efficiency | 5% | costo de 3 años (con mínimo de años por TLD) | — | det |

Penalidad trademark: LOW 0 · MEDIUM −15 · HIGH −40. El riesgo final es el **máximo** entre screen automático, prefiltro y LLM (el LLM puede subirlo, nunca bajarlo).

### Score y confidence son independientes

`confidence = min(confidence_LLM, cap_por_cobertura_de_datos)`. El cap arranca en 30 y suma por: comparables (+20), keyword stats (+10), disponibilidad live (+10), ≥2/≥3 fuentes (+10/+5), momentum conocido (+10), DURABLE (+5). **Sin ningún dato de mercado, cap = 55** (`CONFIDENCE_CAP_NO_MARKET_DATA`) → nunca se recomienda.

### Reglas duras (todas deben pasar)

`score ≥ 75` · `confidence ≥ 60` · `trademark ≠ HIGH` · registrable · retail estimate no nulo · `EV base 36m > 0` · veredicto LLM = INVEST.

### Expected Value (ESTIMATE, baja precisión a propósito)

```
p_anual: bear = base×0.5 · base = base×clamp((score−50)/25, 0.5, 3) · bull = base×2.5   (base = SELL_THROUGH_ANNUAL_BASE = 1%)
P(venta en H años) = 1 − (1 − p)^H
Costo esperado = registro × años_mínimos_TLD + Σ renovación × P(no vendido al año y)
EV_H = P(venta) × precio_escenario × (1 − fee marketplace 20%) − costo esperado
```

Precio por escenario = retail low/base/high. El retail del LLM se **recorta** a lo que soportan los comparables (≤ p25 / mediana / máximo) — y los comps de NameBio ya están sesgados hacia arriba por el piso de $1.000.

## Datos: FACT / ESTIMATE / INFERENCE

- `evidence.kind` y `evaluations.evidence[].type` distinguen los tres siempre.
- `facts` = lo que el código le dio al LLM (con fuente, URL y flag `mock`).
- Todo lo sintético lleva `mock: true` y el run queda en modo `mock`/`mixed`, visible en digest y dashboard.

## Persistencia (Supabase)

Tablas: `runs`, `run_events`, `costs`, `trend_signals`, `concepts`, `concept_signals`, `assets`, `availability_checks`, `market_keyword_stats`, `opportunities`, `evaluations`, `evidence`, `decisions`, `positions`.
Vistas: `v_feedback_dataset` (cada decisión con el snapshot de lo que el sistema creía), `v_run_funnel`, `v_capital_deployed`.

- **Agnóstico de mercado**: `opportunities.market` + `assets(market, identifier, attributes jsonb)`. Un producto de Etsy o una API son otro `market` con otros `attributes`.
- Una oportunidad por asset; cada run agrega una `evaluation` (historial completo).
- RLS activado sin policies: solo el service role (server-side) lee/escribe.

## Feedback loop

`decisions` guarda acción, motivo, actor, humano/agente y un `snapshot` (score, confidence, componentes det/LLM, versión de prompt, modelo). `v_feedback_dataset` es el dataset listo para calibrar pesos, filtros y thresholds. No se entrena nada todavía.

## Observabilidad

Por run: funnel completo, `discard_reasons` (p.ej. `prefilter:TOO_LONG`, `availability:UNAVAILABLE`, `underwriter:score`), `api_calls` por proveedor/operación, tokens in/out, costo LLM/API/total (precio desconocido = `null`, contado en warnings), errores, warnings (incluye alerta de calibración si pasan > 15 candidatos), duración y `run_events` (JSON estructurado por etapa). Pantalla `/runs/{id}`.

## Seguridad

- Secrets solo por env; `redactedConfig()` guarda la config del run sin secretos; el logger redacta claves sensibles.
- `registerDomain()` lanza `PurchaseBlockedError` en todos los registrars; `executeAutoBuy()` exige `AUTO_BUY_ENABLED=true` **y** aun así el registrar se niega (doble candado). Tests lo verifican.
- Dashboard con Basic Auth; API con Bearer; en producción sin password el dashboard queda bloqueado (503).
