import type { Metadata } from "next";
import { pageTitle } from "@/config/brand";
import { getCompanyProfile, getOverview, listVcs } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Pipeline") };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  TO_REACH_OUT: "To reach out",
  WAITING_FOR_RESPONSE: "Waiting for response",
  IN_CONVERSATION: "In conversation",
  MEETING_SCHEDULED: "Meeting scheduled",
  PASSED: "Passed",
};

// P02: minimal read-only list. The designed pipeline table (filters, drawer, board) is built in P07.
export default async function PipelinePage() {
  let data;
  try {
    const [vcs, overview, company] = await Promise.all([listVcs(), getOverview(), getCompanyProfile()]);
    data = { vcs, overview, company };
  } catch (e) {
    console.error("[pipeline page]", (e as Error).message);
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-2xl font-bold">Pipeline</h1>
        <p className="mt-3 text-ink-500">The database could not be reached. Nothing has been changed. Please try again in a moment.</p>
      </main>
    );
  }
  const { vcs, overview, company } = data;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Pipeline</h1>
      <p className="mt-1 text-sm text-ink-500">
        {overview.total} investors · company profile: {company.profile.company_name}
        {company.isSample && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">sample</span>
        )}
      </p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
        DEMO relationship data: contact status, dates and notes below are synthetic
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="bg-bg text-ink-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Firm</th>
              <th className="px-4 py-3 font-semibold">Thesis</th>
              <th className="px-4 py-3 font-semibold">Contact status</th>
              <th className="px-4 py-3 font-semibold">Last contact</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {vcs.map((v) => (
              <tr key={v.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">{v.firm}</div>
                  <div className="text-ink-500">{v.name}</div>
                </td>
                <td className="max-w-xs px-4 py-3 text-ink-700">{v.thesis ?? "unknown"}</td>
                <td className="px-4 py-3 text-ink-700">{STATUS_LABEL[v.contact_status] ?? v.contact_status}</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{v.last_contact_date ?? "none"}</td>
                <td className="max-w-xs px-4 py-3 text-ink-700">{v.personal_notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
