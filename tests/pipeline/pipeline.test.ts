import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { GeminiClient, type Transport, type TransportRequest, type TransportResponse } from "@/lib/gemini/client";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import type { PipelineStore } from "@/lib/pipeline/store";
import { registrableDomain } from "@/lib/engine/dedupe";

const TODAY = "2026-10-12";
type Row = Record<string, unknown>;

/** In-memory stand-in for pipelineDb. Mirrors the semantics the pipeline relies on (idempotent start, unique keys, claim/finish). */
class FakeStore implements PipelineStore {
  runs = new Map<string, Row>();
  tasks: Row[] = [];
  candidates: Row[] = [];
  signals: Row[] = [];
  recs: Row[] = [];
  assessments = new Map<string, Row>();
  vcs: Row[];
  failUpsertSignalFor: string | null = null;
  constructor(vcs: Row[]) {
    this.vcs = vcs;
  }
  listVcs = async () => this.vcs as never;
  getCompanyProfile = async () => ({ company_name: "FreightLoop", product_description: "B2B logistics SaaS for fleets", sector: "x", stage: "Seed", geography: "India (operations)", icp: "3PLs", relevance_keywords: ["logistics"] }) as never;
  getRun = async (id: string) => this.runs.get(id) as never;
  startRun = async (a: { runKey: string; scoringVersion: string }) => {
    const ex = [...this.runs.values()].find((r) => r.run_key === a.runKey);
    if (ex) return ex as never;
    const r = { id: `run-${this.runs.size + 1}`, run_key: a.runKey, status: "RUNNING", scoring_version: a.scoringVersion };
    this.runs.set(String(r.id), r);
    return r as never;
  };
  finalizeRun = async (id: string, status: string, stats: Row = {}) => {
    const r = this.runs.get(id)!;
    Object.assign(r, { status, ...stats, founder_data_intact: true });
    return r as never;
  };
  ensureTasks = async (runId: string, only?: string[]) => {
    for (const v of this.vcs) if ((!only || only.includes(String(v.id))) && !this.tasks.some((t) => t.run_id === runId && t.vc_id === v.id)) this.tasks.push({ id: `t-${runId}-${v.id}`, run_id: runId, vc_id: v.id, status: "PENDING", attempts: 0, stats: {} });
  };
  claimRunTasks = async (runId: string, limit = 3) => {
    const c = this.tasks.filter((t) => t.run_id === runId && t.status === "PENDING" && Number(t.attempts) < 3).slice(0, limit);
    c.forEach((t) => { t.status = "RUNNING"; t.attempts = Number(t.attempts) + 1; });
    return c.map((t) => ({ ...t })) as never;
  };
  taskCounts = async (runId: string) => {
    const m = new Map<string, number>();
    this.tasks.filter((t) => t.run_id === runId).forEach((t) => m.set(String(t.status), (m.get(String(t.status)) ?? 0) + 1));
    return [...m].map(([status, n]) => ({ status, n }));
  };
  taskStats = async (runId: string) => this.tasks.filter((t) => t.run_id === runId).map((t) => ({ status: String(t.status), stats: t.stats as Row }));
  finishTask = async (id: string, status: string, stats: Row) => {
    const t = this.tasks.find((x) => x.id === id)!;
    t.status = status;
    t.stats = stats;
  };
  knownCandidateUrls = async (vcId: string) => new Set(this.candidates.filter((c) => c.vc_id === vcId && c.status !== "PENDING" && c.rejection_code !== "FETCH_FAILED").map((c) => String(c.canonical_url)));
  upsertCandidate = async (c: { vcId: string; canonicalUrl: string; url: string; channel: string }) => {
    const ex = this.candidates.find((x) => x.vc_id === c.vcId && x.canonical_url === c.canonicalUrl);
    if (ex) return String(ex.id);
    const row = { id: `c${this.candidates.length + 1}`, vc_id: c.vcId, canonical_url: c.canonicalUrl, url: c.url, status: "PENDING", channel: c.channel };
    this.candidates.push(row);
    return row.id;
  };
  updateCandidate = async (id: string, p: Row) => {
    const c = this.candidates.find((x) => x.id === id)!;
    if (p.status) c.status = p.status;
    if (p.rejectionCode !== undefined) c.rejection_code = p.rejectionCode;
    if (p.signalId) c.signal_id = p.signalId;
  };
  upsertSignal = async (s: Row & { vc_id: string; cluster_key: string }) => {
    if (this.failUpsertSignalFor === s.vc_id) throw new Error("simulated DB failure");
    const ex = this.signals.find((x) => x.vc_id === s.vc_id && x.cluster_key === s.cluster_key);
    if (ex) { Object.assign(ex, { supporting_sources: s.supporting_sources, independent_source_count: s.independent_source_count }); return String(ex.id); }
    const row = { ...s, id: `s${this.signals.length + 1}` };
    this.signals.push(row);
    return String(row.id);
  };
  signalsInWindow = async (vcId: string) => this.signals.filter((s) => s.vc_id === vcId) as never;
  insertRecommendation = async (r: Row) => {
    if (!this.recs.some((x) => x.run_id === r.run_id && x.vc_id === r.vc_id)) this.recs.push(r);
  };
  applyAssessment = async (vcId: string, _runId: string, a: Row) => void this.assessments.set(vcId, a);
  recordSourceHealth = async () => {};
  llmTotals = async () => ({ calls: 0, tokensIn: 0, tokensOut: 0, searchCalls: 0 });
  findRunningRun = async () => undefined as never;
  failExhaustedTasks = async () => [] as string[];
}

