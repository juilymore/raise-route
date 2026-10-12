import Link from "next/link";
import { Radar } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { BottomTabs, PillNav } from "@/components/NavLinks";
import { timeAgo } from "@/components/ui/cards";
import { FounderMenu } from "@/components/founder/FounderMenu";
import { getCompanyProfile, getLastRun, type RunSummary } from "@/lib/db/readDb";

export async function AppShell({ children }: { children: React.ReactNode }) {
  let run: RunSummary | null = null;
  try {
    run = await getLastRun();
  } catch {
    run = null; // the page itself shows the database error; the shell must not crash
  }
  const company = await getCompanyProfile().then((c) => c.profile.company_name).catch(() => undefined);
  return (
    <div className="min-h-screen p-2 pb-20 sm:p-4 md:pb-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="mx-auto max-w-[1360px] overflow-hidden rounded-[24px] bg-surface shadow-[0_1px_2px_rgba(14,31,43,.04),0_8px_24px_rgba(14,31,43,.05)]">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-white sm:px-6" style={{ background: "linear-gradient(110deg, var(--brand-ink) 0%, var(--brand) 55%, #1b958a 100%)" }}>
          <Link href="/" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><Wordmark company={company} light /></Link>
          <PillNav />
          <div className="flex items-center gap-2">
            <Link href={run ? `/runs/${run.id}` : "/runs"} className="hidden items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs text-white/90 backdrop-blur hover:bg-white/25 sm:inline-flex">
              <Radar size={13} aria-hidden="true" />
              {run ? `Last run ${timeAgo(run.completed_at ?? run.started_at)} · ${run.status === "COMPLETED" ? "completed" : run.status.toLowerCase().replaceAll("_", " ")} · ${run.trigger}` : "No run yet"}
            </Link>
            <FounderMenu />
          </div>
        </header>
        <div className="flex">
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:py-8">{children}</main>
        </div>
        <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-line px-4 py-3 text-xs text-ink-500">
          <Link href="/digests" className="hover:text-brand">Email digest</Link>
          <Link href="/calibration" className="hover:text-brand">Calibration</Link>
          <Link href="/how-we-verify" className="hover:text-brand">How we verify</Link>
          <span>All AI in this app is Gemini Flash</span>
        </footer>
      </div>
      <BottomTabs />
    </div>
  );
}
