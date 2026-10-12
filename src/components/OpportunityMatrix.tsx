import Link from "next/link";
import { ACTION_STYLE } from "@/components/ui/chips";
import type { ActionCardData } from "@/lib/db/readDb";

/**
 * Opportunity map: how well each fund fits you (across) against how strong their recent activity is (up).
 * Pure SVG. Investors with no recent signal have no score and are not plotted (never drawn as 0).
 * Every dot links to the investor; the same data is also available as a plain list.
 */
export function OpportunityMatrix({ cards }: { cards: ActionCardData[] }) {
  const pts = cards.filter((c) => c.score !== null && c.fitScore !== null);
  const unplotted = cards.length - pts.length;
  const W = 640, H = 340, L = 50, B = 44, T = 14, R = 14;
  const x = (v: number) => L + (v / 10) * (W - L - R);
  const y = (v: number) => H - B - (v / 100) * (H - B - T);
  const jitter = (s: string) => ((s.charCodeAt(0) + s.length * 7) % 9) - 4;
  const midX = x(5), midY = y(50);
  return (
    <div>
      <div className="mb-3 grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
        <p><strong className="text-ink-900">Across:</strong> how well the fund fits FreightLoop (their stage, sectors and region). Further right is a better fit.</p>
        <p><strong className="text-ink-900">Up:</strong> how strong their recent activity is (score out of 100). Higher means something fresh and relevant just happened.</p>
      </div>
      {pts.length === 0 ? (
        <p className="py-4 text-sm text-ink-500">No investor has both a score and a fit value yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart of fund fit (across) against recent-activity score (up), one dot per investor" className="w-full rounded-2xl bg-gradient-to-br from-slate-50 to-white">
            <defs>
              <linearGradient id="best" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FDBA74" stopOpacity=".35" /><stop offset="1" stopColor="#F97316" stopOpacity=".18" /></linearGradient>
            </defs>
            <rect x={midX} y={T} width={W - R - midX} height={midY - T} rx="10" fill="url(#best)" />
            <text x={W - R - 10} y={T + 20} textAnchor="end" fontSize="13" fontWeight="700" fill="#9A3412">Best bets</text>
            <text x={L + 10} y={T + 20} fontSize="12" fontWeight="600" fill="#64748B">Active, but not your kind of fund</text>
            <text x={W - R - 10} y={H - B - 10} textAnchor="end" fontSize="12" fontWeight="600" fill="#64748B">Right fund, quiet for now</text>
            <text x={L + 10} y={H - B - 10} fontSize="12" fontWeight="600" fill="#94A3B8">Skip for now</text>
            {[0, 25, 50, 75, 100].map((g) => (
              <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke={g === 50 ? "#CBD5E1" : "var(--line)"} strokeDasharray={g === 50 ? "5 4" : undefined} /><text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--ink-500)">{g}</text></g>
            ))}
            {[0, 2, 4, 5, 6, 8, 10].map((g) => (
              <g key={g}><line x1={x(g)} x2={x(g)} y1={T} y2={H - B} stroke={g === 5 ? "#CBD5E1" : "var(--line)"} strokeDasharray={g === 5 ? "5 4" : "2 4"} /><text x={x(g)} y={H - B + 15} textAnchor="middle" fontSize="11" fill="var(--ink-500)">{g}</text></g>
            ))}
            <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-700)">Fund fit with FreightLoop (0 to 10)</text>
            <text transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-700)">Recent activity score (0 to 100)</text>
            {pts.map((c, i) => {
              const s = ACTION_STYLE[c.action] ?? ACTION_STYLE.NOT_ASSESSED!;
              const best = c.action === "REACH_OUT_NOW";
              return (
                <Link key={c.slug} href={`/vc/${c.slug}`}>
                  <circle className="rr-fade" style={{ ["--d" as string]: `${i * 25}ms`, cursor: "pointer" }} cx={x(c.fitScore!) + jitter(c.slug)} cy={y(c.score!)} r={best ? 10 : 7.5} fill={s.dot} fillOpacity="0.9" stroke="#fff" strokeWidth="2">
                    <title>{`${c.firm}: score ${c.score}, fit ${c.fitScore}, ${s.label}`}</title>
                  </circle>
                </Link>
              );
            })}
          </svg>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label="Colour key">
            {Object.entries(ACTION_STYLE).filter(([k]) => k !== "NOT_ASSESSED").map(([k, s]) => <li key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />{s.label}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink-500">Each dot is one investor; click it to open them. {unplotted > 0 ? `${unplotted} investors with no recent signal are not drawn (they have no score).` : ""}</p>
          <details className="mt-2 text-sm text-ink-700"><summary className="cursor-pointer text-ink-500">Show as a list ({pts.length} investors)</summary>
            <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">{[...pts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((c) => <li key={c.slug}><Link className="hover:text-brand" href={`/vc/${c.slug}`}>{c.firm}</Link>: score {c.score}, fit {c.fitScore}</li>)}</ul>
          </details>
        </>
      )}
    </div>
  );
}
