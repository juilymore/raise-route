import type { Metadata } from "next";
import { Card, CardTitle, Stat } from "@/components/ui/cards";
import { DemoChip, TagYou } from "@/components/ui/chips";
import { pageTitle } from "@/config/brand";
import { getConfig } from "@/lib/config";
import { getCompanyProfile } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Settings") };
export const dynamic = "force-dynamic";

// P07: read-only. Founder editing of the company profile arrives with founder login in P08.
export default async function SettingsPage() {
  let c;
  try {
    c = await getCompanyProfile();
  } catch (e) {
    console.error("[settings]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  const { scoring } = getConfig();
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
        <p className="text-sm text-ink-700">There is no automatic schedule. Run it twice a week (for example Monday and Thursday morning) with the Run now button, once founder login is enabled. Each run checks live sources for the last 30 days.</p>
      </Card>
    </div>
  );
}
