"use client";

import { Download, LayoutGrid, Rows3, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ActionChip, ACTION_STYLE } from "@/components/ui/chips";
import { ScoreRing } from "@/components/ui/ScoreRing";

export interface PipelineRow {
  slug: string;
  firm: string;
  name: string;
  action: string;
  holdReason: string | null;
  score: number | null;
  lastSignalDate: string | null;
  whyNow: string | null;
  contactStatus: string;
  lastContactDate: string | null;
  region: string | null;
  assessmentStatus: string;
}

const STATUS_LABEL: Record<string, string> = {
  TO_REACH_OUT: "To reach out", WAITING_FOR_RESPONSE: "Waiting", IN_CONVERSATION: "In conversation", MEETING_SCHEDULED: "Meeting scheduled", PASSED: "Passed",
};
const ACTION_ORDER = ["REACH_OUT_NOW", "FOLLOW_UP_NOW", "MONITOR", "HOLD", "DONT_PRIORITIZE", "ASSESSMENT_INCOMPLETE", "NOT_ASSESSED"];

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection (cells starting with = + - @) as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: PipelineRow[]): string {
  const head = ["Firm", "Contact", "Action", "Hold reason", "Score", "Last signal", "Why now", "Contact status", "Last contact", "Region", "Assessment"];
  const lines = rows.map((r) => [r.firm, r.name, r.action, r.holdReason, r.score, r.lastSignalDate, r.whyNow, r.contactStatus, r.lastContactDate, r.region, r.assessmentStatus].map(csvEscape).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function PipelineBrowser({ rows, initial }: { rows: PipelineRow[]; initial: { action?: string; status?: string } }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [action, setAction] = useState(initial.action ?? "");
  const [status, setStatus] = useState(initial.status ?? "");
  const [region, setRegion] = useState("");
  const [onlySignal, setOnlySignal] = useState(false);
  const [sort, setSort] = useState<"action" | "score" | "firm" | "signal">("action");
  const [view, setView] = useState<"table" | "board">("table");

  const regions = useMemo(() => [...new Set(rows.map((r) => r.region).filter((x): x is string => !!x))].sort(), [rows]);
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = rows.filter((r) =>
      (!ql || r.firm.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql)) &&
      (!action || r.action === action) &&
      (!status || (status === "QUIET" ? r.assessmentStatus === "QUIET" : r.contactStatus === status)) &&
      (!region || r.region === region) &&
      (!onlySignal || r.score !== null),
    );
    out.sort((a, b) => {
      if (sort === "firm") return a.firm.localeCompare(b.firm);
      if (sort === "score") return (b.score ?? -1) - (a.score ?? -1);
      if (sort === "signal") return (b.lastSignalDate ?? "").localeCompare(a.lastSignalDate ?? "");
      return ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || (b.score ?? -1) - (a.score ?? -1) || a.firm.localeCompare(b.firm);
    });
    return out;
  }, [rows, q, action, status, region, onlySignal, sort]);

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pipeline.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sel = "min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-1 space-y-3 rounded-2xl bg-surface/95 p-1 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search investors</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search firm or person" className={`${sel} w-full pl-9`} />
          </label>
          <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className={sel}>
            <option value="">All actions</option>
            {ACTION_ORDER.map((a) => <option key={a} value={a}>{ACTION_STYLE[a]?.label}</option>)}
          </select>
          <select aria-label="Contact status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            <option value="">Any contact status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="QUIET">Quiet investors</option>
          </select>
          <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)} className={sel}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-700">
            <label className="inline-flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={onlySignal} onChange={(e) => setOnlySignal(e.target.checked)} /> Has a signal</label>
            <label className="inline-flex items-center gap-2">Sort
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={sel}>
                <option value="action">Action, then score</option><option value="score">Score</option><option value="signal">Last signal</option><option value="firm">Firm A–Z</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-ink-500">{filtered.length} of {rows.length}</span>
            <div className="inline-flex overflow-hidden rounded-xl border border-line" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} className={`grid h-11 w-11 place-items-center ${view === "table" ? "bg-brand text-white" : "bg-white text-ink-700"}`} title="Table"><Rows3 size={17} aria-hidden="true" /><span className="sr-only">Table</span></button>
              <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")} className={`grid h-11 w-11 place-items-center ${view === "board" ? "bg-brand text-white" : "bg-white text-ink-700"}`} title="Board"><LayoutGrid size={17} aria-hidden="true" /><span className="sr-only">Board</span></button>
            </div>
            <button type="button" onClick={download} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink-700 hover:border-brand hover:text-brand"><Download size={15} aria-hidden="true" />CSV</button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl bg-bg p-8 text-center text-sm text-ink-500">No investors match these filters.</p>
      ) : view === "table" ? (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="sticky top-0 bg-bg text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Investor</th>
                <th scope="col" className="px-3 py-3 font-semibold">Action</th>
                <th scope="col" className="px-3 py-3 text-center font-semibold">Score</th>
                <th scope="col" className="px-3 py-3 font-semibold">Last signal</th>
                <th scope="col" className="px-3 py-3 font-semibold">Contact status</th>
                <th scope="col" className="px-3 py-3 font-semibold">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.slug} onClick={() => router.push(`/vc/${r.slug}`)} className="cursor-pointer border-t border-line align-middle hover:bg-bg/60">
                  <td className="px-4 py-3">
                    <Link href={`/vc/${r.slug}`} className="font-medium text-ink-900 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">{r.firm}</Link>
                    <div className="text-ink-500">{r.name}{r.region ? ` · ${r.region}` : ""}</div>
                  </td>
                  <td className="px-3 py-3"><ActionChip action={r.action} holdReason={r.holdReason} /></td>
                  <td className="px-3 py-3 text-center"><span className="inline-block"><ScoreRing score={r.score} size={40} /></span></td>
                  <td className="px-3 py-3 tabular-nums text-ink-700">{r.lastSignalDate ?? "none"}</td>
                  <td className="px-3 py-3 text-ink-700">{STATUS_LABEL[r.contactStatus] ?? r.contactStatus}</td>
                  <td className="px-3 py-3 tabular-nums text-ink-700">{r.lastContactDate ?? "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ACTION_ORDER.filter((a) => filtered.some((r) => r.action === a)).map((a) => {
            const col = filtered.filter((r) => r.action === a);
            return (
              <section key={a} className="w-[280px] shrink-0 rounded-2xl bg-bg p-3" aria-label={ACTION_STYLE[a]?.label}>
                <div className="mb-2 flex items-center justify-between"><ActionChip action={a} /><span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-700">{col.length}</span></div>
                <div className="space-y-2">
                  {col.map((r) => (
                    <Link key={r.slug} href={`/vc/${r.slug}`} className="block rounded-xl bg-white p-3 shadow-sm hover:shadow-md">
                      <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-ink-900">{r.firm}</span><ScoreRing score={r.score} size={36} /></div>
                      <p className="mt-1 line-clamp-1 text-xs text-ink-500">{r.whyNow ?? "No recent signal"}</p>
                      <p className="mt-1 text-xs tabular-nums text-ink-500">Last signal: {r.lastSignalDate ?? "none"}</p>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
