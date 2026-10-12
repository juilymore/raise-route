import { CheckCircle2, Radar } from "lucide-react";
import Link from "next/link";
import { Truck } from "@/components/brand/TruckLoader";
import { CountUp } from "@/components/ui/CountUp";
import { timeAgo } from "@/components/ui/cards";

/** The one thing Vikram should see first: how many investors are worth contacting today, and whether a scan is running. */
export function DashboardHero({
  greeting, company, worth, lastRunAt, running, progress, summary, runHref,
}: {
  greeting: string; company: string; worth: number; lastRunAt: string | null; running: boolean; progress: { done: number; total: number } | null; summary: string | null; runHref: string;
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section className="relative overflow-hidden rounded-[28px] p-6 text-white shadow-[0_14px_40px_rgba(15,118,110,.28)] sm:p-8" style={{ background: "linear-gradient(120deg, var(--brand-ink) 0%, var(--brand) 62%, #1d9a8e 100%)" }}>
      {/* decorative scene: clouds, warehouses, a road with a truck */}
      <svg className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[48%] sm:block" viewBox="0 0 420 220" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <g className="rr-cloud" opacity=".18" fill="#fff"><ellipse cx="90" cy="46" rx="34" ry="10" /><ellipse cx="116" cy="40" rx="22" ry="9" /><ellipse cx="300" cy="30" rx="30" ry="8" /></g>
        <g fill="#fff" opacity=".14"><rect x="210" y="104" width="64" height="62" rx="4" /><rect x="282" y="86" width="52" height="80" rx="4" /><rect x="342" y="112" width="70" height="54" rx="4" /></g>
        <g fill="#0b3b3a" opacity=".35"><rect x="222" y="126" width="12" height="40" /><rect x="244" y="126" width="12" height="40" /><rect x="352" y="132" width="14" height="34" /><rect x="376" y="132" width="14" height="34" /></g>
        <rect x="0" y="166" width="420" height="54" fill="#0b3b3a" opacity=".45" />
        <line className="rr-road" x1="0" y1="194" x2="420" y2="194" stroke="#fff" strokeWidth="2.5" strokeDasharray="14 14" opacity=".7" />
      </svg>
      <div className="pointer-events-none absolute bottom-[11px] right-0 hidden w-[48%] overflow-hidden sm:block" style={{ ["--road" as string]: "380px", ["--dur" as string]: running ? "2.2s" : "7s" }} aria-hidden="true">
        <div className="rr-truck" style={{ width: 56 }}><Truck /></div>
      </div>

      <div className="relative max-w-xl">
        <p className="text-sm font-medium text-white/80">{greeting}, Vikram</p>
        <p className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold backdrop-blur">Vikram&apos;s dashboard · {company}</p>
        <h1 className="mt-4 font-display text-[40px] font-bold leading-[1.05] sm:text-[52px]">
          <CountUp value={worth} /> <span className="text-[22px] font-semibold sm:text-[26px]">investor{worth === 1 ? "" : "s"} worth contacting today</span>
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
          <span className="inline-flex items-center gap-1.5"><Radar size={15} aria-hidden="true" />Last checked {timeAgo(lastRunAt)}</span>
          {summary && <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" />{summary}</span>}
        </p>
        {running && (
          <div className="mt-4 max-w-sm" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-xs font-semibold"><span>Scanning investors…</span><span className="tabular-nums">{progress ? `${progress.done} of ${progress.total}` : ""}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(6, pct)}%` }} /></div>
            <p className="mt-1 text-xs text-white/80">The truck is on the road. Results appear below as each investor is checked.</p>
          </div>
        )}
        <Link href={runHref} className="mt-4 inline-block text-xs font-semibold text-white/80 underline-offset-2 hover:text-white hover:underline">Run details</Link>
      </div>
    </section>
  );
}
