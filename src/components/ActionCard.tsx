import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { ACTION_HELP, ACTION_ICON, ACTION_STYLE, ActionChip, SourceChip, TagAI } from "@/components/ui/chips";
import { FeedbackButtons } from "@/components/founder/FeedbackButtons";
import { ScoreRing } from "@/components/ui/ScoreRing";
import type { ActionCardData } from "@/lib/db/readDb";

/** One recommendation: who, how strong, ONE sentence why-now, proof (source + date), next step. Score and chip are the loudest items. */
export function ActionCard({ c, founder = false, index = 0 }: { c: ActionCardData; founder?: boolean; index?: number }) {
  const s = ACTION_STYLE[c.action] ?? ACTION_STYLE.NOT_ASSESSED!;
  const Icon = ACTION_ICON[c.action];
  return (
    <article className="rr-fade rr-lift relative overflow-hidden rounded-2xl border border-line bg-surface p-4 pl-5" style={{ ["--d" as string]: `${index * 70}ms` }}>
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: s.dot }} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <ScoreRing score={c.score} color={s.dot} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-display text-base font-semibold text-ink-900"><Link href={`/vc/${c.slug}`} className="hover:text-brand">{c.firm}</Link></h3>
            <ActionChip action={c.action} holdReason={c.holdReason} />
          </div>
          <p className="text-[13px] text-ink-500">{c.name}</p>
        </div>
      </div>
      <p className="mt-3 text-[15px] leading-snug text-ink-700">
        <span className="mr-1.5 align-middle"><TagAI /></span>
        {c.whyNow ?? c.actionReason ?? "No recent signal."}
      </p>
      {Icon && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: s.fg }}><Icon size={13} aria-hidden="true" />{ACTION_HELP[c.action]}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {c.evidenceUrl && <SourceChip url={c.evidenceUrl} domain={c.evidenceDomain} date={c.lastSignalDate} verified={c.evidenceVerified} />}
          {c.lastSignalDate && !c.evidenceUrl && <span className="inline-flex items-center gap-1 text-xs text-ink-500"><CalendarDays size={12} aria-hidden="true" />{c.lastSignalDate}</span>}
        </div>
        <Link href={`/vc/${c.slug}`} className="group inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          Open <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
      {founder && c.recommendationId && <div className="mt-3 border-t border-line pt-3"><FeedbackButtons recommendationId={c.recommendationId} /></div>}
    </article>
  );
}
