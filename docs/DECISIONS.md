# Decisiones pendientes

Solo lo que cambia costos, implica riesgo, requiere credenciales o podría producir gastos. Todo lo demás se resolvió con defaults razonables (documentados en el código y en ARCHITECTURE.md).

## 1. Modelo LLM para underwriting (costo)
Default: **Claude Opus 5.5** (`claude-opus-5-5`, $4 / $20 por MTok) en ambos tiers. Estimación gruesa por run: 2 llamadas "fast" + 12 underwritings de ~3–4k tokens in / ~1–2k out (incluye thinking) ≈ **$0.5–1.0 por run → ~$30–60/mes a 2 runs/día**. Alternativas: `ANTHROPIC_MODEL_FAST=claude-haiku-5-5` ($0.10 / $0.50) para extractor/lexicon (tareas simples) baja el costo de esas llamadas ~40×; mantener Opus para el underwriter. Bajar `MAX_UNDERWRITE` también escala lineal. **Recomendación:** arrancar con Opus en todo durante 1–2 semanas, medir con `/runs`, y recién después probar Haiku en el tier fast comparando outputs.

## 2. NameBio: plan y créditos (costo)
La API de comps es paga (Business, a pedido) y cuesta 25 créditos por llamada; el precio por crédito no es público/verificable desde acá. Con `NAMEBIO_MAX_COMPS_CALLS_PER_RUN=20` son 500 créditos/run, ~30k/mes a 2 runs/día. Sin NameBio (o sin keyword stats importadas) la confidence queda capada en 55 y **el sistema no recomienda nada**. Opciones: (a) pagar NameBio, (b) arrancar solo con la planilla gratuita de keyword stats (cap sube a ~65 con fuentes buenas), (c) bajar `CONFIDENCE_CAP_NO_MARKET_DATA` (no recomendado). También revisar sus ToS (prohíben usar los datos para entrenar IA; nuestro uso es análisis, no entrenamiento, pero el feedback dataset futuro no debe incluir datos crudos de NameBio para entrenar modelos).

## 3. .ai vs. MAX_ASSET_COST = $15 (conflicto de requisitos)
Pediste priorizar .com y .ai, pero también "max domain: $15". Un .ai cuesta bastante más que eso por año y exige registro mínimo de 2 años (precio real: lo trae la API). Resolución actual: se **analiza** hasta `ANALYSIS_MAX_ASSET_COST=100`, pero el budget guard / auto-trader usan `MAX_ASSET_COST=15` → ningún .ai calificaría para compra automática, y el EV castiga su costo de tenencia. Decidir: ¿subir el cap para .ai (por TLD), o aceptar que .ai solo se compra con aprobación manual?

## 4. Supuesto de sell-through anual (riesgo de calibración)
`SELL_THROUGH_ANNUAL_BASE=1%` es un supuesto de industria, no un dato medido. Mueve el EV directamente. Validar con tu experiencia / datos reales y ajustar; idealmente calibrar con el feedback dataset + ventas reales en Fase 2.

## 5. Fee de marketplace
`MARKETPLACE_FEE_PCT=20%` (conservador). Depende de dónde se liste (Afternic, Sedo, Atom, etc.). Decidir marketplace objetivo en Fase 2.

## 6. Canal del digest
Implementado: dashboard + Slack vía n8n (canal `#arbitrage-os`). Confirmar canal (o preferís email vía Gmail node / Telegram).

## 7. Términos de uso de fuentes
Product Hunt (uso comercial de la API) y Reddit (Data API terms) tienen restricciones; están deshabilitadas por default. Decidir si se activan.

## 8. Google Trends
La API oficial está en alpha por aplicación. ¿Aplicamos? (Requiere describir el caso de uso; sin costo publicado.) Hasta entonces el momentum se calcula solo con historial propio de señales.

## 9. Permisos del token de Cloudflare
Para el MVP alcanza con lo mínimo para `domain-check`. No otorgar permisos de escritura de Registrar ni cargar método de pago hasta aprobar la Fase 2.

## 10. Hosting del run
Default: el pipeline corre dentro de la función de Vercel (`maxDuration=300`). Si tu plan no lo permite o los runs crecen, alternativas: GitHub Actions cron ejecutando `npm run scout`, o n8n self-hosted con Execute Command. Sin costo adicional relevante, pero cambia dónde viven los secrets.
