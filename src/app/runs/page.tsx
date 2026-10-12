import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, timeAgo } from "@/components/ui/cards";
import { RUN_STATUS } from "@/components/ui/runStatus";
import { pageTitle } from "@/config/brand";
import { listRuns } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Runs") };
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  let runs;
  try {
    runs = await listRuns(30);
  } catch (e) {
    console.error("[runs]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Runs</h1>
        <p className="mt-1 text-sm text-ink-500">Every check of your investors, with what was found, what was rejected and why. Nothing here is hidden.</p>
      </div>
      <Card>
        {runs.length === 0 ? <EmptyState title="No runs yet" body="The first run checks all your investors against live sources." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-semibold">Run</th><th className="px-3 font-semibold">Status</th><th className="px-3 font-semibold">Investors</th><th className="px-3 font-semibold">Signals</th><th className="px-3 font-semibold">Quiet / partial / failed</th><th className="px-3 font-semibold">AI calls</th><th className="px-3 font-semibold">Your data</th></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const s = RUN_STATUS[r.status] ?? { label: r.status, cls: "bg-gray-100 text-gray-600" };
                  return (
                    <tr key={r.id} className="border-t border-line align-middle">
                      <td className="py-3 pr-3"><Link href={`/runs/${r.id}`} className="font-medium text-ink-900 hover:text-brand">{r.run_key}</Link><div className="text-xs text-ink-500">{timeAgo(r.started_at)} · {r.trigger}</div></td>
                      <td className="px-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span></td>
                      <td className="px-3 tabular-nums">{r.vcs_total}</td>
                      <td className="px-3 tabular-nums">{r.vcs_signal_found} found · {r.signals_qualified} new</td>
                      <td className="px-3 tabular-nums">{r.vcs_quiet} / {r.vcs_partial} / {r.vcs_failed}</td>
                      <td className="px-3 tabular-nums">{r.llm_calls}</td>
                      <td className="px-3">{r.status === "RUNNING" ? "–" : r.founder_data_intact === true ? "✅ intact" : r.founder_data_intact === false ? "❌ changed" : "⚠ edited during run"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
