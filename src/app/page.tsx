import { ArrowDown, ArrowRight, ArrowUp, Eye, History, Moon, PauseCircle, Reply, Send, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ActionCard } from "@/components/ActionCard";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DashboardHero } from "@/components/DashboardHero";
import { OpportunityMatrix } from "@/components/OpportunityMatrix";
import { ActionChip } from "@/components/ui/chips";
import { Card, CardTitle, EmptyState, StatTile } from "@/components/ui/cards";
import { getCompanyProfile, getLastRun, getOverview, getRunProgress, listAllCards, listChanges, listIncomplete, listQuiet, listTodaysActions } from "@/lib/db/readDb";
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
    const [overview, actions, changes, quiet, incomplete, run, company, allCards] = await Promise.all([
      getOverview(), listTodaysActions(12), listChanges(5), listQuiet(50), listIncomplete(50), getLastRun(), getCompanyProfile(), listAllCards(),
    ]);
    const progress = run?.status === "RUNNING" ? await getRunProgress(run.id).catch(() => null) : null;
    d = { overview, actions, changes, quiet, incomplete, run, company, allCards, progress };
  } catch (e) {
    console.error("[command centre]", (e as Error).message);
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-2xl font-bold">We could not reach the database</h1>
        <p className="mt-2 text-ink-500">Nothing was changed. Please refresh in a moment.</p>
      </div>
    );
  }
  const { overview: o, actions, changes, quiet, incomplete, run, company, allCards, progress } = d;
  const founder = await currentIsFounder().catch(() => false);
  const quietCopy = getConfig().scoring.language.quiet;
  const worthContacting = o.reach_out_now + o.follow_up_now;
  const assessed = o.total - o.not_assessed;
  const running = run?.status === "RUNNING";
  const summary = run && !running && assessed > 0 ? `${run.signals_qualified} new signal${run.signals_qualified === 1 ? "" : "s"} across ${run.vcs_total} investors` : null;

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <AutoRefresh active={running} />

      {/* 1. Look here first */}
      <DashboardHero
        greeting={greeting()} company={company.profile.company_name} worth={worthContacting}
        lastRunAt={run ? run.completed_at ?? run.started_at : null} running={running} progress={progress} summary={summary} runHref={run ? `/runs/${run.id}` : "/runs"}
      />

      {/* 2. The four buckets, in the order Vikram should act on them */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Reach out now" value={o.reach_out_now} hint="Strong, fresh, relevant. Send a first message." icon={Send} tone="green" href="/pipeline?action=REACH_OUT_NOW" pulse delay={0} />
        <StatTile label="Follow up now" value={o.follow_up_now} hint="You know them; they did something new." icon={Reply} tone="teal" href="/pipeline?action=FOLLOW_UP_NOW" delay={60} />
        <StatTile label="Monitor" value={o.monitor} hint="Some activity. Not yet." icon={Eye} tone="blue" href="/pipeline?action=MONITOR" delay={120} />
        <StatTile label="On hold" value={o.hold} hint="Spoke recently or waiting for a reply." icon={PauseCircle} tone="gray" href="/pipeline?action=HOLD" delay={180} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Priority 1: who to contact */}
        <Card className="ring-1 ring-brand/15">
          <CardTitle aside={<Link href="/pipeline" className="text-sm font-semibold text-brand hover:underline">See all {o.total}</Link>}>
            <span className="inline-flex items-center gap-2"><Send size={18} className="text-brand" aria-hidden="true" />Contact these today</span>
          </CardTitle>
          {actions.length === 0 ? (
            <EmptyState
              title={assessed === 0 ? "Nothing assessed yet" : "No one to contact today"}
              body={assessed === 0 ? "Press Run now at the top to check all your investors against the last 30 days." : "Quiet is not a failure. No investor has a strong, fresh, relevant signal right now."}
              action={<Link href="/runs" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand hover:bg-bg">View runs</Link>}
            />
          ) : (
            <div className="space-y-3">
              {actions.slice(0, 5).map((c, i) => <ActionCard key={c.slug} c={c} founder={founder} index={i} />)}
              {actions.length > 5 && <Link href="/pipeline?action=REACH_OUT_NOW" className="block py-2 text-center text-sm font-semibold text-brand hover:underline">Show {actions.length - 5} more</Link>}
            </div>
          )}
        </Card>

        {/* Priority 2: what moved; then information only */}
        <div className="space-y-6">
          <Card>
            <CardTitle><span className="inline-flex items-center gap-2"><History size={18} className="text-brand" aria-hidden="true" />What changed</span></CardTitle>
            <span id="changes" className="block" />
            {changes.length === 0 ? (
              <p className="py-3 text-sm text-ink-500">Nothing has moved since the previous run yet. Changes appear here from the second run on.</p>
            ) : (
              <ul className="divide-y divide-line">
                {changes.map((c) => {
                  const delta = (c.scoreNow ?? 0) - (c.scoreBefore ?? 0);
                  return (
                    <li key={c.slug}>
                      <Link href={`/vc/${c.slug}`} className="flex items-center justify-between gap-2 py-2.5 hover:text-brand">
                        <span className="min-w-0 truncate text-sm font-medium text-ink-900">{c.firm}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-ink-500">
                          {delta > 0 ? <ArrowUp size={14} className="text-emerald-600" aria-label="up" /> : delta < 0 ? <ArrowDown size={14} className="text-red-600" aria-label="down" /> : <ArrowRight size={14} aria-hidden="true" />}
                          {c.scoreBefore === null && c.scoreNow === null ? (
                            <>{c.actionBefore ? <ActionChip action={c.actionBefore} /> : null}<span aria-hidden="true">→</span></>
                          ) : (
                            <>{c.scoreBefore ?? "no score"} → {c.scoreNow ?? "no score"}</>
                          )}
                          <ActionChip action={c.actionNow} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="bg-bg/60 shadow-none">
            <CardTitle aside={<span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-700">{quiet.length}</span>}>
              <span className="inline-flex items-center gap-2 text-ink-700"><Moon size={18} aria-hidden="true" />Quiet investors</span>
            </CardTitle>
            <p className="text-sm text-ink-700">{quietCopy}</p>
            {quiet.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No investor is confirmed quiet yet.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {quiet.slice(0, 5).map((q) => (
                  <li key={q.slug}>
                    <Link href={`/vc/${q.slug}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-white">
                      <span className="font-medium text-ink-900">{q.firm}</span>
                      <span className="block text-xs text-ink-500">{q.daysSinceSignal === null ? "No qualifying signal on record" : `Last qualifying signal ${q.daysSinceSignal} days ago`}</span>
                    </Link>
                  </li>
                ))}
                {quiet.length > 5 && <li><Link href="/pipeline?status=QUIET" className="px-2 text-sm font-semibold text-brand hover:underline">See all {quiet.length}</Link></li>}
              </ul>
            )}
            {incomplete.length > 0 && (
              <Link href="/pipeline?action=ASSESSMENT_INCOMPLETE" className="mt-4 flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-xs text-orange-900 hover:bg-orange-100">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span><strong>{incomplete.length} investor{incomplete.length === 1 ? "" : "s"} could not be fully checked</strong> (a source was unavailable). That is not evidence of inactivity, so they are not listed as quiet.</span>
              </Link>
            )}
          </Card>
        </div>
      </div>

      {/* 3. Information only */}
      <details className="group rounded-[20px] border border-line bg-surface p-5">
        <summary className="flex cursor-pointer items-center gap-2 font-display text-xl font-semibold text-ink-900"><Sparkles size={18} className="text-ai" aria-hidden="true" />Opportunity matrix <span className="text-sm font-normal text-ink-500">fit vs score, click a dot</span></summary>
        <div className="mt-3"><OpportunityMatrix cards={allCards} /></div>
      </details>
    </div>
  );
}
