"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  company_name: string; product_description: string; sector: string; stage: string; geography: string | null; icp: string | null; relevance_keywords: string[];
}

/** Company profile: read-only view with an Edit button; pressing it swaps the same card into the form (Cancel/Save swaps back). */
export function CompanyPanel(p: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ ...p, geography: p.geography ?? "", icp: p.icp ?? "", keywords: p.relevance_keywords.join(", ") });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/founder/company", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company_name: f.company_name, product_description: f.product_description, sector: f.sector, stage: f.stage,
        geography: f.geography || null, icp: f.icp || null, relevance_keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (r.ok) {
      setEditing(false);
      setMsg("Saved. The next run uses this profile.");
      router.refresh();
    } else setMsg(j.error ?? "Could not save");
  };
  const field = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

  if (!editing) {
    return (
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <dl className="grid flex-1 gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-ink-500">Company</dt><dd className="text-sm font-medium text-ink-900">{p.company_name}</dd></div>
            <div><dt className="text-xs text-ink-500">Sector · stage</dt><dd className="text-sm font-medium text-ink-900">{p.sector} · {p.stage}</dd></div>
            <div><dt className="text-xs text-ink-500">Geography</dt><dd className="text-sm font-medium text-ink-900">{p.geography ?? "unknown"}</dd></div>
            <div><dt className="text-xs text-ink-500">Who you sell to</dt><dd className="text-sm font-medium text-ink-900">{p.icp ?? "unknown"}</dd></div>
          </dl>
          <button type="button" onClick={() => { setMsg(null); setEditing(true); }} className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-brand hover:text-brand"><Pencil size={14} aria-hidden="true" />Edit</button>
        </div>
        <p className="text-sm text-ink-700">{p.product_description}</p>
        <p className="mt-3 text-xs text-ink-500"><span className="font-semibold">Relevance keywords:</span> {p.relevance_keywords.join(", ")}</p>
        {msg && <p role="status" className="mt-3 text-xs text-emerald-800">{msg}</p>}
      </div>
    );
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <label className="block text-xs font-medium text-ink-700">Company name<input value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} required className={field} /></label>
      <label className="block text-xs font-medium text-ink-700">What it does (used to judge relevance)<textarea value={f.product_description} onChange={(e) => setF({ ...f, product_description: e.target.value })} rows={5} required minLength={10} className={`${field} py-2`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-ink-700">Sector<input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Stage<input value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Geography (leave empty if unknown)<input value={f.geography} onChange={(e) => setF({ ...f, geography: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Who you sell to<input value={f.icp} onChange={(e) => setF({ ...f, icp: e.target.value })} className={field} /></label>
      </div>
      <label className="block text-xs font-medium text-ink-700">Relevance keywords (comma separated)<textarea value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} rows={3} className={`${field} py-2`} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Save company</button>
        <button type="button" onClick={() => { setEditing(false); setMsg(null); }} className="min-h-[44px] rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 hover:border-brand">Cancel</button>
        {msg && <p role="status" className="text-xs text-red-700">{msg}</p>}
      </div>
    </form>
  );
}
