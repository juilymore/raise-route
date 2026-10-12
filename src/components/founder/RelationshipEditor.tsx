"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = [
  ["TO_REACH_OUT", "To reach out"], ["WAITING_FOR_RESPONSE", "Waiting for response"], ["IN_CONVERSATION", "In conversation"], ["MEETING_SCHEDULED", "Meeting scheduled"], ["PASSED", "Passed"],
] as const;
const EVENT_TYPES = [["email_sent", "Email sent"], ["follow_up_sent", "Follow-up sent"], ["call", "Call"], ["meeting", "Meeting"], ["email_received", "Reply received"], ["note", "Note"]] as const;

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: r.ok, error: j.error };
}

/** Founder-only editor for relationship data. Rendered only for a logged-in founder; the API enforces it again. */
export function RelationshipEditor({ vcId, status, lastContact, reconnectAfter, notes }: { vcId: string; status: string; lastContact: string | null; reconnectAfter: string | null; notes: string | null }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [last, setLast] = useState(lastContact ?? "");
  const [rc, setRc] = useState(reconnectAfter ?? "");
  const [n, setN] = useState(notes ?? "");
  const [ev, setEv] = useState({ at: new Date().toISOString().slice(0, 10), type: "email_sent", summary: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send(`/api/founder/vc/${vcId}`, "PATCH", { contact_status: s, last_contact_date: last || null, reconnect_after: rc || null, personal_notes: n || null });
    setBusy(false);
    setMsg(r.ok ? "Saved." : r.error ?? "Could not save");
    if (r.ok) router.refresh();
  };
  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send(`/api/founder/vc/${vcId}/event`, "POST", ev);
    setBusy(false);
    setMsg(r.ok ? "Contact event added." : r.error ?? "Could not add");
    if (r.ok) {
      setEv({ ...ev, summary: "" });
      router.refresh();
    }
  };
  const field = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-amber-300 bg-amber-50/50 p-4">
      <form onSubmit={save} className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">Edit relationship</h3>
        <label className="block text-xs font-medium text-ink-700">Status
          <select value={s} onChange={(e) => setS(e.target.value)} className={field}>{STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-ink-700">Last contact<input type="date" value={last} onChange={(e) => setLast(e.target.value)} className={field} /></label>
          <label className="block text-xs font-medium text-ink-700">Reconnect after<input type="date" value={rc} onChange={(e) => setRc(e.target.value)} className={field} /></label>
        </div>
        <label className="block text-xs font-medium text-ink-700">Your notes<textarea value={n} onChange={(e) => setN(e.target.value)} rows={3} maxLength={5000} className={`${field} py-2`} /></label>
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Save changes</button>
      </form>
      <form onSubmit={addEvent} className="space-y-3 border-t border-amber-200 pt-4">
        <h3 className="text-sm font-semibold text-ink-900">Log a contact</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-ink-700">Date<input type="date" required value={ev.at} onChange={(e) => setEv({ ...ev, at: e.target.value })} className={field} /></label>
          <label className="block text-xs font-medium text-ink-700">Type<select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })} className={field}>{EVENT_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="block text-xs font-medium text-ink-700">What happened<input required maxLength={500} value={ev.summary} onChange={(e) => setEv({ ...ev, summary: e.target.value })} className={field} /></label>
        <button type="submit" disabled={busy || !ev.summary} className="min-h-[44px] rounded-xl border border-brand px-4 text-sm font-semibold text-brand disabled:opacity-50">Add to history</button>
      </form>
      {msg && <p role="status" className="text-xs text-ink-700">{msg}</p>}
    </div>
  );
}
