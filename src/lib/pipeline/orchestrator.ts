import pLimit from "p-limit";
import { getConfig } from "@/lib/config";
import { buildAliasIndex } from "@/lib/engine/entities";
import { daysBetween } from "@/lib/engine/scoring";
import { createGeminiFromEnv, GeminiClient, type LedgerRow } from "@/lib/gemini";
import { getEnv } from "@/lib/env";
import { SafeFetcher } from "@/lib/sources/fetcher";
import { fetchSectorFeeds, matchItemsToVcs } from "@/lib/sources/sectorFeeds";
import type { PipelineStore } from "./store";
import { createAndMaybeSendDigest } from "@/lib/digest/send";
import { processVc, type TaskDeps, type VcInput } from "./task";

/**
 * Run lifecycle (docs/01 section 2): S0 start (idempotent run_key) -> S1 tasks -> S2 push discovery ->
 * S3 per-VC tasks in time-boxed chunks -> S4 finalize (integrity receipt).
 * A chunk processes tasks until the time budget is nearly used, then returns {done:false}; the caller (API route, CLI or the
 * Resume button) invokes it again and the run continues exactly where it stopped. Stale RUNNING tasks are reclaimed by the DB.
 */
export type Trigger = "manual" | "cron" | "github_action" | "test";

export interface RunOptions {
  trigger: Trigger;
  runKey?: string;
  /** Resume this exact run instead of starting one. */
  runId?: string;
  budgetMs: number;
  /** Stop starting new VCs when less than this remains (a VC takes 20-60 s). */
  safetyMs?: number;
  concurrency?: number;
  /** First live trials: only create tasks for these VC slugs. Normal runs cover all VCs. */
  onlySlugs?: string[];
  /** Override GEMINI_ENABLE_GROUNDING (tests, or to save search budget for one run). */
  groundingEnabled?: boolean;
  today?: string;
  deps?: Partial<{ db: PipelineStore; fetcher: Pick<SafeFetcher, "fetch">; gemini: GeminiClient; now: () => number }>;
}

export interface RunResult {
  runId: string;
  runKey: string;
  done: boolean;
  status: string;
  processed: number;
  remaining: number;
  alreadyComplete?: boolean;
}