const vc = (n: number, extra: Row = {}): Row => ({
  id: `vc${n}`, slug: `vc${n}`, name: "Investment team", firm: `Zenith Capital ${n}`, website: `https://zenith${n}.example.com`, aliases: [`Zenith Capital ${n}`], tracked_people: [],
  hq_region: "India", stage_focus: "PRESEED_SEED", sector_tags: ["logistics", "b2b_saas"], contact_status: "TO_REACH_OUT", last_contact_date: null, reconnect_after: null, is_demo_relationship: true, ...extra,
});

const articleHtml = (firm: string, date: string) => `<html lang="en"><head><title>${firm} leads seed round in RoutePilot</title>
<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"${date}T08:00:00Z"}</script></head><body><article><h1>${firm} leads seed round in RoutePilot</h1>
<p>${firm}, the venture capital firm, led a five million dollar seed round in RoutePilot, a logistics software company that helps fleet operators track shipments and warehouse deliveries across the country.</p>
<p>The funding will be used to hire engineers and to expand the freight visibility platform to more third party logistics customers this year, the company said in a statement on Monday.</p>
<p>RoutePilot says that more than forty delivery fleets already use its route optimisation and proof of delivery tools every single day.</p></article></body></html>`;

const EXCERPT = (firm: string) => `${firm}, the venture capital firm, led a five million dollar seed round in RoutePilot, a logistics software company`;

interface World {
  newsFor: (firm: string) => { url: string; title: string; date: string }[];
  fetchCount: Map<string, number>;
  failHosts: Set<string>;
}

function makeFetcher(w: World) {
  return {
    fetch: async (url: string) => {
      w.fetchCount.set(url, (w.fetchCount.get(url) ?? 0) + 1);
      const mk = (status: number, body: string, ct = "text/html") => ({ ok: status >= 200 && status < 300, status, url, finalUrl: url, contentType: ct, body, truncated: false, redirects: [], errorCode: status >= 400 ? "HTTP" : undefined, error: status >= 400 ? `HTTP ${status}` : undefined });
      const host = new URL(url).hostname;
      if ([...w.failHosts].some((h) => host.includes(h))) return mk(0, "", "") as never;
      if (url.includes("news.google.com/rss/search")) {
        const q = decodeURIComponent(url.split("q=")[1]!.split("&")[0]!);
        const firm = (q.match(/"([^"]+)"/) ?? [])[1] ?? "";
        const items = w.newsFor(firm).map((n) => `<item><title>${n.title}</title><link>${n.url}</link><pubDate>${new Date(`${n.date}T09:00:00Z`).toUTCString()}</pubDate><description>x</description></item>`).join("");
        return mk(200, `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`, "application/rss+xml") as never;
      }
      if (url.includes("publisher.example.com/")) {
        const m = url.match(/story-(\d+)-(\d{4}-\d{2}-\d{2})/)!;
        return mk(200, articleHtml(`Zenith Capital ${m[1]}`, m[2]!)) as never;
      }
      if (/^https:\/\/zenith\d+\.example\.com\/?$/.test(url)) return mk(200, "<html><head><title>Zenith</title></head><body>Home</body></html>") as never;
      if (/sector|feed|rss|atom|index\.xml/.test(url) || url.includes("zenith")) return mk(404, "not found") as never; // probes, sector feeds
      return mk(404, "not found") as never;
    },
  };
}

