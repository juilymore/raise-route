import { describe, expect, it } from "vitest";

process.env.CRON_SECRET = "c".repeat(24);
process.env.APP_BASE_URL = "https://raiseroute.example.com";
delete process.env.DATABASE_URL; // proves that rejected requests never reach the database

const origin = "https://raiseroute.example.com";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://raiseroute.example.com${url}`, { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });

describe("editing routes (no login): Origin check first, never touching the database", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("a foreign or missing Origin is refused (403)", async () => {
    const run = await import("@/app/api/founder/run/route");
    expect((await run.POST(post("/api/founder/run", {}, { origin: "https://evil.example.com" }))).status).toBe(403);
    const noOrigin = new Request("https://raiseroute.example.com/api/founder/run", { method: "POST", body: "{}" });
    expect((await run.POST(noOrigin)).status).toBe(403);
    const { PATCH } = await import("@/app/api/founder/vc/[id]/route");
    const res = await PATCH(new Request("https://raiseroute.example.com/x", { method: "PATCH", headers: { origin: "https://evil.example.com", "content-type": "application/json" }, body: JSON.stringify({ personal_notes: "hack" }) }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(403);
  });
  it("the removed login endpoints are gone", async () => {
    await expect(import("@/app/api/founder/auth/route" as string)).rejects.toThrow();
    await expect(import("@/app/api/founder/session/route" as string)).rejects.toThrow();
  });
});

describe("requests are validated before they reach the database", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("rejects non-editable fields (system columns) and bad values with 400", async () => {
    const { PATCH } = await import("@/app/api/founder/vc/[id]/route");
    const mk = (b: unknown) => new Request("https://raiseroute.example.com/x", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(b) });
    for (const bad of [{ follow_up_score: 99 }, { recommended_action: "REACH_OUT_NOW" }, { contact_history: [] }, { contact_status: "BANANA" }, { last_contact_date: "yesterday" }, {}, { personal_notes: "x".repeat(6000) }]) {
      expect((await PATCH(mk(bad), { params: Promise.resolve({ id }) })).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await PATCH(mk({ personal_notes: "ok" }), { params: Promise.resolve({ id: "not-a-uuid" }) })).status).toBe(400);
  });
  it("event route validates type, date and summary", async () => {
    const ev = await import("@/app/api/founder/vc/[id]/event/route");
    const mk = (b: unknown) => post("/x", b);
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

describe("unit helpers", () => {
  it("constant-time compare and bearer parsing", async () => {
    const { safeEqual, hasValidBearer } = await import("@/lib/pipeline/auth");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(hasValidBearer(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }), "s3cret")).toBe(true);
    expect(hasValidBearer(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }), undefined)).toBe(false);
  });
});
