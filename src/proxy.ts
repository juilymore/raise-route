import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/founder/session";

/**
 * Proxy (Next 16's middleware): first line of defence for founder-only API routes.
 * Every route handler ALSO checks the session itself (defence in depth), so removing this file would not open anything.
 * Public routes stay read-only because no public route writes anything.
 */
const OPEN = new Set(["/api/founder/auth", "/api/founder/session"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/founder/") && !OPEN.has(pathname)) {
    const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value, process.env.SESSION_SECRET);
    if (!ok) return NextResponse.json({ error: "founder login required" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/founder/:path*"] };
