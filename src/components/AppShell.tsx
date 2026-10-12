import Link from "next/link";
import { Radar } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { BottomTabs, IconRail, PillNav } from "@/components/NavLinks";
import { timeAgo } from "@/components/ui/cards";
import { getLastRun, type RunSummary } from "@/lib/db/readDb";

/** Honest status of the Integrity Guard receipt for the last run. */
export function IntegrityBadge({ run }: { run: RunSummary | null }) {
  if (!run) return <span className="rounded-full bg-bg px-2.5 py-1 text-xs text-ink-500" title="No run has finished yet">Integrity: no run yet</span>;
  if (run.status === "RUNNING") return <span className="rounded-full bg-bg px-2.5 py-1 text-xs text-ink-500">Integrity: run in progress</span>;
  if (run.founder_data_intact === true) return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" title="Your notes and contact history were byte-identical before and after the last run">✅ Your data intact</span>;
  if (run.founder_data_intact === false) return <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">❌ Founder data changed</span>;
  return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800" title="You edited your data while the run was in progress, so the before/after comparison does not apply">⚠ You edited during run</span>;
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  let run: RunSummary | null = null;
  try {
    run = await getLastRun();
  } catch {
    run = null; // the page itself shows the database error; the shell must not crash
  }
  return (
    <div className="min-h-screen p-2 pb-20 sm:p-4 md:pb-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="mx-auto max-w-[1360px] overflow-hidden rounded-[24px] bg-surface shadow-[0_1px_2px_rgba(14,31,43,.04),0_8px_24px_rgba(14,31,43,.05)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><Wordmark /></Link>
          <PillNav />
          <div className="flex items-center gap-2">
            <Link href={run ? `/runs/${run.id}` : "/runs"} className="hidden items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-xs text-ink-700 hover:text-brand sm:inline-flex">
              <Radar size={13} aria-hidden="true" />
              {run ? `Last run ${timeAgo(run.completed_at ?? run.started_at)} · ${run.status === "COMPLETED" ? "completed" : run.status.toLowerCase().replaceAll("_", " ")} · ${run.trigger}` : "No run yet"}
            </Link>
            <IntegrityBadge run={run} />
          </div>
        </header>
        <div className="flex">
          <IconRail />
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:py-8">{children}</main>
        </div>
      </div>
      <BottomTabs />
    </div>
  );
}
