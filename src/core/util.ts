import { createHash } from "node:crypto";

export const nowIso = () => new Date().toISOString();

export function sha1(s: string) {
  return createHash("sha1").update(s).digest("hex");
}

/** Deterministic pseudo-random in [0,1) from a string — used only by mocks. */
export function hashUnit(s: string): number {
  const h = createHash("sha256").update(s).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

export function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} for ${url.replace(/([?&](key|token|api_key)=)[^&]+/gi, "$1[redacted]")}: ${body.slice(0, 300)}`);
  }
}

/** fetch + JSON with timeout and limited retries on 429/5xx. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, retries = 2, ...rest } = init;
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          attempt++;
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        throw new HttpError(res.status, url, text);
      }
      return (text ? JSON.parse(text) : null) as T;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (attempt < retries) {
        attempt++;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
