import { z } from "zod";
import { getEnv } from "@/lib/env";
import { clientIp, codeMatches, json, originOk, rateLimit } from "@/lib/founder/guard";
import { COOKIE_NAME, cookieOptions, createSessionToken } from "@/lib/founder/session";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().min(1).max(200) });

/** POST {code}: exchange the founder passcode for a signed HttpOnly cookie. DELETE: log out. */
export async function POST(req: Request) {
  if (!originOk(req)) return json({ error: "bad origin" }, 403);
  const env = getEnv();
  if (!env.FOUNDER_ACCESS_CODE || !env.SESSION_SECRET) return json({ error: "founder login is not configured on this server" }, 503);
  const rl = rateLimit(`auth:${clientIp(req)}`, 5, 60_000);
  if (!rl.ok) return json({ error: "too many attempts, wait a minute" }, 429, { "retry-after": String(rl.retryAfter) });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  if (!codeMatches(parsed.data.code, env.FOUNDER_ACCESS_CODE)) {
    await new Promise((r) => setTimeout(r, 400)); // small delay: makes guessing slower
    return json({ error: "wrong passcode" }, 401);
  }
  const res = json({ ok: true });
  res.cookies.set(COOKIE_NAME, await createSessionToken(env.SESSION_SECRET), cookieOptions(process.env.NODE_ENV === "production"));
  return res;
}

export async function DELETE(req: Request) {
  if (!originOk(req)) return json({ error: "bad origin" }, 403);
  const res = json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { ...cookieOptions(process.env.NODE_ENV === "production"), maxAge: 0 });
  return res;
}
