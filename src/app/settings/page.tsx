import type { Metadata } from "next";
import { Card, CardTitle, Stat } from "@/components/ui/cards";
import { DemoChip, TagYou } from "@/components/ui/chips";
import { pageTitle } from "@/config/brand";
import { getConfig } from "@/lib/config";
import { CompanyEditor } from "@/components/founder/CompanyEditor";
import { currentIsFounder } from "@/lib/founder/server";
import { getCompanyProfile } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Settings") };
export const dynamic = "force-dynamic";

// Visitors see this read-only. A logged-in founder gets the editor (PATCH /api/founder/company).
export default async function SettingsPage() {
  let c;
  try {
    c = await getCompanyProfile();
  } catch (e) {
    console.error("[settings]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  const { scoring } = getConfig();
  const founder = await currentIsFounder().catch(() => false);
  const p = c.profile;
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Settings</h1>
      <Card>
        <CardTitle aside={<span className="inline-flex items-center gap-2"><TagYou />{c.isSample && <DemoChip>Sample</DemoChip>}</span>}>Your company</CardTitle>
        {c.isSample && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">This is a <strong>sample</strong> company profile so relevance scoring has realistic context. Replace it with your real company; relevance quality depends on it.</p>}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Stat label="Company" value={p.company_name} />
          <Stat label="Sector · stage" value={`${p.sector} · ${p.stage}`} />
          <Stat label="Geography" value={p.geography ?? "unknown"} />
          <Stat label="Relevance keywords" value={p.relevance_keywords.join(", ")} />
        </dl>
        <p className="mt-4 text-sm text-ink-700">{p.product_description}</p>
        {founder ? <CompanyEditor company_name={p.company_name} product_description={p.product_description} sector={p.sector} stage={p.stage} geography={p.geography} icp={(p as { icp?: string | null }).icp ?? null} relevance_keywords={p.relevance_keywords} /> : <p className="mt-3 text-xs text-ink-500">Log in as founder (top right) to edit.</p>}
      </Card>
      <Card>
        <CardTitle>Scoring</CardTitle>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat label="Version" value={scoring.version} />
          <Stat label="Window" value={`${scoring.window_days} days`} />
          <Stat label="Reach out at" value={`score ≥ ${scoring.actions.reach_out_now_min_score}`} />
        </dl>
        <p className="mt-3 text-sm text-ink-500">Weights live in config/scoring.v1.json and are applied by code, not by AI.</p>
      </Card>
      <Card>
        <CardTitle>When it runs</CardTitle>
        <p className="text-sm text-ink-700">It runs automatically every Monday and Thursday at 08:30 IST (03:00 UTC, within the hour on the free plan). You can also press Run now after founder login. Each run checks live sources for the last 30 days.</p>
      </Card>
    </div>
  );
}