function makeGemini(mode: "ok" | "429" = "ok") {
  const requests: TransportRequest[] = [];
  const transport: Transport = {
    async generate(req): Promise<TransportResponse> {
      requests.push(req);
      if (mode === "429") throw Object.assign(new Error("quota exhausted retryDelay 999s"), { status: 429 });
      const docs = [...req.contents.matchAll(/<source_document id="(d\d+)"[^>]*>/g)];
      const firm = (req.contents.match(/<target_investor name="([^"]+)"/) ?? [])[1] ?? "";
      const events = docs.map((m) => ({
        doc_id: m[1], is_vc_activity: true, vc_role: "lead_investor", signal_type: "investment", title: `${firm} leads seed round in RoutePilot`, summary: "Seed round led by the firm.",
        subject_entity: "RoutePilot", event_date: null, event_date_basis: "not_stated", commitment: "confirmed", attribution_level: "firm", attributed_person: null,
        relevance_tier: "direct", relevance_reason: "logistics", evidence_excerpt: EXCERPT(firm), confidence: { attribution: 0.9, relevance: 0.9, date: 0.8 }, uncertainties: [],
      }));
      return { text: JSON.stringify({ events }), inputTokens: 100, outputTokens: 50, groundingChunks: [], searchQueries: [] };
    },
  };
  return { transport, requests };
}

function setup(vcCount: number, opts: { mode?: "ok" | "429"; news?: (firm: string) => { url: string; title: string; date: string }[]; vcExtra?: (n: number) => Row } = {}) {
  const store = new FakeStore(Array.from({ length: vcCount }, (_, i) => vc(i + 1, opts.vcExtra?.(i + 1))));
  const w: World = {
    fetchCount: new Map(),
    failHosts: new Set(),
    newsFor: opts.news ?? ((firm) => {
      const n = firm.replace("Zenith Capital ", "");
      return [{ url: `https://publisher.example.com/story-${n}-2026-10-05`, title: `${firm} backs RoutePilot`, date: "2026-10-05" }];
    }),
  };
  const g = makeGemini(opts.mode ?? "ok");
  const gemini = new GeminiClient({ models: ["gemini-3.8-flash"], maxCallsPerRun: 50, concurrency: 2 }, g.transport, async () => {}, async () => {});
  return { store, w, gemini, g, deps: (): NonNullable<Parameters<typeof runPipeline>[0]["deps"]> => ({ db: store, fetcher: makeFetcher(w) as never, gemini }) };
}

