# Backlog — Fase 2 y siguientes

## Fase 1.5 — endurecer el Analyst (antes de comprar nada)
- [ ] Primera corrida live: verificar payload real de NameBio comps y ajustar `parseNameBioComps`.
- [ ] Confirmar con datos reales el formato de `tier` de Cloudflare (`standard`/`premium`/otros) y precios de .ai (años mínimos).
- [ ] RDAP como pre-filtro gratuito de "ya registrado" antes de Cloudflare (bootstrap IANA) para ahorrar llamadas.
- [ ] Trademark: integrar búsqueda USPTO/EUIPO (APIs oficiales) para LOW/MEDIUM; ampliar lista de marcas con nombres de startups financiadas del propio feed de señales.
- [ ] Google Trends (si aprueban acceso alpha) como validador de momentum en `trend_momentum`.
- [ ] Eval set del underwriter: 50–100 dominios con veredicto humano para medir cambios de prompt/modelo antes de deployar.
- [ ] Calibración con `v_feedback_dataset`: comparar score/confidence vs. decisiones (precision@5), ajustar pesos y thresholds. Sin entrenar modelos.
- [ ] Botones interactivos en Slack (Slack app + webhook n8n → `POST /api/opportunities/{id}/decision`).
- [ ] Ejecutar el run fuera de Vercel si supera el límite (GitHub Actions / runner) y que n8n solo lea el digest.
- [ ] Batch API de Anthropic para el underwriting (50% menos costo; latencia no crítica 2x/día).

## Fase 2 — Auto-trader (requiere aprobación explícita)
Regla: `score ≥ 90 && confidence ≥ 80 && trademark = LOW && cost ≤ $15 && budget disponible` → register → list → price → monitor.
- [ ] Implementar `CloudflareRegistrar.registerDomain()` (`POST /registrations`, re-check inmediato antes de registrar, eco del precio como fee acknowledgement, idempotencia por opportunity_id).
- [ ] Token Cloudflare con escritura + método de pago; `AUTO_BUY_ENABLED=true` solo en producción y con kill-switch.
- [ ] Ledger de compras en `positions` + conciliación con facturas de Cloudflare; budget guard en transacción (lock) para evitar dobles compras.
- [ ] Listado automático en marketplace(s) + pricing inicial desde retail estimate (BIN + minimum offer).
- [ ] Portfolio manager: renovar o dropear antes del vencimiento según EV actualizado; alertas de renovación.
- [ ] Registro de ventas reales → recalibrar sell-through por segmento (TLD, estrategia, concepto).

## Fase 3 — Nuevos verticales (contrato en `src/verticals/types.ts`)
- [ ] API arbitrage (wrappers/resale de APIs con margen).
- [ ] Etsy digital products · Adobe Stock · KDP · micro SaaS · datasets.
- [ ] Builder / Publisher / Portfolio Manager genéricos por vertical.
- [ ] Reutilizar trend scout + concepts como capa compartida de demanda.
