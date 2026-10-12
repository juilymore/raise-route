import { beforeAll, describe, expect, it } from "vitest";

process.env.SESSION_SECRET = "s".repeat(40);
process.env.FOUNDER_ACCESS_CODE = "correct horse battery";
process.env.CRON_SECRET = "c".repeat(24);
process.env.APP_BASE_URL = "https://raiseroute.example.com";
delete process.env.DATABASE_URL; // proves that rejected requests never reach the database

const origin = "https://raiseroute.example.com";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://raiseroute.example.com${url}`, { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });

let cookie = "";
beforeAll(async () => {
  const { POST } = await import("@/app/api/founder/auth/route");
  const res = await POST(post("/api/founder/auth", { code: "correct horse battery" }));
  expect(res.status).toBe(200);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});

describe("founder login", () => {
  it("sets an HttpOnly, SameSite=Lax signed cookie on the right passcode", async () => {
    const { POST } = await import("@/app/api/founder/auth/route");
    const res = await POST(post("/api/founder/auth", { code: "correct horse battery" }, { "x-forwarded-for": "9.9.9.1" }));
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/rr_founder=ey/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=lax/i);
  });
  it("rejects a wrong passcode with 401 and no cookie", async () => {
    const { POST } = await import("@/app/api/founder/auth/route");
    const res = await POST(post("/api/founder/auth", { code: "wrong" }, { "x-forwarded-for": "9.9.9.2" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("rejects a foreign Origin (CSRF) and a missing Origin", async () => {
    const { POST } = await import("@/app/api/founder/auth/route");
    expect((await POST(post("/api/founder/auth", { code: "correct horse battery" }, { origin: "https://evil.example.com", "x-forwarded-for": "9.9.9.3" }))).status).toBe(403);
    const noOrigin = new Request("https://raiseroute.example.com/api/founder/auth", { method: "POST", body: JSON.stringify({ code: "x" }) });
    expect((await POST(noOrigin)).status).toBe(403);
  });
  it("rate-limits repeated guesses (429 after 5 attempts a minute)", async () => {
    const { POST } = await import("@/app/api/founder/auth/route");
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await POST(post("/api/founder/auth", { code: `guess${i}` }, { "x-forwarded-for": "9.9.9.4" }))).status;
    expect(last).toBe(429);
  });
  it("rejects malformed bodies with 400", async () => {
    const { POST } = await import("@/app/api/founder/auth/route");
    expect((await POST(post("/api/founder/auth", { nope: 1 }, { "x-forwarded-for": "9.9.9.5" }))).status).toBe(400);
  });
});

describe("mutating routes: unauthenticated => 401, never touching the database", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("PATCH /vc/[id] without a cookie is 401", async () => {
    const { PATCH } = await import("@/app/api/founder/vc/[id]/route");
    const res = await PATCH(new Request("https://raiseroute.example.com/x", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ personal_notes: "hack" }) }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(401);
  });
  it("POST /vc/[id]/event, /run and PATCH /company without a cookie are 401", async () => {
    const ev = await import("@/app/api/founder/vc/[id]/event/route");
    expect((await ev.POST(post("/x", { at: "2026-10-01", type: "call", summary: "s" }), { params: Promise.resolve({ id }) })).status).toBe(401);
    const run = await import("@/app/api/founder/run/route");
    expect((await run.POST(post("/api/founder/run", {}))).status).toBe(401);
    const co = await import("@/app/api/founder/company/route");
    expect((await co.PATCH(new Request("https://raiseroute.example.com/x", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: "{}" }))).status).toBe(401);
  });
  it("a forged / tampered cookie is rejected", async () => {
    const run = await import("@/app/api/founder/run/route");
    const forged = cookie.slice(0, -3) + "AAA";
    expect((await run.POST(post("/api/founder/run", {}, { cookie: forged }))).status).toBe(401);
    expect((await run.POST(post("/api/founder/run", {}, { cookie: "rr_founder=notajwt" }))).status).toBe(401);
  });
  it("with a valid cookie but a foreign Origin it is still refused (403)", async () => {
    const run = await import("@/app/api/founder/run/route");
    expect((await run.POST(post("/api/founder/run", {}, { cookie, origin: "https://evil.example.com" }))).status).toBe(403);
  });
});

