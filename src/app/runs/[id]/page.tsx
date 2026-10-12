import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle, Stat } from "@/components/ui/cards";
import { pageTitle } from "@/config/brand";
import { getRunDetail } from "@/lib/db/readDb";
import { RUN_STATUS } from "@/components/ui/runStatus";

export const metadata: Metadata = { title: pageTitle("Run") };
export const dynamic = "force-dynamic";

const CODE_TEXT: Record<string, string> = {
  FETCH_FAILED: "page could not be fetched (blocked, paywalled or empty)", SSRF_BLOCKED: "address is not allowed (safety rule)", DATE_UNVERIFIED: "no trustworthy publication date",
  OLD_EVENT: "older than 30 days", FUTURE_DATE: "dated in the future", AMBIGUOUS_ENTITY: "name could mean something else", NOT_ATTRIBUTABLE: "investor not clearly the actor",
  QUOTE_NOT_FOUND: "quote not found in the page", IRRELEVANT: "not relevant to logistics or B2B software", DUPLICATE_SYNDICATED: "same story already counted", INVALID_MODEL_OUTPUT: "AI output failed validation",
  LANGUAGE_UNSUPPORTED: "not English", DATE_INCOHERENT: "dates do not add up", SYNTHETIC: "synthetic data",
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d;
  try {
    d = await getRunDetail(id);
  } catch (e) {
    console.error("[run page]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  if (!d) notFound();
  const { run, tasks, rejected, llm, sources } = d;
  const st = RUN_STATUS[run.status] ?? { label: run.status, cls: "bg-gray-100 text-gray-600" };
  const byCode = new Map<string, number>();
  rejected.forEach((r) => byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1));
  const CH: Record<string, string> = { A: "official", B: "news", C: "sector", D: "grounded" };
  const chSym = (v: unknown) => (v === "ok" ? "✓" : v === "fail" ? "✗" : v === "none" ? "–" : "·");

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <Link href="/runs" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand"><ArrowLeft size={15} aria-hidden="true" />Runs</Link>
      <header>
        <h1 className="font-display text-[26px] font-bold text-ink-900 sm:text-[30px]">{run.run_key}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>trigger: {run.trigger} · window {run.window_start} → {run.window_end} · scoring {run.scoring_version} · model {run.model_primary}</p>
      </header>

      <Card>
        <CardTitle>Summary</CardTitle>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Investors checked" value={run.vcs_total} />
          <Stat label="With a signal" value={run.vcs_signal_found} />
          <Stat label="Quiet (fully checked)" value={run.vcs_quiet} />
          <Stat label="Incomplete / failed" value={`${run.vcs_partial} / ${run.vcs_failed}`} />
          <Stat label="Candidates found" value={run.candidates_found} />
          <Stat label="New signals" value={run.signals_qualified} />
          <Stat label="AI calls (all Gemini)" value={`${run.llm_calls} · ${run.llm_tokens_in.toLocaleString()} in / ${run.llm_tokens_out.toLocaleString()} out`} />
          <Stat label="Errors" value={run.error_count} />
        </dl>
      </Card>

      <Card>
        <CardTitle>Integrity receipt</CardTitle>
        <p className="text-sm text-ink-700">
          {run.status === "RUNNING" ? "Receipt is written when the run finishes." : run.founder_data_intact === true ? "✅ Your notes, contact history and other founder-owned data were byte-identical before and after this run." : run.founder_data_intact === false ? "❌ Founder-owned data changed during this run. This should be impossible: investigate." : "⚠ You edited your own data while this run was in progress, so a before/after comparison does not apply."}
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat label="Fingerprint before" value={<code className="break-all text-xs">{run.founder_hash_before ?? "–"}</code>} />
          <Stat label="Fingerprint after" value={<code className="break-all text-xs">{run.founder_hash_after ?? "–"}</code>} />
        </dl>
      </Card>

      <Card>
        <CardTitle aside={<span className="text-xs text-ink-500">✓ ok · ✗ failed · – none exists · · skipped</span>}>Per-investor results</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-semibold">Investor</th><th className="px-3 font-semibold">Result</th><th className="px-3 font-semibold">Sources</th><th className="px-3 font-semibold">Pages ok / failed</th><th className="px-3 font-semibold">New signals</th></tr></thead>
            <tbody>
              {tasks.map((t) => {
                const s = t.stats as { assessment?: string; channels?: Record<string, string>; candidates?: { fetched_ok?: number; fetch_failed?: number }; new_signals?: number; action?: string };
                return (
                  <tr key={t.slug} className="border-t border-line">
                    <td className="py-2 pr-3"><Link href={`/vc/${t.slug}`} className="font-medium text-ink-900 hover:text-brand">{t.firm}</Link></td>
                    <td className="px-3">{t.status === "FAILED" && !s.assessment ? <span className="text-red-700">failed: {t.error}</span> : `${s.assessment ?? t.status}${s.action ? ` · ${s.action.replaceAll("_", " ").toLowerCase()}` : ""}`}</td>
                    <td className="px-3 font-mono text-xs">{s.channels ? Object.entries(s.channels).map(([k, v]) => `${CH[k]} ${chSym(v)}`).join("  ") : "–"}</td>
                    <td className="px-3 tabular-nums">{s.candidates ? `${s.candidates.fetched_ok ?? 0} / ${s.candidates.fetch_failed ?? 0}` : "–"}</td>
                    <td className="px-3 tabular-nums">{s.new_signals ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle aside={<span className="text-xs text-ink-500">why we ignored things</span>}>Rejected evidence ({rejected.length})</CardTitle>
        {rejected.length === 0 ? <p className="text-sm text-ink-500">Nothing was rejected in this run.</p> : (
          <>
            <p className="mb-3 flex flex-wrap gap-2 text-xs">{[...byCode].map(([c, n]) => <span key={c} className="rounded-full bg-bg px-2.5 py-1 text-ink-700"><strong className="tabular-nums">{n}</strong> {CODE_TEXT[c] ?? c}</span>)}</p>
            <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="sticky top-0 bg-bg text-ink-500"><tr><th className="px-3 py-2 font-semibold">Investor</th><th className="px-3 font-semibold">Reason</th><th className="px-3 font-semibold">Page</th></tr></thead>
                <tbody>
                  {rejected.map((r, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="px-3 py-2">{r.firm}</td>
                      <td className="px-3 py-2"><code className="text-xs">{r.code}</code><div className="text-xs text-ink-500">{CODE_TEXT[r.code] ?? ""}</div></td>
                      <td className="max-w-[360px] px-3 py-2"><a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{r.title ?? r.domain ?? r.url}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Source health (sector feeds)</CardTitle>
          {sources.length === 0 ? <p className="text-sm text-ink-500">No feeds recorded.</p> : (
            <ul className="divide-y divide-line text-sm">
              {sources.map((s) => (
                <li key={s.url} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate">{s.label ?? s.url}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "OK" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-800"}`}>{s.status}{s.http ? ` · ${s.http}` : ""}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>AI ledger (proves Gemini only)</CardTitle>
          {llm.length === 0 ? <p className="text-sm text-ink-500">No AI calls in this run.</p> : (
            <table className="w-full text-left text-[13px]">
              <thead className="text-ink-500"><tr><th className="py-1 pr-2 font-semibold">Model</th><th className="font-semibold">Purpose</th><th className="font-semibold">Status</th><th className="text-right font-semibold">Calls</th><th className="text-right font-semibold">Tokens</th></tr></thead>
              <tbody>{llm.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1.5 pr-2 font-mono text-xs">{l.model}</td><td>{l.purpose}</td><td>{l.status}</td><td className="text-right tabular-nums">{l.calls}</td><td className="text-right tabular-nums">{(l.tin + l.tout).toLocaleString()}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
