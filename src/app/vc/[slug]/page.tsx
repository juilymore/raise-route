import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionChip, DemoChip, SourceChip, TagAI, TagYou } from "@/components/ui/chips";
import { Card, CardTitle, EmptyState, Stat } from "@/components/ui/cards";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { StageTracker } from "@/components/StageTracker";
import { pageTitle } from "@/config/brand";
import { getConfig } from "@/lib/config";
import { daysBetween } from "@/lib/engine/scoring";
import { getVcDetail, type SignalRow } from "@/lib/db/readDb";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: pageTitle(slug.replaceAll("-", " ")) };
}

const FACTORS = [
  ["relevance", "Relevance"], ["recency", "Recency"], ["strength", "Signal strength"], ["corroboration", "Corroboration"], ["evidence_quality", "Evidence quality"], ["fund_fit", "Fund fit"],
] as const;

const TIER_TEXT: Record<string, string> = { direct: "directly about logistics / supply chain", adjacent: "adjacent (industrial, mobility, vertical software)", b2b_saas: "general B2B software", broad: "generic startup or tech news", none: "not relevant" };

function factorReason(key: string, top: SignalRow | undefined, vc: { stage_focus: string | null; sector_tags: string[]; hq_region: string | null }, today: string): string {
  if (key === "fund_fit") return `Stage: ${vc.stage_focus ?? "unknown"}; sectors: ${vc.sector_tags.join(", ") || "unknown"}; region: ${vc.hq_region ?? "unknown"}. Unknown counts as neutral, never invented.`;
  if (!top) return "No qualifying signal.";
  switch (key) {
    case "relevance": return `Top signal is ${TIER_TEXT[top.relevance_tier] ?? top.relevance_tier}.`;
    case "recency": return `Event on ${top.event_date}, ${daysBetween(top.event_date, today)} day(s) ago. Fresher scores higher; the 30-day window is a hard limit.`;
    case "strength": return `${top.signal_type.replaceAll("_", " ")}${top.commitment && top.commitment !== "not_applicable" ? `, ${top.commitment}` : ""}. Investments outrank essays and mentions.`;
    case "corroboration": return top.independent_source_count > 1 ? `${top.independent_source_count} independent sources agree.` : "Single source. Syndicated copies do not count as independent.";
    case "evidence_quality": return `${(top.primary_source_type ?? "other").replaceAll("_", " ")}; date from ${top.event_date_basis.replaceAll("_", " ")}; quote ${top.excerpt_verified ? "verified in the page text" : "NOT verified"}.`;
    default: return "";
  }
}

