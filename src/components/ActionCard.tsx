import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ActionChip, DemoChip, SourceChip, TagAI } from "@/components/ui/chips";
import { ScoreRing } from "@/components/ui/ScoreRing";
import type { ActionCardData } from "@/lib/db/readDb";

/** One recommendation: who, how strong, ONE sentence why-now, proof (source + date), next step. Score and chip are the loudest items. */
export function ActionCard({ c }: { c: ActionCardData }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-[0_8px_24px_rgba(14,31,43,.08)]">
      <div className="flex items-start gap-3">
        <ScoreRing score={c.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-display text-base font-semibold text-ink-900">{c.firm}</h3>
            <ActionChip action={c.action} holdReason={c.holdReason} />
          </div>
          <p className="text-[13px] text-ink-500">{c.name}</p>
        </div>
      </div>
      <p className="mt-3 text-[15px] leading-snug text-ink-700">
        <span className="mr-1.5 align-middle"><TagAI /></span>
        {c.whyNow ?? c.actionReason ?? "No recent signal."}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {c.evidenceUrl && <SourceChip url={c.evidenceUrl} domain={c.evidenceDomain} date={c.lastSignalDate} verified={c.evidenceVerified} />}
          <DemoChip>Demo relationship</DemoChip>
        </div>
        <Link href={`/vc/${c.slug}`} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          Open <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
