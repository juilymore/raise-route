import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_BASE_URL = "https://raiseroute.example.com";
process.env.DIGEST_RECIPIENT = "vikram@example.com";
delete process.env.RESEND_API_KEY;

import { buildDigest, esc, subjectFor, type DigestItem } from "@/lib/digest/build";
import { createAndMaybeSendDigest, resendSender, toIsoDay, type Sender } from "@/lib/digest/send";

const item = (o: Partial<DigestItem> & { firm: string }): DigestItem => ({
  recommendationId: `rec-${o.firm}`, slug: o.firm.toLowerCase().replace(/\W+/g, "-"), action: "DONT_PRIORITIZE", holdReason: null, score: null, assessmentStatus: "SIGNAL_FOUND", reason: "reason",
  signalTitle: null, eventDate: null, sourceUrl: null, sourceDomain: null, prevAction: null, prevScore: null, ...o,
});
const items: DigestItem[] = [
  item({ firm: "Alpha", action: "REACH_OUT_NOW", score: 86, signalTitle: "Alpha led a seed in RoutePilot", eventDate: "2026-10-05", sourceUrl: "https://news.example.com/a", sourceDomain: "news.example.com", prevAction: "MONITOR", prevScore: 50 }),
  item({ firm: "Beta", action: "FOLLOW_UP_NOW", score: 71, signalTitle: "Beta essay on freight", eventDate: "2026-10-03", sourceUrl: "https://beta.example.com/p", sourceDomain: "beta.example.com" }),
  item({ firm: "Gamma", action: "MONITOR", score: 40, signalTitle: "Gamma podcast", eventDate: "2026-10-01", sourceUrl: "https://g.example.com", sourceDomain: "g.example.com" }),
  item({ firm: "Delta", action: "HOLD", holdReason: "RECENT_CONTACT", score: 80, signalTitle: "Delta deal", eventDate: "2026-10-06", sourceUrl: "https://d.example.com", sourceDomain: "d.example.com" }),
  item({ firm: "Epsilon", action: "DONT_PRIORITIZE", assessmentStatus: "QUIET" }),
  item({ firm: "Zeta", action: "ASSESSMENT_INCOMPLETE", assessmentStatus: "PARTIAL" }),
];
const input = { runKey: "cron-2026-10-12", runDate: "2026-10-12", baseUrl: "https://raiseroute.example.com", items, quietCopy: "No qualifying signal found in the sources checked in the past 30 days.", incompleteCopy: "Assessment incomplete." };

describe("digest builder", () => {
  it("subject carries the brand constant, the day and the counts", () => {
    expect(subjectFor("2026-10-12", 3, 2)).toBe("RaiseRoute · Mon 12 Oct · 3 to reach out, 2 follow-ups");
    expect(subjectFor("2026-10-12", 1, 1)).toContain("1 follow-up");
    expect(subjectFor("2026-10-12", 1, 1)).not.toContain("follow-ups");
  });
  it("sections appear in the specified order and items are ranked by score", () => {
    const d = buildDigest(input);
    const pos = (s: string) => d.html.indexOf(s);
    expect(pos("Reach out now")).toBeLessThan(pos("Follow up now"));
    expect(pos("Follow up now")).toBeLessThan(pos("Monitor"));
    expect(pos("Monitor")).toBeLessThan(pos(">Hold"));
    expect(pos(">Hold")).toBeLessThan(pos("Quiet investors"));
    expect(pos("Quiet investors")).toBeLessThan(pos("Priority changes"));
    expect(d.counts).toMatchObject({ reachOut: 1, followUp: 1, monitor: 1, hold: 1, quiet: 1, incomplete: 1, changes: 1 });
    expect(d.sections.map((s) => s.section)).toEqual(["REACH_OUT_NOW", "FOLLOW_UP_NOW", "MONITOR", "HOLD", "QUIET", "CHANGES", "INCOMPLETE"]);
  });
  it("each item has firm, score, why-now, evidence date + link and a link into the app; hold shows its reason", () => {
    const d = buildDigest(input);
    expect(d.html).toContain("https://raiseroute.example.com/vc/alpha");
    expect(d.html).toContain("Source: news.example.com · 2026-10-05");
    expect(d.html).toContain("hold: recent contact");
    expect(d.text).toContain("Alpha (86)");
  });
  it("uses the exact quiet copy, separates incomplete from quiet, and states data honesty", () => {
    const d = buildDigest(input);
    expect(d.html).toContain("No qualifying signal found in the sources checked in the past 30 days.");
    expect(d.html).toContain("could not be fully checked");
    expect(d.html).toContain("demo data");
    expect(d.html).not.toMatch(/uninterested|not interested|inactive/i);
  });
  it("escapes HTML in firm names and titles (no injection into the email) and drops non-http links", () => {
    const evil = item({ firm: "<img src=x onerror=alert(1)>", action: "REACH_OUT_NOW", score: 70, signalTitle: "<script>alert(1)</script>", sourceUrl: "javascript:alert(1)", sourceDomain: "x" });
    const d = buildDigest({ ...input, items: [evil] });
    expect(d.html).not.toContain("<script>");
    expect(d.html).not.toContain("<img src=x");
    expect(d.html).not.toContain("javascript:");
    expect(esc(`"&<>'`)).toBe("&quot;&amp;&lt;&gt;&#39;");
  });
  it("says so plainly when nobody is worth contacting", () => {
    const d = buildDigest({ ...input, items: [item({ firm: "Only", assessmentStatus: "QUIET" })] });
    expect(d.html).toContain("No investor has a strong, fresh, relevant signal right now");
    expect(d.subject).toContain("0 to reach out, 0 follow-ups");
  });
});

