import { describe, expect, it } from "vitest";
import { MIN_SAMPLES, summarizeFeedback, summarizeOutcomes } from "@/lib/founder/calibration";
import { GeminiClient, type Transport } from "@/lib/gemini/client";
import { buildOutreachPrompt, checkDraft, generateOutreach, mentionsDate, wordCount, type OutreachDraft, type OutreachInput } from "@/lib/gemini/outreach";

const input: OutreachInput = {
  company: { company_name: "FreightLoop", product_description: "B2B SaaS for fleet and shipment visibility.", icp: "3PLs" },
  investor: { firm: "Blume Ventures", aliases: ["Blume"] },
  signals: [
    { id: "s1", title: "Blume leads $5M seed in RoutePilot", event_date: "2026-10-05", excerpt: "Blume Ventures led a five million dollar seed round in RoutePilot.", source_url: "https://news.example.com/a", attribution_level: "firm", attributed_person: null },
    { id: "s2", title: "Karthik Reddy on the freight podcast", event_date: "2026-10-07", excerpt: "Karthik Reddy said logistics is underbuilt.", source_url: "https://pod.example.com/1", attribution_level: "person", attributed_person: "Karthik Reddy" },
  ],
  contactStatusLabel: "not contacted yet",
};
const good: OutreachDraft = {
  subject: "RoutePilot seed and fleet visibility",
  body: "Hi, I saw that your firm led RoutePilot's seed round on 5 October. We build fleet and shipment visibility software for 3PLs, which seems close to that bet. Could we find 15 minutes next week? Our [traction metric] is available on request.",
  hook_signal_id: "s1",
  placeholders: ["traction metric"],
};

describe("outreach draft checks", () => {
  it("accepts a grounded, short draft with the signal date and placeholders", () => {
    expect(checkDraft(good, input)).toEqual([]);
  });
  it("rejects an unknown hook, a missing date, and a draft over 110 words", () => {
    expect(checkDraft({ ...good, hook_signal_id: "zzz" }, input).map((p) => p.code)).toContain("HOOK_UNKNOWN");
    expect(checkDraft({ ...good, body: good.body.replace("on 5 October", "recently") }, input).map((p) => p.code)).toContain("NO_DATE");
    expect(checkDraft({ ...good, body: "word ".repeat(120) + "5 October" }, input).map((p) => p.code)).toContain("TOO_LONG");
  });
  it("rejects invented money, percentages and traction claims unless bracketed", () => {
    expect(checkDraft({ ...good, body: good.body + " We grew 300% to $2M ARR." }, input).map((p) => p.code)).toContain("INVENTED_FACTS");
    expect(checkDraft({ ...good, body: good.body + " We reached [ARR figure] last quarter." }, input).map((p) => p.code)).not.toContain("INVENTED_FACTS");
  });
  it("rejects naming a partner for a firm-level signal and implying a prior relationship", () => {
    expect(checkDraft({ ...good, body: good.body + " Karthik Reddy will like it." }, input).map((p) => p.code)).toContain("NAMED_PARTNER");
    expect(checkDraft({ ...good, body: good.body + " Following our call last week." }, input).map((p) => p.code)).toContain("FAKE_RELATIONSHIP");
  });
  it("recognises dates in several formats", () => {
    for (const t of ["on 2026-10-05", "on 5 October", "on October 5", "on 5th Oct", "Oct 5"]) expect(mentionsDate(t, "2026-10-05"), t).toBe(true);
    expect(mentionsDate("on 15 October", "2026-10-05")).toBe(false);
    expect(wordCount(" a b  c ")).toBe(3);
  });
  it("the prompt contains signals and company facts but can never carry founder-private data", () => {
    const p = buildOutreachPrompt(input);
    expect(p).toContain('<signal id="s1"');
    expect(p).toContain("relationship_status");
    expect(() => buildOutreachPrompt({ ...input, contactStatusLabel: "x", investor: { ...input.investor, personal_notes: "secret" } as never })).toThrow(/founder-private/);
    expect(() => buildOutreachPrompt({ ...input, company: { ...input.company, contact_history: [] } as never })).toThrow();
  });
});

describe("generateOutreach", () => {
  const mk = (replies: string[]) => {
    let i = 0;
    const requests: string[] = [];
    const t: Transport = { async generate(r) { requests.push(r.contents); return { text: replies[Math.min(i++, replies.length - 1)]!, inputTokens: 1, outputTokens: 1, groundingChunks: [], searchQueries: [] }; } };
    return { g: new GeminiClient({ models: ["gemini-3.8-flash"], maxCallsPerRun: 20, concurrency: 1 }, t, async () => {}, async () => {}), requests };
  };
  it("returns a valid draft and sends it with no tools", async () => {
    const { g } = mk([JSON.stringify(good)]);
    const r = await generateOutreach(g, input);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.hook.id).toBe("s1");
  });
  it("retries once with the problems when the first draft breaks a rule, then fails honestly", async () => {
    const bad = JSON.stringify({ ...good, body: good.body.replace("on 5 October", "lately") });
    const { g, requests } = mk([bad, bad]);
    const r = await generateOutreach(g, input);
    expect(r).toMatchObject({ ok: false, reason: "DRAFT_REJECTED" });
    expect(requests[1]).toContain("previous draft was rejected");
  });
  it("with no validated signals it refuses instead of inventing a hook", async () => {
    const { g, requests } = mk([JSON.stringify(good)]);
    expect(await generateOutreach(g, { ...input, signals: [] })).toMatchObject({ ok: false, reason: "NO_SIGNALS" });
    expect(requests).toHaveLength(0);
  });
});

describe("calibration honesty rules", () => {
  it("shows n, flags too few samples, and counts reasons only for thumbs-down", () => {
    const s = summarizeFeedback([
      { vote: "POSITIVE", reasons: [] },
      { vote: "NEGATIVE", reasons: ["SIGNAL_TOO_OLD", "WRONG_RELEVANCE"] },
      { vote: "NEGATIVE", reasons: ["SIGNAL_TOO_OLD"] },
    ]);
    expect(s).toMatchObject({ n: 3, positive: 1, negative: 2, enough: false });
    expect(s.reasons[0]).toEqual({ reason: "SIGNAL_TOO_OLD", count: 2 });
    expect(s.usefulRate).toBeCloseTo(1 / 3);
  });
  it("only claims enough data from the minimum sample size", () => {
    const many = Array.from({ length: MIN_SAMPLES }, () => ({ vote: "POSITIVE" as const, reasons: [] }));
    expect(summarizeFeedback(many).enough).toBe(true);
    expect(summarizeFeedback(many.slice(1)).enough).toBe(false);
    expect(summarizeFeedback([]).usefulRate).toBeNull();
  });
  it("summarises outcomes separately from feedback", () => {
    const o = summarizeOutcomes([{ outcome: "RESPONSE_RECEIVED" }, { outcome: "MEETING_BOOKED" }, { outcome: "NO_RESPONSE" }, { outcome: "PASSED" }]);
    expect(o).toMatchObject({ n: 4, response: 1, meeting: 1, passed: 1, noResponse: 1, enough: false });
    expect(o.responseRate).toBe(0.5);
  });
});
