"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Retry controls for one run: continue a stopped run, or start a fresh run when some investors could not be checked. */
export function RunActions({ running, hasProblems }: { running: boolean; hasProblems: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!running && !hasProblems) return null;
  const go = async (resume: boolean) => {
    setBusy(true);
    const r = await fetch("/api/founder/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resume }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; resumed?: boolean };
    setBusy(false);
    setMsg(r.ok ? (j.resumed ? "Continuing this run." : "A new run has started.") : j.error ?? "Could not start");
    router.refresh();
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => go(running)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 hover:border-brand hover:text-brand disabled:opacity-50">
        <RotateCw size={15} aria-hidden="true" />{running ? "Resume this run" : "Retry (start a new run)"}
      </button>
      <span className="text-xs text-ink-500">{running ? "Use this if the run looks stuck." : "Some investors could not be fully checked. A new run tries them again."}</span>
      {msg && <span role="status" className="text-xs text-ink-700">{msg}</span>}
    </div>
  );
}
