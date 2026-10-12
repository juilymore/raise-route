"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupRows } from "@/lib/config/effective";

/** The scoring rubric as editable tables. Code applies these numbers; Gemini never sees or changes them. Takes effect on the next run. */
export function ScoringEditor({ groups, version, edited }: { groups: GroupRows[]; version: string; edited: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(groups.flatMap((g) => g.rows.map((r) => [r.path, String(r.value)]))));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pointsTotal = (groups.find((g) => g.key === "max_points")?.rows ?? []).reduce((a, r) => a + (Number(vals[r.path]) || 0), 0);

  const save = async () => {
    const values: Record<string, number> = {};
    for (const g of groups) {
      for (const r of g.rows) {
        const raw = (vals[r.path] ?? "").trim();
        const n = Number(raw);
        if (raw === "" || !Number.isFinite(n)) return setMsg({ ok: false, text: `"${r.label}" needs a number.` });
        if (n !== r.base) values[r.path] = n;
      }
    }
    setBusy(true);
    const res = await fetch("/api/founder/scoring", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ values }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; version?: string };
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: `Saved as ${j.version}. The next run uses these numbers.` } : { ok: false, text: j.error ?? "Could not save" });
    if (res.ok) router.refresh();
  };
  const reset = async () => {
    setBusy(true);
    const res = await fetch("/api/founder/scoring", { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setVals(Object.fromEntries(groups.flatMap((g) => g.rows.map((r) => [r.path, String(r.base)]))));
      setMsg({ ok: true, text: "Back to the default rubric. The next run uses it." });
      router.refresh();
    } else setMsg({ ok: false, text: "Could not reset" });
  };

  const cell = "w-24 min-h-[36px] rounded-lg border border-line bg-white px-2 text-right text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-700">
        Each investor&apos;s score is 100 points made of the factors below. These numbers are applied by code, not by AI. Change a number and press Save; the next run uses it.
        Rubric in use: <strong>{version}</strong>{edited ? " (edited)" : " (default)"}.
      </p>
      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key}>
          <h3 className="font-display text-base font-semibold text-ink-900">
            {g.title}
            {g.key === "max_points" && <span className={`ml-2 text-xs font-medium ${pointsTotal === 100 ? "text-emerald-700" : "text-red-700"}`}>total {pointsTotal} / 100</span>}
          </h3>
          <p className="text-xs text-ink-500">{g.hint}</p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead className="bg-bg text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Item</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Default</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Your value</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const changed = Number(vals[r.path]) !== r.base;
                  return (
                    <tr key={r.path} className="border-t border-line">
                      <td className="px-3 py-1.5 capitalize text-ink-900">{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink-500">{r.base}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input aria-label={`${g.title}: ${r.label}`} inputMode="decimal" value={vals[r.path]} onChange={(e) => setVals({ ...vals, [r.path]: e.target.value })} className={`${cell} ${changed ? "border-brand bg-brand/5" : ""}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="min-h-[44px] rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Save rubric</button>
        <button type="button" disabled={busy} onClick={reset} className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold text-ink-700 hover:border-brand disabled:opacity-50">Reset to default</button>
        {msg && <p role="status" className={`text-xs ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
