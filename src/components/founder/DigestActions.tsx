"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Founder buttons for digests: "Build preview" or "Send now" (to the configured recipient only; idempotent). */
export function DigestActions({ runId, canSend = true, label }: { runId?: string; canSend?: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (send: boolean) => {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/founder/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, send }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; status?: string; alreadySent?: boolean; digestId?: string };
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? "Could not do that");
    setMsg(j.alreadySent ? "Already sent: it will not be sent twice." : j.status === "SENT" ? "Sent. Check your inbox (and spam)." : j.status === "FAILED" ? "Not delivered. See the reason in the list below." : j.status === "PREVIEW" ? "Preview created below (not emailed)." : `Status: ${j.status}`);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => go(false)} className="min-h-[44px] rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 hover:border-brand disabled:opacity-50">{label ?? "Preview email"}</button>
      {canSend && <button type="button" disabled={busy} onClick={() => go(true)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"><Send size={15} aria-hidden="true" />Email it to me</button>}
      {msg && <span role="status" className="text-sm text-ink-700">{msg}</span>}
    </div>
  );
}
