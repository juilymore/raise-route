import { jwtVerify, SignJWT } from "jose";

/**
 * Founder session: a signed (HS256) JWT in an HttpOnly, SameSite=Lax cookie. Public visitors have no cookie and are read-only.
 * The secret is SESSION_SECRET (server only). Works in the proxy (edge) and in route handlers.
 */
export const COOKIE_NAME = "rr_founder";
export const SESSION_HOURS = 12;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  return new SignJWT({ role: "founder" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + SESSION_HOURS * 3600)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.role === "founder";
  } catch {
    return false;
  }
}

export const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: SESSION_HOURS * 3600,
});
