"use client";

import { KeyRound, Play, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Msg = { kind: "ok" | "err"; text: string } | null;

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: string; [k: string]: unknown };
  return { ok: r.ok, status: r.status, j };
}

/** Founder login / Run now / Resume. The server decides who is a founder; this only reflects it. */
export function FounderMenu({ founder }: { founder: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await call("/api/founder/auth", "POST", { code });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setCode("");
      setMsg(null);
      router.refresh();
    } else setMsg({ kind: "err", text: r.j.error ?? "Login failed" });
  };
  const logout = async () => {
    await call("/api/founder/auth", "DELETE");
    router.refresh();
  };
  const run = async (resume: boolean) => {
    setBusy(true);
    const r = await call("/api/founder/run", "POST", { resume });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: r.j.resumed ? "Resuming the current run." : r.j.started ? "Run started. It takes several minutes; this page updates as it goes." : String(r.j.message ?? "Done.") } : { kind: "err", text: r.j.error ?? "Could not start" });
    router.refresh();
  };

  if (!founder) {
    return (
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink-700 hover:border-brand hover:text-brand">
          <KeyRound size={14} aria-hidden="true" />Founder login
        </button>
        {open && (
          <form onSubmit={login} className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-line bg-white p-4 shadow-xl">
            <label className="block text-xs font-semibold text-ink-700" htmlFor="founder-code">Founder passcode</label>
            <input id="founder-code" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-xl border border-line px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" />
            {msg && <p role="alert" className="mt-2 text-xs text-red-700">{msg.text}</p>}
            <button type="submit" disabled={busy || !code} className="mt-3 min-h-[44px] w-full rounded-xl bg-brand text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Unlock"}</button>
            <p className="mt-2 text-[11px] text-ink-500">Visitors can look around read-only. The passcode unlocks Run now and editing your notes.</p>
          </form>
        )}
      </div>
    );
  }
  return (
    <div className="relative flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => run(false)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-brand px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"><Play size={13} aria-hidden="true" />Run now</button>
      <button type="button" disabled={busy} onClick={() => run(true)} className="hidden min-h-[40px] items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink-700 hover:border-brand sm:inline-flex" title="Continue a run that stopped"><RotateCw size={13} aria-hidden="true" />Resume</button>
      <button type="button" onClick={logout} className="min-h-[40px] rounded-full px-2 text-xs text-ink-500 hover:text-ink-900">Log out</button>
      {msg && <p role="status" className={`absolute right-0 top-12 z-50 w-64 rounded-xl p-3 text-xs shadow-lg ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
    </div>
  );
}
