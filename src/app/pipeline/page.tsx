import type { Metadata } from "next";
import { DemoChip } from "@/components/ui/chips";
import { PipelineBrowser, type PipelineRow } from "@/components/PipelineBrowser";
import { pageTitle } from "@/config/brand";
import { getCompanyProfile, getRun, listAllCards, listRuns, listSnapshotRows, listVcs } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Pipeline") };
export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let rows: PipelineRow[];
  let isSample = false;
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let asOf: Awaited<ReturnType<typeof getRun>> = null;
  try {
    const wanted = sp.asof && /^[0-9a-f-]{36}$/i.test(sp.asof) ? sp.asof : null;
    const [vcs, cards, company, runList] = await Promise.all([listVcs(), listAllCards(), getCompanyProfile(), listRuns(15)]);
    isSample = company.isSample;
    runs = runList.filter((r) => r.status !== "RUNNING");
    asOf = wanted ? await getRun(wanted) : null;
    const bySlug = new Map(cards.map((c) => [c.slug, c]));
    rows = asOf ? await listSnapshotRows(asOf.id) : vcs.map((v) => {
      const c = bySlug.get(v.slug);
      return {
        slug: v.slug, firm: v.firm, name: v.name, action: c?.action ?? "NOT_ASSESSED", holdReason: c?.holdReason ?? null, score: c?.score ?? null,
        lastSignalDate: c?.lastSignalDate ?? null, whyNow: c?.whyNow ?? null, contactStatus: v.contact_status, lastContactDate: v.last_contact_date,
        region: v.hq_region, assessmentStatus: v.assessment_status,
      };
    });
  } catch (e) {
    console.error("[pipeline page]", (e as Error).message);
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-2xl font-bold">Pipeline</h1>
        <p className="mt-2 text-ink-500">The database could not be reached. Nothing was changed. Please try again in a moment.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Pipeline</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
          All {rows.length} investors you track. Signals are live from the last 30 days; contact status and dates are <DemoChip>demo data</DemoChip> until you replace them.
          {isSample && <DemoChip>Sample company</DemoChip>}
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <label className="inline-flex items-center gap-2">View as of
          <select name="asof" defaultValue={asOf?.id ?? ""} className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm">
            <option value="">Now (latest)</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.run_key} · {r.started_at?.slice(0, 10)}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-[44px] rounded-xl border border-line bg-white px-4 font-semibold hover:border-brand">Show</button>
      </form>
      {asOf && <p className="rounded-xl bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">Snapshot as of run <strong>{asOf.run_key}</strong> ({asOf.started_at?.slice(0, 16).replace("T", " ")} UTC). Actions and scores are what that run decided; contact status shown is today&apos;s. <a className="font-semibold underline" href="/pipeline">Back to now</a></p>}
      <PipelineBrowser key={asOf?.id ?? "now"} rows={rows} initial={{ action: sp.action, status: sp.status, attention: sp.attention === "1" }} />
    </div>
  );
}
