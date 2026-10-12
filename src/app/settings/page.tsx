import type { Metadata } from "next";
import { Card, CardTitle, Stat } from "@/components/ui/cards";
import { pageTitle } from "@/config/brand";
import { CompanyEditor } from "@/components/founder/CompanyEditor";
import { ScoringEditor } from "@/components/founder/ScoringEditor";
import { editableGroups } from "@/lib/config/effective";
import { getCompanyProfile, getEffectiveScoring } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Settings") };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let c, eff;
  try {
    [c, eff] = await Promise.all([getCompanyProfile(), getEffectiveScoring()]);
  } catch (e) {
    console.error("[settings]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  const p = c.profile;
  const { scoring } = eff;
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Settings</h1>
      <Card>
        <CardTitle>{p.company_name}</CardTitle>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Stat label="Company" value={p.company_name} />
          <Stat label="Sector · stage" value={`${p.sector} · ${p.stage}`} />
          <Stat label="Geography" value={p.geography ?? "unknown"} />
          <Stat label="Relevance keywords" value={p.relevance_keywords.join(", ")} />
        </dl>
        <p className="mt-4 text-sm text-ink-700">{p.product_description}</p>
        <CompanyEditor company_name={p.company_name} product_description={p.product_description} sector={p.sector} stage={p.stage} geography={p.geography} icp={(p as { icp?: string | null }).icp ?? null} relevance_keywords={p.relevance_keywords} />
      </Card>
      <Card>
        <CardTitle>Scoring rubric</CardTitle>
        <dl className="mb-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Version" value={scoring.version} />
          <Stat label="Window" value={`${scoring.window_days} days`} />
          <Stat label="Reach out at" value={`score ≥ ${scoring.actions.reach_out_now_min_score}`} />
        </dl>
        <ScoringEditor groups={editableGroups(scoring)} version={scoring.version} edited={eff.edited} />
      </Card>
      <Card>
        <CardTitle>When it runs</CardTitle>
        <p className="text-sm text-ink-700">It runs automatically every Monday and Thursday at 08:30 IST (03:00 UTC, within the hour on the free plan). You can also press Run now at the top. Each run checks live sources for the last 30 days.</p>
      </Card>
    </div>
  );
}