export default async function VcPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data;
  try {
    data = await getVcDetail(slug);
  } catch (e) {
    console.error("[vc page]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  if (!data) notFound();
  const { vc, signals, history, taskStats } = data;
  const cfg = getConfig().scoring;
  const today = new Date().toISOString().slice(0, 10);
  const top = signals.find((s) => s.event_date === vc.last_signal_date) ?? signals[0];
  const channels = (taskStats?.channels ?? null) as Record<string, string> | null;
  const CH: Record<string, string> = { A: "official feed", B: "news", C: "sector feeds", D: "grounded search" };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <Link href="/pipeline" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand"><ArrowLeft size={15} aria-hidden="true" />Pipeline</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold leading-tight text-ink-900 sm:text-[32px]">{vc.firm}</h1>
          <p className="mt-1 text-sm text-ink-500">{vc.name}{vc.hq_region ? ` · ${vc.hq_region}` : ""}{vc.website ? <> · <a className="text-brand hover:underline" href={vc.website} target="_blank" rel="noopener noreferrer">website <ExternalLink size={11} className="inline" aria-hidden="true" /></a></> : null}</p>
          {vc.thesis && <p className="mt-2 max-w-2xl text-sm text-ink-700">{vc.thesis} <span className="text-xs text-ink-500">(unverified starter hint)</span></p>}
        </div>
        <div className="flex items-center gap-3">
          <ActionChip action={vc.recommended_action ?? "NOT_ASSESSED"} holdReason={vc.hold_reason} className="text-sm" />
          <ScoreRing score={vc.follow_up_score} size={64} />
        </div>
      </header>

      {vc.action_reason && (
        <p className="rounded-2xl bg-bg px-4 py-3 text-[15px] text-ink-700"><span className="mr-2 align-middle"><TagAI /></span>{vc.action_reason}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle aside={<span className="text-xs text-ink-500">scoring {vc.scoring_version ?? "–"}</span>}>Why this score</CardTitle>
          {!vc.score_breakdown ? (
            <p className="text-sm text-ink-500">{vc.follow_up_score === null ? "No score: there is no qualifying signal in the last 30 days, so we do not invent one. A fund-fit-only number would look like an opportunity that is not there." : "No breakdown stored."}</p>
          ) : (
            <ul className="space-y-3">
              {FACTORS.map(([key, label]) => {
                const pts = vc.score_breakdown![key] ?? 0;
                const max = (cfg.max_points as Record<string, number>)[key] ?? 1;
                return (
                  <li key={key}>
                    <div className="flex items-baseline justify-between text-sm"><span className="font-medium text-ink-900">{label}</span><span className="tabular-nums text-ink-700">{pts} / {max}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg" role="img" aria-label={`${label}: ${pts} of ${max}`}><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (pts / max) * 100)}%` }} /></div>
                    <p className="mt-1 text-xs text-ink-500">{factorReason(key, top, vc, today)}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink-500">Computed by code from verified facts, not by AI. Last assessed {vc.last_assessed_at ? vc.last_assessed_at.slice(0, 16).replace("T", " ") + " UTC" : "never"}.</p>
        </Card>

        <Card>
          <CardTitle aside={<span className="inline-flex items-center gap-2"><TagYou /><DemoChip /></span>}>Relationship</CardTitle>
          <StageTracker status={vc.contact_status} />
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Last contact" value={vc.last_contact_date ?? "none"} />
            <Stat label="Reconnect after" value={vc.reconnect_after ?? "none"} />
          </dl>
          {vc.contact_history.length > 0 && (
            <ul className="mt-4 space-y-1 border-l-2 border-dotted border-line pl-3 text-sm text-ink-700">
              {vc.contact_history.map((h, i) => <li key={i}><span className="tabular-nums text-ink-500">{h.at}</span> · {String(h.type ?? "").replaceAll("_", " ")} · {h.summary}</li>)}
            </ul>
          )}
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Your notes <DemoChip>synthetic</DemoChip></div>
            {vc.personal_notes ?? "No notes."}
          </div>
          <p className="mt-3 text-xs text-ink-500">The system never edits this panel. Editing is for the founder only.</p>
        </Card>
      </div>

      <Card>
        <CardTitle aside={<TagAI>AI-extracted · code-verified</TagAI>}>Evidence</CardTitle>
        {signals.length === 0 ? (
          <EmptyState
            title={vc.assessment_status === "QUIET" ? "Quiet is not a failure" : vc.assessment_status === "NOT_ASSESSED" ? "Not assessed yet" : "No qualifying signal found"}
            body={vc.assessment_status === "QUIET" ? "No qualifying signal found in the sources checked in the past 30 days." : vc.recommended_action === "ASSESSMENT_INCOMPLETE" ? "Assessment incomplete: one or more sources could not be checked. This is not evidence of inactivity." : undefined}
          />
        ) : (
          <ul className="space-y-4">
            {signals.map((s) => (
              <li key={s.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="rounded-md bg-bg px-1.5 py-0.5 font-semibold uppercase tracking-wide text-ink-700">{s.signal_type.replaceAll("_", " ")}</span>
                  <span>event <strong className="tabular-nums text-ink-700">{s.event_date}</strong> ({s.event_date_basis.replaceAll("_", " ")})</span>
                  {s.published_at && s.published_at !== s.event_date && <span>published <span className="tabular-nums">{s.published_at}</span></span>}
                  <span>· {s.relevance_tier.replaceAll("_", " ")}</span>
                  <span>· {s.attribution_level === "person" && s.attributed_person ? `attributed to ${s.attributed_person}` : "firm-level"}</span>
                  {s.commitment === "rumor" && <span className="font-semibold text-orange-700">rumour</span>}
                </div>
                <h3 className="mt-1 font-display text-base font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-700">{s.summary}</p>
                <blockquote className="mt-2 border-l-4 border-brand/40 pl-3 text-sm italic text-ink-700">“{s.evidence_excerpt}”<span className="ml-2 not-italic">{s.excerpt_verified ? <span className="text-xs font-semibold text-emerald-700">✓ verified quote</span> : <span className="text-xs font-semibold text-red-700">unverified</span>}</span></blockquote>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SourceChip url={s.primary_source_url} domain={(() => { try { return new URL(s.primary_source_url).hostname.replace(/^www\./, ""); } catch { return null; } })()} date={s.event_date} verified={s.excerpt_verified} />
                  {s.supporting_sources.map((x) => <SourceChip key={x.url} url={x.url} domain={x.domain ?? null} />)}
                  <span className="text-xs text-ink-500">{s.independent_source_count} independent source{s.independent_source_count === 1 ? "" : "s"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {channels && (
          <p className="mt-4 text-xs text-ink-500">Sources checked: {Object.entries(channels).map(([k, v]) => `${CH[k] ?? k} ${v === "ok" ? "✓" : v === "fail" ? "✗ (failed)" : v === "none" ? "– (none exists)" : "– (skipped)"}`).join(" · ")}</p>
        )}
      </Card>

      <Card>
        <CardTitle>History</CardTitle>
        {history.length === 0 ? <p className="text-sm text-ink-500">No snapshots yet.</p> : (
          <ol className="space-y-3 border-l-2 border-dotted border-line pl-4">
            {history.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-2 text-sm"><ActionChip action={h.action} /><span className="tabular-nums text-ink-700">score {h.score ?? "–"}</span><span className="text-xs text-ink-500">{h.at.slice(0, 16).replace("T", " ")} UTC · {h.runKey} · v{h.version.replace(/^v/, "")}</span></div>
                <p className="mt-0.5 text-xs text-ink-500">{h.reason}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-ink-500">Snapshots are immutable: a later score change never rewrites an earlier one.</p>
      </Card>
    </div>
  );
}
