"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  company_name: string; product_description: string; sector: string; stage: string; geography: string | null; icp: string | null; relevance_keywords: string[];
}

/** Founder-only company profile editor (Settings). */
export function CompanyEditor(p: Props) {
  const router = useRouter();
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
    setMsg(r.ok ? "Saved. The next run uses this profile." : j.error ?? "Could not save");
    if (r.ok) router.refresh();
  };
  const field = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
  return (
    <form onSubmit={save} className="mt-4 space-y-3 rounded-2xl border border-line bg-bg p-4">
      <label className="block text-xs font-medium text-ink-700">Company name<input value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} required className={field} /></label>
      <label className="block text-xs font-medium text-ink-700">What it does (used to judge relevance)<textarea value={f.product_description} onChange={(e) => setF({ ...f, product_description: e.target.value })} rows={4} required minLength={10} className={`${field} py-2`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-ink-700">Sector<input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Stage<input value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Geography (leave empty if unknown)<input value={f.geography} onChange={(e) => setF({ ...f, geography: e.target.value })} className={field} /></label>
        <label className="block text-xs font-medium text-ink-700">Who you sell to<input value={f.icp} onChange={(e) => setF({ ...f, icp: e.target.value })} className={field} /></label>
      </div>
      <label className="block text-xs font-medium text-ink-700">Relevance keywords (comma separated)<textarea value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} rows={2} className={`${field} py-2`} /></label>
      <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Save company</button>
      {msg && <p role="status" className="text-xs text-ink-700">{msg}</p>}
    </form>
  );
}