describe("pipeline orchestrator (fakes, no network)", () => {
  it("a normal run assesses every VC, writes ONE recommendation each, and finalises with the receipt", async () => {
    const s = setup(3);
    const r = await runPipeline({ trigger: "test", runKey: "test-1", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(r).toMatchObject({ done: true, status: "COMPLETED", remaining: 0 });
    expect(s.store.recs).toHaveLength(3);
    expect(s.store.assessments.size).toBe(3);
    const a = s.store.assessments.get("vc1")!;
    expect(a).toMatchObject({ assessment_status: "SIGNAL_FOUND", recommended_action: "REACH_OUT_NOW", qualifying_signal_count: 1, last_signal_date: "2026-10-05", scoring_version: getConfig().scoring.version });
    expect(String(a.signal_summary)).toContain("RoutePilot");
    const run = s.store.runs.get(r.runId)!;
    expect(run).toMatchObject({ vcs_total: 3, vcs_signal_found: 3, founder_data_intact: true });
  });

  it("every stored signal has a verified quote, a source URL and an in-window event date", async () => {
    const s = setup(2);
    await runPipeline({ trigger: "test", runKey: "test-2", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(s.store.signals.length).toBeGreaterThan(0);
    for (const sg of s.store.signals) {
      expect(sg.excerpt_verified).toBe(true);
      expect(String(sg.primary_source_url)).toMatch(/^https:\/\//);
      expect(String(sg.event_date) >= "2026-09-12" && String(sg.event_date) <= TODAY).toBe(true);
      expect(sg.is_synthetic).toBe(false);
    }
  });

  it("the same run_key is idempotent: a second call returns the finished run and creates nothing", async () => {
    const s = setup(2);
    const a = await runPipeline({ trigger: "cron", runKey: "cron-2026-10-12", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    const before = { recs: s.store.recs.length, signals: s.store.signals.length, cands: s.store.candidates.length, reqs: s.g.requests.length };
    const b = await runPipeline({ trigger: "github_action", runKey: "cron-2026-10-12", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(b).toMatchObject({ runId: a.runId, done: true, alreadyComplete: true });
    expect({ recs: s.store.recs.length, signals: s.store.signals.length, cands: s.store.candidates.length, reqs: s.g.requests.length }).toEqual(before);
  });

  it("resumes after a simulated timeout: the first chunk may do nothing, the next finishes the run", async () => {
    const s = setup(4);
    const first = await runPipeline({ trigger: "test", runKey: "test-resume", today: TODAY, budgetMs: 0, safetyMs: 10, deps: s.deps() });
    expect(first).toMatchObject({ done: false, processed: 0, remaining: 4 });
    // chunked: only 1 task per claim and a clock that runs out after the first VC
    let t = 0;
    const second = await runPipeline({ trigger: "test", runId: first.runId, today: TODAY, budgetMs: 10, safetyMs: 0, concurrency: 1, groundingEnabled: false, deps: { ...s.deps(), now: () => (t += 8) } });
    expect(second.done).toBe(false);
    expect(second.processed).toBeGreaterThan(0);
    expect(second.remaining).toBeLessThan(4);
    const third = await runPipeline({ trigger: "test", runId: first.runId, today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(third).toMatchObject({ done: true, status: "COMPLETED" });
    expect(s.store.recs).toHaveLength(4);
    expect(new Set(s.store.recs.map((r) => r.vc_id)).size).toBe(4);
  });

  it("one VC failing does not stop the others, and the failed VC becomes ASSESSMENT_INCOMPLETE (never quiet)", async () => {
    const s = setup(3);
    s.store.failUpsertSignalFor = "vc2";
    const r = await runPipeline({ trigger: "test", runKey: "test-fail", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(r.status).toBe("COMPLETED_WITH_ERRORS");
    expect(s.store.assessments.get("vc1")).toMatchObject({ recommended_action: "REACH_OUT_NOW" });
    expect(s.store.assessments.get("vc3")).toMatchObject({ recommended_action: "REACH_OUT_NOW" });
    expect(s.store.assessments.get("vc2")).toMatchObject({ recommended_action: "ASSESSMENT_INCOMPLETE", assessment_status: "FAILED", follow_up_score: null });
    expect(s.store.runs.get(r.runId)).toMatchObject({ vcs_failed: 1, error_count: 1 });
  });

  it("Gemini 429 / quota exhausted => ASSESSMENT_INCOMPLETE, never QUIET", async () => {
    const s = setup(2, { mode: "429" });
    const r = await runPipeline({ trigger: "test", runKey: "test-429", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(r.done).toBe(true);
    for (const id of ["vc1", "vc2"]) {
      const a = s.store.assessments.get(id)!;
      expect(a.recommended_action).toBe("ASSESSMENT_INCOMPLETE");
      expect(["PARTIAL", "FAILED"]).toContain(a.assessment_status);
      expect(a.assessment_status).not.toBe("QUIET");
    }
    expect(s.store.signals).toHaveLength(0);
    // the candidates must stay retryable, not be burned as rejected
    expect(s.store.candidates.every((c) => c.status === "PENDING")).toBe(true);
  });

  it("a genuinely quiet VC (news ok + grounded search ok, nothing found) is QUIET with the exact quiet copy", async () => {
    const s = setup(1, { news: () => [] });
    const r = await runPipeline({ trigger: "test", runKey: "test-quiet", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(r.done).toBe(true);
    expect(s.store.assessments.get("vc1")).toMatchObject({
      assessment_status: "QUIET", recommended_action: "DONT_PRIORITIZE", action_reason: getConfig().scoring.language.quiet, follow_up_score: null,
    });
  });

  it("too little coverage is PARTIAL, not QUIET (only one channel worked: official feed none, sector feeds down, grounding off)", async () => {
    const s = setup(1, { news: () => [] });
    await runPipeline({ trigger: "test", runKey: "test-thin", today: TODAY, budgetMs: 60_000, safetyMs: 0, groundingEnabled: false, deps: s.deps() });
    expect(s.store.assessments.get("vc1")).toMatchObject({ assessment_status: "PARTIAL", recommended_action: "ASSESSMENT_INCOMPLETE", action_reason: getConfig().scoring.language.incomplete });
  });

  it("a failed source channel is reported as PARTIAL even when nothing else was found", async () => {
    const s = setup(1, { news: () => [] });
    s.w.failHosts.add("news.google.com");
    await runPipeline({ trigger: "test", runKey: "test-badnews", today: TODAY, budgetMs: 60_000, safetyMs: 0, groundingEnabled: false, deps: s.deps() });
    const a = s.store.assessments.get("vc1")!;
    expect(a.recommended_action).toBe("ASSESSMENT_INCOMPLETE");
    expect(a.assessment_status).not.toBe("QUIET");
  });

  it("a repeat run on a new day creates no duplicate signals, and already-interpreted URLs are not fetched or sent to Gemini again", async () => {
    const s = setup(2);
    await runPipeline({ trigger: "test", runKey: "test-a", today: TODAY, budgetMs: 60_000, safetyMs: 0, groundingEnabled: false, deps: s.deps() });
    const signals = s.store.signals.length;
    const geminiCalls = s.g.requests.length;
    const articleFetches = [...s.w.fetchCount].filter(([u]) => u.includes("publisher.example.com")).reduce((a, [, n]) => a + n, 0);
    const r2 = await runPipeline({ trigger: "test", runKey: "test-b", today: "2026-10-13", budgetMs: 60_000, safetyMs: 0, groundingEnabled: false, deps: s.deps() });
    expect(r2.done).toBe(true);
    expect(s.store.signals).toHaveLength(signals);
    expect(s.g.requests.length).toBe(geminiCalls);
    expect([...s.w.fetchCount].filter(([u]) => u.includes("publisher.example.com")).reduce((a, [, n]) => a + n, 0)).toBe(articleFetches);
    expect(s.store.recs).toHaveLength(4); // one immutable snapshot per VC per run
  });

  it("stale and old events never become signals (31-day-old article)", async () => {
    const s = setup(1, { news: (firm) => [{ url: `https://publisher.example.com/story-${firm.replace("Zenith Capital ", "")}-2026-09-10`, title: `${firm} backs RoutePilot`, date: "2026-10-10" }] });
    await runPipeline({ trigger: "test", runKey: "test-old", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(s.store.signals).toHaveLength(0);
    expect(s.store.candidates.some((c) => c.rejection_code === "OLD_EVENT")).toBe(true);
    expect(s.store.assessments.get("vc1")!.recommended_action).not.toBe("REACH_OUT_NOW");
  });

  it("a relationship hold wins over a strong signal (waiting 3 days => HOLD)", async () => {
    const s = setup(1, { vcExtra: () => ({ contact_status: "WAITING_FOR_RESPONSE", last_contact_date: "2026-10-09" }) });
    await runPipeline({ trigger: "test", runKey: "test-hold", today: TODAY, budgetMs: 60_000, safetyMs: 0, deps: s.deps() });
    expect(s.store.assessments.get("vc1")).toMatchObject({ recommended_action: "HOLD", hold_reason: "RECENT_CONTACT" });
  });
});

describe("founder data cannot reach the pipeline", () => {
  it("pipelineDb read queries never select the notes or the contact-history column", () => {
    const src = readFileSync("src/lib/db/pipelineDb.ts", "utf8");
    const listVcs = src.slice(src.indexOf("async listVcs()"), src.indexOf("async getCompanyProfile()"));
    expect(listVcs).not.toMatch(/personal_notes|contact_history|select \*/);
    expect(registrableDomain("https://a.example.com")).toBe("example.com");
  });
  it("no pipeline module references founder write RPCs or founderDb", () => {
    for (const f of ["task.ts", "orchestrator.ts", "continue.ts"]) {
      const src = readFileSync(`src/lib/pipeline/${f}`, "utf8");
      expect(src).not.toMatch(/founder_update_vc|founder_append_contact_event|founderDb|personal_notes|contact_history/);
    }
  });
});
