"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const OUTCOMES = [["RESPONSE_RECEIVED", "They replied"], ["MEETING_BOOKED", "Meeting booked"], ["PASSED", "They passed"], ["NO_RESPONSE", "No response"]] as const;

/** Log what actually happened after you reached out. Stored separately from thumbs feedback. */
export function OutcomeForm({ vcId, recommendationId }: { vcId: string; recommendationId: string | null }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string>("RESPONSE_RECEIVED");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/founder/outcome", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vcId, recommendationId: recommendationId ?? undefined, outcome, occurredOn: on, note: note || undefined }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setMsg(r.ok ? "Outcome logged." : (j.error ?? "Could not save"));
    if (r.ok) {
      setNote("");
      router.refresh();
    }
  };
  const field = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm";
  return (
    <form onSubmit={save} className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/50 p-4">
      <h3 className="text-sm font-semibold text-ink-900">Log an outcome</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-ink-700">What happened<select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field}>{OUTCOMES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block text-xs font-medium text-ink-700">Date<input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={field} /></label>
      </div>
      <label className="block text-xs font-medium text-ink-700">Note (optional)<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={field} /></label>
      <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl border border-brand px-4 text-sm font-semibold text-brand disabled:opacity-50">Save outcome</button>
      {msg && <p role="status" className="text-xs text-ink-700">{msg}</p>}
    </form>
  );
}
