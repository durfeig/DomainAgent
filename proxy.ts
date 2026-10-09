import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth in front of everything (Next 16 "proxy", formerly middleware):
 *  - Dashboard pages: HTTP Basic Auth (DASHBOARD_USER / DASHBOARD_PASSWORD).
 *  - /api/*: `Authorization: Bearer <API_SECRET>` (n8n) OR the dashboard's Basic Auth (form posts).
 *  - /api/health is public.
 * In production, missing credentials => locked (503), never open.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/health") return NextResponse.next();

  const user = process.env.DASHBOARD_USER || "diego";
  const pass = process.env.DASHBOARD_PASSWORD || "";
  const apiSecret = process.env.API_SECRET || "";
  const prod = process.env.NODE_ENV === "production";
  const header = req.headers.get("authorization") ?? "";

  const bearerOk = apiSecret !== "" && header.startsWith("Bearer ") && safeEqual(header.slice(7), apiSecret);
  let basicOk = false;
  if (header.startsWith("Basic ") && pass) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      basicOk = safeEqual(u, user) && safeEqual(rest.join(":"), pass);
    } catch {
      basicOk = false;
    }
  }

  if (pathname.startsWith("/api/")) {
    if (bearerOk || basicOk) return NextResponse.next();
    if (!prod && !apiSecret && !pass) return NextResponse.next(); // local dev without secrets
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (basicOk) return NextResponse.next();
  if (!pass) {
    if (!prod) return NextResponse.next();
    return new NextResponse("Dashboard locked: set DASHBOARD_PASSWORD.", { status: 503 });
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Arbitrage OS"' } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