describe("authenticated requests are validated before they reach the database", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("rejects non-editable fields (system columns) and bad values with 400", async () => {
    const { PATCH } = await import("@/app/api/founder/vc/[id]/route");
    const mk = (b: unknown) => new Request("https://raiseroute.example.com/x", { method: "PATCH", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(b) });
    for (const bad of [{ follow_up_score: 99 }, { recommended_action: "REACH_OUT_NOW" }, { contact_history: [] }, { contact_status: "BANANA" }, { last_contact_date: "yesterday" }, {}, { personal_notes: "x".repeat(6000) }]) {
      expect((await PATCH(mk(bad), { params: Promise.resolve({ id }) })).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await PATCH(mk({ personal_notes: "ok" }), { params: Promise.resolve({ id: "not-a-uuid" }) })).status).toBe(400);
  });
  it("event route validates type, date and summary", async () => {
    const ev = await import("@/app/api/founder/vc/[id]/event/route");
    const mk = (b: unknown) => post("/x", b, { cookie });
    expect((await ev.POST(mk({ at: "01-10-2026", type: "call", summary: "s" }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await ev.POST(mk({ at: "2026-10-01", type: "teleport", summary: "s" }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await ev.POST(mk({ at: "2026-10-01", type: "call", summary: "" }), { params: Promise.resolve({ id }) })).status).toBe(400);
  });
});

describe("cron / continue routes use the bearer secret", () => {
  it("wrong, missing and malformed bearer => 401; the DB is never touched", async () => {
    const cron = await import("@/app/api/cron/run/route");
    const cont = await import("@/app/api/pipeline/continue/route");
    const get = (h: Record<string, string>) => new Request("https://raiseroute.example.com/api/cron/run", { headers: h });
    expect((await cron.GET(get({}))).status).toBe(401);
    expect((await cron.GET(get({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await cron.GET(get({ authorization: "Basic " + "c".repeat(24) }))).status).toBe(401);
    expect((await cron.GET(get({ authorization: "Bearer " + "c".repeat(23) }))).status).toBe(401);
    const c2 = (h: Record<string, string>) => new Request("https://raiseroute.example.com/api/pipeline/continue", { method: "POST", headers: h, body: JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111" }) });
    expect((await cont.POST(c2({}))).status).toBe(401);
    expect((await cont.POST(c2({ authorization: "Bearer nope" }))).status).toBe(401);
  });
});

describe("proxy and unit helpers", () => {
  it("proxy blocks founder API paths without a session but leaves auth and session open", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const blocked = await proxy(new NextRequest("https://raiseroute.example.com/api/founder/run", { method: "POST" }));
    expect(blocked.status).toBe(401);
    const open = await proxy(new NextRequest("https://raiseroute.example.com/api/founder/auth", { method: "POST" }));
    expect(open.status).toBe(200); // NextResponse.next()
    const allowed = await proxy(new NextRequest("https://raiseroute.example.com/api/founder/run", { method: "POST", headers: { cookie } }));
    expect(allowed.status).toBe(200);
  });
  it("session tokens verify only with the right secret and not after expiry", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/founder/session");
    const t = await createSessionToken("k".repeat(40));
    expect(await verifySessionToken(t, "k".repeat(40))).toBe(true);
    expect(await verifySessionToken(t, "z".repeat(40))).toBe(false);
    const old = await createSessionToken("k".repeat(40), Date.now() - 13 * 3600 * 1000);
    expect(await verifySessionToken(old, "k".repeat(40))).toBe(false);
    expect(await verifySessionToken(undefined, "k".repeat(40))).toBe(false);
  });
  it("constant-time compare and bearer parsing", async () => {
    const { safeEqual, hasValidBearer } = await import("@/lib/pipeline/auth");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(hasValidBearer(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }), "s3cret")).toBe(true);
    expect(hasValidBearer(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }), undefined)).toBe(false);
  });
});
