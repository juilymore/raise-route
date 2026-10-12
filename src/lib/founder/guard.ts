import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

/**
 * CSRF defence for every mutating request: the Origin header must be present and match this app's own origin
 * (APP_BASE_URL or the request's own host). Browsers always send Origin on cross-site POST/PATCH/DELETE.
 */
export function originOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(getEnv().APP_BASE_URL).host);
  } catch {
    /* ignore */
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) allowed.add(host);
  return allowed.has(o.host);
}

export const json = (body: unknown, status = 200, headers?: Record<string, string>) => NextResponse.json(body, { status, headers });

/**
 * Standard gate for the editing routes: Origin check -> rate limit. There is no login (removed on request);
 * the database guards, not this gate, decide which columns can ever be written. Returns a Response to send, or null to continue.
 * (Body validation with zod happens in each route.)
 */
export async function gateFounder(req: Request, opts: { limitKey: string; max?: number }): Promise<Response | null> {
  if (!originOk(req)) return json({ error: "bad origin" }, 403);
  const rl = rateLimit(`${opts.limitKey}:${clientIp(req)}`, opts.max ?? 30, 60_000);
  if (!rl.ok) return json({ error: "too many requests" }, 429, { "retry-after": String(rl.retryAfter) });
  return null;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/**
 * Fixed-window in-memory rate limiter. HONEST LIMITATION: state lives in one serverless instance, so on Vercel it slows
 * abuse but is not a global guarantee.
 */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfter: number } {
  const b = buckets.get(key);
  if (!b || now >= b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.n++;
  return b.n > max ? { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) } : { ok: true, retryAfter: 0 };
}
export const _resetRateLimits = () => buckets.clear();