class FakeDigestDb {
  digests = new Map<string, Record<string, unknown>>();
  snapshotCalls = 0;
  snapshot = items;
  digestSnapshot = async () => { this.snapshotCalls++; return this.snapshot as never; };
  getRun = async () => ({ id: "run-1", run_key: "cron-2026-10-12", window_end: "2026-10-12" }) as never;
  getDigestByKey = async (k: string) => this.digests.get(k) as never;
  insertDigest = async (row: Record<string, unknown>) => { const r = { id: `dg${this.digests.size + 1}`, ...row }; this.digests.set(String(row.digest_key), r); return r as never; };
  insertDigestItems = async () => {};
  updateDigestStatus = async (id: string, p: Record<string, unknown>) => {
    for (const d of this.digests.values()) if (d.id === id) {
      if (d.status === "SENT") throw new Error("a SENT digest cannot change status");
      if (p.status === "SENT" && !p.providerMessageId) throw new Error("cannot mark SENT without provider confirmation");
      Object.assign(d, { status: p.status, provider_message_id: p.providerMessageId ?? d.provider_message_id, error: p.error ?? null });
    }
  };
}

describe("digest sending", () => {
  it("creates an immutable digest; SENT only with a provider message id", async () => {
    const db = new FakeDigestDb();
    const sender: Sender = vi.fn(async () => ({ ok: true as const, id: "msg_123" }));
    const r = await createAndMaybeSendDigest(db, { runId: "run-1", send: true, sender });
    expect(r).toMatchObject({ status: "SENT", messageId: "msg_123", created: true });
    expect(sender).toHaveBeenCalledOnce();
    const call = (sender as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call).toMatchObject({ to: "vikram@example.com", idempotencyKey: "digest-run-1" });
  });
  it("a repeat call does not resend and does not rebuild: a later score change cannot alter an old digest", async () => {
    const db = new FakeDigestDb();
    const sender: Sender = vi.fn(async () => ({ ok: true as const, id: "msg_1" }));
    await createAndMaybeSendDigest(db, { runId: "run-1", send: true, sender });
    const html1 = String(db.digests.get("digest-run-1")!.html);
    db.snapshot = [item({ firm: "Alpha", action: "DONT_PRIORITIZE", score: 5 })]; // data changes later
    const again = await createAndMaybeSendDigest(db, { runId: "run-1", send: true, sender });
    expect(again).toMatchObject({ alreadySent: true, created: false, status: "SENT" });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(db.snapshotCalls).toBe(1);
    expect(String(db.digests.get("digest-run-1")!.html)).toBe(html1);
  });
  it("a failed send is recorded as FAILED with the error, never SENT, and can be retried", async () => {
    const db = new FakeDigestDb();
    const bad: Sender = async () => ({ ok: false, error: "Resend HTTP 403: only your own address" });
    const r = await createAndMaybeSendDigest(db, { runId: "run-1", send: true, sender: bad });
    expect(r).toMatchObject({ status: "FAILED", error: expect.stringContaining("403") });
    expect(db.digests.get("digest-run-1")!.status).toBe("FAILED");
    const good: Sender = async () => ({ ok: true, id: "msg_2" });
    const retry = await createAndMaybeSendDigest(db, { runId: "run-1", send: true, sender: good });
    expect(retry).toMatchObject({ status: "SENT", created: false });
  });
  it("without an API key the status is DEV_NOT_SENT (honest), not SENT", async () => {
    const db = new FakeDigestDb();
    const r = await createAndMaybeSendDigest(db, { runId: "run-1", send: true });
    expect(r.status).toBe("DEV_NOT_SENT");
    expect(String(db.digests.get("digest-run-1")!.error)).toContain("RESEND_API_KEY");
  });
  it("send:false only creates the preview", async () => {
    const db = new FakeDigestDb();
    const sender = vi.fn();
    const r = await createAndMaybeSendDigest(db, { runId: "run-1", send: false, sender: sender as never });
    expect(r.status).toBe("PREVIEW");
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("run date handling", () => {
  it("accepts the Date objects Postgres returns as well as ISO strings", () => {
    expect(toIsoDay(new Date(2026, 9, 12))).toBe("2026-10-12");
    expect(toIsoDay("2026-10-12")).toBe("2026-10-12");
    expect(toIsoDay("2026-10-12T00:00:00.000Z")).toBe("2026-10-12");
    expect(toIsoDay(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("resend provider adapter", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  beforeAll(() => undefined);
  it("returns the message id only when the provider confirms and sends an idempotency key", async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_u: unknown, init: { headers: Record<string, string> }) => { headers = init.headers; return new Response(JSON.stringify({ id: "re_abc" }), { status: 200 }); }) as never;
    const r = await resendSender("key")({ from: "a <a@b.c>", to: "x@y.z", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "digest-run-1" });
    expect(r).toEqual({ ok: true, id: "re_abc" });
    expect(headers["Idempotency-Key"]).toBe("digest-run-1");
  });
  it("treats errors, missing ids and network failures as not sent", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "You can only send testing emails to your own email address" }), { status: 403 })) as never;
    expect(await resendSender("k")({ from: "f", to: "t", subject: "s", html: "h", text: "t", idempotencyKey: "k" })).toMatchObject({ ok: false });
    globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as never;
    expect(await resendSender("k")({ from: "f", to: "t", subject: "s", html: "h", text: "t", idempotencyKey: "k" })).toMatchObject({ ok: false });
    globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as never;
    expect(await resendSender("k")({ from: "f", to: "t", subject: "s", html: "h", text: "t", idempotencyKey: "k" })).toMatchObject({ ok: false, error: expect.stringContaining("ECONNRESET") });
  });
});