export const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function defaultRunKey(trigger: Trigger, today: string, now = new Date()): string {
  return trigger === "cron" || trigger === "github_action" ? `cron-${today}` : `${trigger}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const now = opts.deps?.now ?? Date.now;
  const started = now();
  const env = getEnv();
  const cfg = getConfig();
  const db = opts.deps?.db ?? (await import("@/lib/db/pipelineDb")).pipelineDb;
  const today = opts.today ?? isoToday();
  const windowStart = addDays(today, -cfg.scoring.window_days);

  // S0: idempotent start. Same run_key => the same run; an already finished run is returned untouched.
  let run: Record<string, unknown> | undefined;
  if (opts.runId) run = await db.getRun(opts.runId);
  else {
    const runKey = opts.runKey ?? defaultRunKey(opts.trigger, today);
    run = await db.startRun({ runKey, trigger: opts.trigger, scoringVersion: cfg.scoring.version, model: env.GEMINI_MODEL_PRIMARY, windowStart, windowEnd: today });
  }
  if (!run) throw new Error("could not start or find the run");
  const runId = String(run.id);
  const runKey = String(run.run_key);
  if (run.status !== "RUNNING") return { runId, runKey, done: true, status: String(run.status), processed: 0, remaining: 0, alreadyComplete: true };

  // S1: one task per VC (no-op if they exist)
  const vcRows = await db.listVcs();
  await db.ensureTasks(runId, opts.onlySlugs ? vcRows.filter((r) => opts.onlySlugs!.includes(String(r.slug))).map((r) => String(r.id)) : undefined);

  // S2: shared context for every task in this invocation
  const vcs = new Map<string, VcInput>(vcRows.map((r) => [String(r.id), toVcInput(r)]));
  const aliasIndex = buildAliasIndex([...vcs.values()].map((v) => ({ id: v.id, firm: v.firm, aliases: v.aliases, tracked_people: v.tracked_people })));
  const profile = await db.getCompanyProfile();
  if (!profile) throw new Error("company_profile row is missing");
  const fetcher = opts.deps?.fetcher ?? new SafeFetcher(cfg.sources);
  const sectorFeeds = await fetchSectorFeeds(fetcher as SafeFetcher, cfg.sources);
  const sector = { byVc: matchItemsToVcs(sectorFeeds.items, aliasIndex), allFailed: sectorFeeds.allFailed };
  for (const h of sectorFeeds.health) {
    await db.recordSourceHealth({ vcId: null, kind: "sector_feed", url: h.url, label: h.name, ok: h.ok, httpStatus: h.status, error: h.error }).catch(() => {});
  }

  const ledger = await db.llmTotals(runId);
  const gemini =
    opts.deps?.gemini ??
    (await createGeminiFromEnv({
      ledger: async (row: LedgerRow) => {
        const { pipelineDb } = await import("@/lib/db/pipelineDb");
        await pipelineDb.insert("llm_calls", { ...row, run_id: runId });
      },
    }));
  // The call cap is per RUN, not per invocation: calls already in the ledger for this run count against it.
  gemini.setCallsUsed(ledger.calls);

  const deps: TaskDeps = {
    db,
    fetcher,
    gemini,
    cfg,
    aliasIndex,
    company: {
      product_description: String(profile.product_description),
      icp: (profile.icp as string | null) ?? null,
      relevance_keywords: (profile.relevance_keywords as string[]) ?? [],
      geography: (profile.geography as string | null) ?? null,
    },
    sector,
    run: { id: runId, today, windowStart },
    groundingEnabled: opts.groundingEnabled ?? env.GEMINI_ENABLE_GROUNDING,
  };

  // S3: claim and process in chunks until the time budget is nearly used
  const limit = pLimit(opts.concurrency ?? env.LLM_MAX_CONCURRENCY);
  const safety = opts.safetyMs ?? 45_000;
  let processed = 0;
  for (;;) {
    if (now() - started > opts.budgetMs - safety) break;
    const claimed = await db.claimRunTasks(runId, opts.concurrency ?? env.LLM_MAX_CONCURRENCY, 300);
    if (claimed.length === 0) break;
    await Promise.all(
      claimed.map((t) =>
        limit(async () => {
          const vc = vcs.get(String(t.vc_id));
          if (!vc) {
            await db.finishTask(String(t.id), "FAILED", {}, "unknown vc");
            return;
          }
          try {
            const out = await processVc(deps, vc);
            await db.finishTask(String(t.id), out.status, out.stats);
          } catch (e) {
            // One VC failing never stops the others, and never counts as "quiet": it becomes ASSESSMENT_INCOMPLETE.
            const msg = (e as Error).message.slice(0, 400);
            console.error(`[pipeline] ${vc.firm} failed:`, msg);
            await db.applyAssessment(vc.id, runId, {
              last_signal_date: null, signal_summary: null, follow_up_score: null, recommended_action: "ASSESSMENT_INCOMPLETE", hold_reason: null,
              action_reason: cfg.scoring.language.incomplete, assessment_status: "FAILED", score_breakdown: null, fit_score: null, qualifying_signal_count: 0,
              scoring_version: cfg.scoring.version,
            }).catch(() => {});
            await db.finishTask(String(t.id), "FAILED", { error: msg }, msg);
          }
          processed++;
        }),
      ),
    );
  }

  // Tasks that can never finish (3 attempts used, worker died) become FAILED + ASSESSMENT_INCOMPLETE, so the run can end honestly.
  for (const vcId of await db.failExhaustedTasks(runId)) {
    await db.applyAssessment(vcId, runId, {
      last_signal_date: null, signal_summary: null, follow_up_score: null, recommended_action: "ASSESSMENT_INCOMPLETE", hold_reason: null,
      action_reason: cfg.scoring.language.incomplete, assessment_status: "FAILED", score_breakdown: null, fit_score: null, qualifying_signal_count: 0,
      scoring_version: cfg.scoring.version,
    }).catch(() => {});
  }

  // S4: finalize only when no task is left to do
  const counts = await db.taskCounts(runId);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const pending = n("PENDING") + n("RUNNING");
  // A task that already used all its attempts and is still RUNNING/PENDING can never finish: treat as failed so the run can end.
  if (pending > 0) return { runId, runKey, done: false, status: "RUNNING", processed, remaining: pending };

  const taskRows = await db.taskStats(runId);
  const assess = (s: string) => taskRows.filter((t) => (t.stats as { assessment?: string }).assessment === s).length;
  const sum = (f: (s: Record<string, unknown>) => number) => taskRows.reduce((a, t) => a + f(t.stats as Record<string, unknown>), 0);
  const totals = await db.llmTotals(runId);
  const failedTasks = taskRows.filter((t) => t.status === "FAILED");
  const errors = failedTasks.slice(0, 20).map((t) => ({ status: t.status, error: (t.stats as { error?: string }).error ?? (t.stats as { notes?: string[] }).notes?.[0] ?? "assessment failed" }));
  await db.finalizeRun(runId, failedTasks.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED", {
    vcs_total: taskRows.length,
    vcs_signal_found: assess("SIGNAL_FOUND"),
    vcs_quiet: assess("QUIET"),
    vcs_partial: assess("PARTIAL"),
    vcs_failed: assess("FAILED") + taskRows.filter((t) => t.status === "FAILED" && !(t.stats as { assessment?: string }).assessment).length,
    candidates_found: sum((s) => Number((s.candidates as { found?: number } | undefined)?.found ?? 0)),
    signals_qualified: sum((s) => Number(s.new_signals ?? 0)),
    recommendations_written: taskRows.length,
    llm_calls: totals.calls,
    llm_tokens_in: totals.tokensIn,
    llm_tokens_out: totals.tokensOut,
    search_calls: totals.searchCalls,
    error_count: failedTasks.length,
    errors,
  });
  void daysBetween;
  // S5: the digest is built from this run's snapshots. Auto-send ONLY for cron/github runs with DIGEST_AUTO_SEND=true; manual runs never auto-send.
  // A digest problem never fails the run.
  try {
    // use the run's OWN trigger: a cron run that continues in later chunks is invoked as "manual" by /api/pipeline/continue
    const runTrigger = String(run.trigger);
    const auto = (runTrigger === "cron" || runTrigger === "github_action") && env.DIGEST_AUTO_SEND;
    await createAndMaybeSendDigest(db, { runId, send: auto });
  } catch (e) {
    console.error("[pipeline] digest step failed:", (e as Error).message);
  }
  return { runId, runKey, done: true, status: failedTasks.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED", processed, remaining: 0 };
}

function toVcInput(r: Record<string, unknown>): VcInput {
  return {
    id: String(r.id),
    firm: String(r.firm),
    website: (r.website as string | null) ?? null,
    aliases: (r.aliases as string[]) ?? [],
    tracked_people: (r.tracked_people as string[]) ?? [],
    hq_region: (r.hq_region as string | null) ?? null,
    stage_focus: (r.stage_focus as string | null) ?? null,
    sector_tags: (r.sector_tags as string[]) ?? [],
    contact_status: r.contact_status as VcInput["contact_status"],
    last_contact_date: (r.last_contact_date as string | null) ?? null,
    reconnect_after: (r.reconnect_after as string | null) ?? null,
    is_demo_relationship: Boolean(r.is_demo_relationship),
  };
}
