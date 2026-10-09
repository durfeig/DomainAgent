# Credenciales necesarias

Ninguna es necesaria para correr el MVP en modo mock. Todas van en `.env` (local) o en variables de entorno de Vercel / credenciales de n8n. Nunca en git.

| # | Credencial | Variable(s) | Dónde se obtiene | Necesaria para | Costo |
|---|---|---|---|---|---|
| 1 | Supabase URL + service role key | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | Persistencia en producción | Free tier alcanza para empezar |
| 2 | Anthropic API key | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | LLM real (concepts, lexicon, underwriter) | Por tokens (ver DECISIONS #1) |
| 3 | Cloudflare Account ID | `CLOUDFLARE_ACCOUNT_ID` | Dashboard Cloudflare (sidebar de la cuenta) | Disponibilidad y precios | — |
| 4 | Cloudflare API token | `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create (permisos Registrar, alcance a tu cuenta) | `domain-check` (sandbox y live). **Sin permisos de escritura hasta Fase 2** | Sin costo publicado por consulta |
| 5 | NameBio email + API key | `NAMEBIO_EMAIL`, `NAMEBIO_API_KEY` | NameBio plan Business → solicitar acceso API | Comparables (market data) | Plan pago + créditos (25/llamada) |
| 6 | GitHub token (opcional) | `GITHUB_TOKEN` | GitHub → Settings → Developer settings → fine-grained token, solo lectura pública | Mayor rate limit en búsqueda | Gratis |
| 7 | Reddit app (opcional) | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | reddit.com/prefs/apps → "script"/"web app" | Señales de Reddit | Gratis (revisar términos de uso de datos) |
| 8 | Product Hunt token (opcional) | `PRODUCTHUNT_TOKEN` | api.producthunt.com → developer token | Señales de PH | Gratis (revisar uso comercial) |
| 9 | API secret propio | `API_SECRET` | `openssl rand -hex 32` | n8n → `POST /api/runs` | — |
| 10 | Password del dashboard | `DASHBOARD_PASSWORD` (+ `DASHBOARD_USER`) | Lo definís vos | Dashboard en Vercel | — |
| 11 | Slack bot token (en n8n) | credencial "Slack bot" en n8n | api.slack.com/apps → Bot token, scope `chat:write` | Digest a Slack | Gratis |
| 12 | Slack incoming webhook (opcional) | `SLACK_WEBHOOK_URL` | Slack app → Incoming Webhooks | `npm run scout -- --slack` | Gratis |
| 13 | OpenAI (alternativa opcional) | `OPENAI_API_KEY`, `OPENAI_MODEL_*`, `OPENAI_PRICE_*` | platform.openai.com | Solo si se cambia de proveedor LLM | Por tokens |

**No pedidas a propósito (Fase 2):** método de pago en Cloudflare Registrar, permisos de escritura de Registrar, cuentas de marketplaces (Afternic/Sedo/Atom) para listar.
