import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/cards";
import { BRAND, pageTitle } from "@/config/brand";

export const metadata: Metadata = { title: pageTitle("Components map") };

/** The exam's Components Map (deliverable E6). Source of truth: docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md. */
const COMPONENTS: Array<[string, string, string, string, string]> = [
  ["C1", "Web app + API", "UI and serverless endpoints", "Next.js App Router, TypeScript, Vercel; deployed from the GitHub repo (main)", "E4 deployed, public URL; E5 repo"],
  ["C2", "Scheduler", "Twice-weekly trigger (Mon + Thu 03:00 UTC), plus founder Run now", "Vercel Cron, /api/cron/run (bearer secret)", "E7 twice a week"],
  ["C4", "Database", "Single source of truth, guards, RPC functions", "Neon Postgres", "E11 live table"],
  ["C5", "Orchestrator", "Idempotent run_key, task queue, time-boxed chunks that continue themselves, Resume", "TypeScript + Postgres functions", "E7 reliability at 50 investors"],
  ["C6", "Source discovery", "Official feeds, Google News RSS, nine sector feeds (matched to names), optional Gemini grounded search (Google SDK path only) and Tavily/Exa raw results", "fast-xml-parser, fetch", "E1 live data, E9 signal types"],
  ["C7", "Fetcher + extractor", "SSRF-safe fetch, robots.txt, size/time caps, article text, date ladder", "undici, cheerio", "E9 30-day correctness"],
  ["C8", "Entity resolver", "Alias index, ambiguous-name guard (Accel, Eclipse...), firm vs person attribution", "TypeScript", "E9 right investor"],
  ["C9", "Gemini Flash analyst", "Structured extraction of what happened, with a verbatim quote. Never scores or decides", "Gemini Flash via @google/genai or OpenRouter (google/gemini-3.7-flash), zod", "E3 Gemini only"],
  ["C10", "Validators", "V1-V15 including quote verification", "TypeScript pure functions", "E9 observable, real"],
  ["C11", "Deduper", "One event = one signal; syndicated copies are not independent", "TypeScript", "quality"],
  ["C12", "Scoring engine", "100-point transparent score, versioned, config-driven; matches 30 golden vectors. Numbers are editable in Settings (validated, applied by code)", "TypeScript + config/scoring.v1.json + saved overrides", "E8 the why"],
  ["C13", "Action engine", "Relationship-aware action (reach out / follow up / monitor / hold / don't prioritize / incomplete)", "TypeScript", "E8, E10 quiet investors"],
  ["C14", "Integrity Guard", "No table privileges for the app role, one write function, a trigger, and a SHA-256 receipt per run", "Postgres grants, SECURITY DEFINER functions, triggers", "E12 + E13 never overwrite notes"],
  ["C15", "Snapshot writer", "Immutable recommendation per run (relationship snapshot has no notes)", "Postgres + immutability trigger", "history, explainability"],
  ["C18", "Dashboard", "Command Centre, pipeline, investor page with full history, runs, settings (company + scoring rubric)", "Next.js, Tailwind", "E8, E10 usability"],
  ["C20", "Observability", "Run audit, rejected evidence, source health, AI ledger, integrity receipts", "pipeline_runs, run_tasks, evidence_candidates, llm_calls", "trust, grading evidence"],
  ["C21", "Auth + rate limiting", "No login; Origin checks and rate limits on editing routes; bearer secret for cron; the database blocks system-column writes", "zod", "public URL is safe"],
  ["C22", "Quality gates", "Unit, golden, integration, evals, SQL guard tests, compliance script, CI", "Vitest, scripts/check-compliance.mjs", "credibility"],
];

const FLOW = ["Trigger (cron or Run now)", "Orchestrator + task queue", "Source discovery", "SSRF-safe fetch + date ladder", "Entity check", "Gemini extract (no tools)", "Validators + dedupe", "Score + action (code)", "apply_assessment (only write to your table)"];

const STEPS = [
  "A trigger hits /api/cron/run (bearer secret) or the founder presses Run now.",
  "The orchestrator starts an idempotent run and stores a fingerprint of your data. One task is created per investor.",
  "Per investor, sources are gathered: official feed, Google News, and the shared sector feeds (matched to the investor's names).",
  "Each candidate page is fetched safely and its publication date is resolved (never from dateModified).",
  "The investor is confirmed to be the one the page is about; Gemini returns a strict JSON event with a verbatim quote.",
  "Code verifies the quote exists in the page, the date is within 30 days, the role is real activity, and the story is not a duplicate. Rejected evidence is kept with a reason.",
  "Pure code computes the explainable score and the relationship-aware action and writes an immutable snapshot.",
  "apply_assessment() updates only the signal columns of your table. Your notes and contact history cannot change; the run stores a before/after receipt.",
];

export default function ComponentsMapPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Components map</h1>
        <p className="mt-1 text-sm text-ink-500">How {BRAND.name} is built: what each part does, what it uses, and which exam requirement it serves.</p>
      </div>

      <Card>
        <CardTitle>One run, end to end</CardTitle>
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Pipeline flow">
          {FLOW.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`rounded-xl border px-3 py-2 ${i === FLOW.length - 1 ? "border-brand bg-brand text-white" : "border-line bg-bg text-ink-900"}`}>{s}</span>
              {i < FLOW.length - 1 && <ArrowRight size={16} className="text-ink-500" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-ink-500">External live data: Google News RSS, VC blogs and podcasts, sector news feeds, Gemini grounded search (optional). Storage: Neon Postgres. AI: Gemini Flash only.</p>
      </Card>

      <Card>
        <CardTitle>Components</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-semibold">ID</th><th className="px-3 font-semibold">Component</th><th className="px-3 font-semibold">Responsibility</th><th className="px-3 font-semibold">Technology</th><th className="px-3 font-semibold">Requirement served</th></tr></thead>
            <tbody>
              {COMPONENTS.map(([id, name, what, tech, req]) => (
                <tr key={id} className="border-t border-line align-top"><td className="py-2 pr-3 font-mono text-xs">{id}</td><td className="px-3 font-medium text-ink-900">{name}</td><td className="px-3 text-ink-700">{what}</td><td className="px-3 text-ink-700">{tech}</td><td className="px-3 text-ink-700">{req}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Data flow</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      </Card>

      <Card>
        <CardTitle>Services and cost</CardTitle>
        <p className="text-sm text-ink-700">Vercel Hobby (free) · Neon free tier · Google AI Studio (Gemini Flash, small pay-as-you-go cost; a full 50-investor run is on the order of 50 to 100 model calls) · optional Resend for the email digest. No Claude or other model provider is used anywhere in the product; the AI ledger on each run page proves it.</p>
      </Card>
    </div>
  );
}
