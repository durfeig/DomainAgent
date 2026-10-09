export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "arbitrage-os", auto_buy_enabled: process.env.AUTO_BUY_ENABLED === "true" });
}
