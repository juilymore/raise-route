import { ArrowDown, ArrowRight, ArrowUp, Package } from "lucide-react";
import Link from "next/link";
import { ActionCard } from "@/components/ActionCard";
import { AiBanner } from "@/components/AiBanner";
import { RouteMotif } from "@/components/brand/Logo";
import { ActionChip, DemoChip } from "@/components/ui/chips";
import { Card, CardTitle, EmptyState, KpiCard, timeAgo } from "@/components/ui/cards";
import { getCompanyProfile, getLastRun, getOverview, listChanges, listIncomplete, listQuiet, listTodaysActions } from "@/lib/db/readDb";
import { getConfig } from "@/lib/config";
import { currentIsFounder } from "@/lib/founder/server";

export const dynamic = "force-dynamic";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default async function CommandCentre() {
  let d;
  try {
    const [overview, actions, changes, quiet, incomplete, run, company] = await Promise.all([
      getOverview(), listTodaysActions(12), listChanges(5), listQuiet(50), listIncomplete(50), getLastRun(), getCompanyProfile(),
    ]);
    d = { overview, actions, changes, quiet, incomplete, run, company };
  } catch (e) {
    console.error("[command centre]", (e as Error).message);
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-2xl font-bold">We could not reach the database</h1>
        <p className="mt-2 text-ink-500">Nothing was changed. Please refresh in a moment.</p>
      </div>
    );
  }
  const { overview: o, actions, changes, quiet, incomplete, run, company } = d;
  const founder = await currentIsFounder().catch(() => false);
  const quietCopy = getConfig().scoring.language.quiet;
  const worthContacting = o.reach_out_now + o.follow_up_now;
  const needsAttention = o.hold + o.assessment_incomplete;
  const assessed = o.total - o.not_assessed;

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <div className="relative overflow-hidden">
        <RouteMotif className="pointer-events-none absolute right-0 top-0 hidden h-28 w-72 text-brand opacity-[0.07] sm:block" />
        <h1 className="font-display text-[28px] font-bold leading-tight text-ink-900 sm:text-[32px]">{greeting()}, Vikram</h1>
        <p className="mt-1 text-[15px] text-ink-500">
          {run && assessed > 0
            ? `${worthContacting} investor${worthContacting === 1 ? "" : "s"} worth contacting today. Last checked ${timeAgo(run.completed_at ?? run.started_at)}.`
            : "No investors have been assessed yet. The first run fills this page in."}
          {company.isSample && <span className="ml-2 align-middle"><DemoChip>Sample company: {company.profile.company_name}</DemoChip></span>}
        </p>
      </div>

      {run && assessed > 0 && (
        <AiBanner
          id={run.id}
          text={run.status === "RUNNING" ? "A scan is in progress. Results below update as each investor is checked; the numbers are final when it completes." : `Scan complete: ${run.signals_qualified} new signal${run.signals_qualified === 1 ? "" : "s"} across ${run.vcs_total} investors, ${changes.length} priority change${changes.length === 1 ? "" : "s"}.`}
          href={changes.length ? "#changes" : `/runs/${run.id}`}
          cta={changes.length ? "View changes" : "View run"}
        />
      )}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard hero label="Reach out now" value={o.reach_out_now} hint="strong, fresh, relevant" href="/pipeline?action=REACH_OUT_NOW" />
        <KpiCard label="Follow up now" value={o.follow_up_now} hint="new hook since last contact" href="/pipeline?action=FOLLOW_UP_NOW" />
        <KpiCard label="Monitor" value={o.monitor} hint="some activity, not yet" href="/pipeline?action=MONITOR" />
        <KpiCard label="Needs attention" value={needsAttention} hint={`${o.hold} on hold · ${o.assessment_incomplete} incomplete`} href="/pipeline?attention=1" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle aside={<Link href="/pipeline" className="text-sm font-semibold text-brand hover:underline">See all {o.total}</Link>}>Today&apos;s actions</CardTitle>
          {actions.length === 0 ? (
            <EmptyState
              title={assessed === 0 ? "Nothing assessed yet" : "No one to contact today"}
              body={assessed === 0 ? "Run the pipeline to check all your investors against the last 30 days." : "Quiet is not a failure. No investor has a strong, fresh, relevant signal right now."}
              action={<Link href="/runs" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand hover:bg-bg">View runs</Link>}
            />
          ) : (
            <div className="space-y-3">
              {actions.slice(0, 5).map((c) => <ActionCard key={c.slug} c={c} founder={founder} />)}
              {actions.length > 5 && <Link href="/pipeline?attention=0&action=REACH_OUT_NOW" className="block py-2 text-center text-sm font-semibold text-brand hover:underline">Show {actions.length - 5} more</Link>}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="scroll-mt-4" >
            <span id="changes" className="block" />
            <CardTitle>What changed</CardTitle>
            {changes.length === 0 ? (
              <p className="py-3 text-sm text-ink-500">Nothing has moved since the previous run yet. Changes appear here from the second run on.</p>
            ) : (
              <ul className="divide-y divide-line">
                {changes.map((c) => {
                  const delta = (c.scoreNow ?? 0) - (c.scoreBefore ?? 0);
                  return (
                    <li key={c.slug} className="flex items-center justify-between gap-2 py-2.5">
                      <Link href={`/vc/${c.slug}`} className="min-w-0 truncate text-sm font-medium text-ink-900 hover:text-brand">{c.firm}</Link>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-ink-500">
                        {delta > 0 ? <ArrowUp size={14} className="text-emerald-600" aria-label="up" /> : delta < 0 ? <ArrowDown size={14} className="text-red-600" aria-label="down" /> : <ArrowRight size={14} aria-hidden="true" />}
                        {c.scoreBefore ?? "–"} → {c.scoreNow ?? "–"}
                        <ActionChip action={c.actionNow} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle aside={<span className="text-sm tabular-nums text-ink-500">{quiet.length}</span>}>Quiet investors</CardTitle>
            <p className="text-sm text-ink-700">{quietCopy}</p>
            {quiet.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No investor is confirmed quiet yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {quiet.slice(0, 5).map((q) => (
                  <li key={q.slug} className="text-sm">
                    <Link href={`/vc/${q.slug}`} className="font-medium text-ink-900 hover:text-brand">{q.firm}</Link>
                    <div className="text-xs text-ink-500">{q.daysSinceSignal === null ? "No qualifying signal on record" : `Last qualifying signal ${q.daysSinceSignal} days ago`} · checked: {q.channels ? Object.entries(q.channels).filter(([, v]) => v === "ok").map(([k]) => ({ A: "official feed", B: "news", C: "sector feeds", D: "grounded search" } as Record<string, string>)[k]).join(", ") || "none" : "n/a"}</div>
                  </li>
                ))}
                {quiet.length > 5 && <li><Link href="/pipeline?status=QUIET" className="text-sm font-semibold text-brand hover:underline">See all {quiet.length}</Link></li>}
              </ul>
            )}
            {incomplete.length > 0 && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-xs text-orange-900">
                <Package size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span><strong>{incomplete.length} investor{incomplete.length === 1 ? "" : "s"} could not be fully checked</strong> (a source was unavailable). That is not evidence of inactivity, so they are not listed as quiet.</span>
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
