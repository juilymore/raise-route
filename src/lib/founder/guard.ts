import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { safeEqual } from "@/lib/pipeline/auth";
import { COOKIE_NAME, verifySessionToken } from "./session";

/** Read the cookie from a Request without next/headers (works in tests and in proxy). */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export async function isFounder(req: Request): Promise<boolean> {
  return verifySessionToken(readCookie(req, COOKIE_NAME), getEnv().SESSION_SECRET);
}

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
 * Standard gate for founder mutations: Origin check -> founder cookie -> rate limit. Returns a Response to send, or null to continue.
 * (Body validation with zod happens in each route.)
 */
export async function gateFounder(req: Request, opts: { limitKey: string; max?: number }): Promise<Response | null> {
  if (!originOk(req)) return json({ error: "bad origin" }, 403);
  if (!(await isFounder(req))) return json({ error: "founder login required" }, 401);
  const rl = rateLimit(`${opts.limitKey}:${clientIp(req)}`, opts.max ?? 30, 60_000);
  if (!rl.ok) return json({ error: "too many requests" }, 429, { "retry-after": String(rl.retryAfter) });
  return null;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/**
 * Fixed-window in-memory rate limiter. HONEST LIMITATION: state lives in one serverless instance, so on Vercel it slows
 * brute force but is not a global guarantee. The founder passcode check also uses a constant-time compare and a small delay.
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

export function codeMatches(input: string, expected: string | undefined): boolean {
  return !!expected && safeEqual(input, expected);
}
