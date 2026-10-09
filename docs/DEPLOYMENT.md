# Deployment

Orden recomendado: local mock → Supabase → LLM real → Cloudflare sandbox → fuentes reales → Cloudflare live → NameBio → Vercel → n8n.
Cada paso es un cambio de variables de entorno; el código no cambia.

## 0. Local (sin credenciales)

```bash
npm install
cp .env.example .env
npm run scout && npm run dev
```

## 1. Supabase

1. Crear proyecto en Supabase (región cercana a Vercel, p.ej. `us-east-1`).
2. Aplicar migraciones (cualquiera de las dos):
   - CLI: `supabase link --project-ref <ref>` y `supabase db push`, o
   - SQL editor: pegar en orden `supabase/migrations/20261009000001_init.sql` y `..._views.sql`.
3. En `.env`: `STORE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Settings → API). **El service role key solo va del lado servidor** (Vercel env / `.env` local). No hace falta el anon key: RLS está activado sin policies.
4. `npm run scout` → verificar filas en `runs`, `opportunities`, `evaluations`.

## 2. LLM (Anthropic)

`LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`. Modelos por tier en `ANTHROPIC_MODEL_FAST` / `ANTHROPIC_MODEL_UNDERWRITER` (default `claude-opus-5-5`). Usa structured outputs (JSON validado contra schema) y fallback server-side ante refusals. Límite de gasto por run: `RUN_LLM_BUDGET_USD` (default $3; si se alcanza, deja de underwritear y lo marca en warnings).

## 3. Cloudflare Registrar (sandbox → live)

1. Cuenta Cloudflare → copiar **Account ID**.
2. Crear **API token** con permisos de Registrar para la cuenta. Para el MVP solo se usa `domain-check` (lectura). No dar más permisos de los necesarios; la registración (Fase 2) requerirá permisos de escritura y un método de pago por default en la cuenta — **no configurarlo todavía**.
3. `REGISTRAR_PROVIDER=cloudflare_sandbox` → correr `npm run scout` y revisar `/runs/{id}` (api_calls `cloudflare_sandbox:domain-check`).
4. Cuando el sandbox funcione: `REGISTRAR_PROVIDER=cloudflare`. Es solo lectura (consulta el registry en tiempo real); **no reserva ni compra**.

## 4. Fuentes de tendencias

`TREND_SOURCES=hackernews,github,rss` funciona sin keys (GitHub con `GITHUB_TOKEN` tiene mejor rate limit). Reddit y Product Hunt se saltean (con warning) si faltan credenciales.

> Ojo: con `TREND_SOURCES` reales pero registrar/market mock el run queda en modo `mixed` y todo lo sintético se marca.

## 5. NameBio (market data)

1. Pedir acceso a la API (plan Business, a pedido) y comprar créditos.
2. `MARKET_PROVIDER=namebio`, `NAMEBIO_EMAIL`, `NAMEBIO_API_KEY`, `NAMEBIO_USD_PER_CREDIT` (para que el costo aparezca en USD), `NAMEBIO_MAX_COMPS_CALLS_PER_RUN` (default 20 → 500 créditos/run).
3. **Primera llamada real**: revisar el JSON crudo de `/comps/` y, si los nombres de campos difieren de los que contempla `parseNameBioComps` (`domain|name`, `price|amount`, `date|sale_date`, `venue`), ajustar el parser. Lo que no se pueda parsear queda `null` (no se inventa).
4. Keyword stats (gratis): descargar la planilla de NameBio, exportar a CSV e importar:
   `npm run import:namebio-keywords -- keywords.csv --as-of 2026-10-01 --col-keyword "Keyword" --col-count "Sales" ...`
   Sin market data, la confidence queda capada en 55 y **nada se recomienda** (por diseño).

## 6. Vercel (dashboard + API)

1. Importar el repo en Vercel (framework Next.js, build `next build`).
2. Variables de entorno (Production): todo lo de `.env` que uses + `API_SECRET` (`openssl rand -hex 32`), `DASHBOARD_PASSWORD`, `DASHBOARD_URL=https://<tu-proyecto>.vercel.app`, `STORE_PROVIDER=supabase` (**el store `file` no persiste en Vercel**).
3. `POST /api/runs` declara `maxDuration = 300` s. Verificá el máximo que permite tu plan de Vercel; un run live típico (sources + 2 llamadas LLM + ~20 domain-checks + ≤20 comps + 12 underwritings con concurrencia 3) debería entrar holgado. Si no entra, bajar `MAX_UNDERWRITE`/`MAX_ENRICH`, o correr el CLI desde un runner (ver backlog).
4. Probar: `curl -X POST https://<app>/api/runs -H "Authorization: Bearer $API_SECRET"`.

## 7. n8n

1. Importar `n8n/arbitrage-error-alerts.workflow.json` y `n8n/arbitrage-scout.workflow.json` (Workflows → Import from file).
2. Credenciales en n8n:
   - **Header Auth** "Arbitrage OS API": name `Authorization`, value `Bearer <API_SECRET>`.
   - **Slack API** "Slack bot": bot token con scope `chat:write`, bot invitado a `#arbitrage-os` (o cambiar el canal en los nodos Slack).
3. En el nodo **Config**: `api_base_url = https://<tu-proyecto>.vercel.app`.
4. En el workflow de scout → Settings → Error workflow → "Arbitrage OS — Error alerts".
5. Ejecutar con **Manual run** una vez, revisar el mensaje en Slack, y recién ahí activar. El schedule corre 08:45 y 17:45 (America/Argentina/Buenos_Aires).
6. El nodo HTTP tiene timeout de 300 s y **no reintenta** (un run cuesta plata). Un fallo devuelve `status: failed` → rama de alerta.

## Checklist de primera corrida real

- [ ] `/runs/{id}`: errores = 0, api_calls esperadas, costo total razonable (< $1–2).
- [ ] Disponibilidad: chequear manualmente 2–3 dominios "available" en el dashboard de Cloudflare.
- [ ] NameBio: payload crudo coincide con el parser.
- [ ] Digest: ≤ 5, sin banner MOCK, cada FACT con fuente clickeable.
- [ ] Ninguna llamada a endpoints de registración (grep `registrations` en logs: no debe existir).
