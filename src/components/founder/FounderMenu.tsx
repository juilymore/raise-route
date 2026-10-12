"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Msg = { kind: "ok" | "err"; text: string } | null;

/** Run now / Resume. No login: anyone using the app can start a scan. */
export function FounderMenu() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const run = async (resume: boolean) => {
    setBusy(true);
    const r = await fetch("/api/founder/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resume }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; resumed?: boolean; started?: boolean; message?: string };
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: j.resumed ? "Resuming the current run." : j.started ? "Run started. It takes several minutes; this page updates as it goes." : String(j.message ?? "Done.") } : { kind: "err", text: j.error ?? "Could not start" });
    router.refresh();
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => run(false)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-brand-ink shadow-[0_2px_12px_rgba(0,0,0,.18)] transition hover:scale-[1.04] disabled:opacity-50"><Play size={13} aria-hidden="true" />Run now</button>
      {msg && <p role="status" className={`absolute right-0 top-12 z-50 w-64 rounded-xl p-3 text-xs shadow-lg ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
    </div>
  );
}
