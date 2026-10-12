import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison of two strings (length differences do not leak through timing of the comparison itself). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep work roughly constant
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** True when the request carries `Authorization: Bearer <secret>` with the configured secret. Missing secret => always false. */
export function hasValidBearer(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? safeEqual(m[1]!, secret) : false;
}
