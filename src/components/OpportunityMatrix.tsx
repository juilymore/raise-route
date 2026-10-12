import Link from "next/link";
import { ACTION_STYLE } from "@/components/ui/chips";
import type { ActionCardData } from "@/lib/db/readDb";

/**
 * Opportunity Matrix: x = stable fund fit (0-10), y = follow-up score (0-100), colour = action.
 * Pure SVG (no chart library). Investors with no qualifying signal have no score and are not plotted (never as 0).
 * Every point is also a link, and the same data is available as a plain list for screen readers.
 */
export function OpportunityMatrix({ cards }: { cards: ActionCardData[] }) {
  const pts = cards.filter((c) => c.score !== null && c.fitScore !== null);
  const W = 560, H = 300, L = 44, B = 36, T = 12, R = 12;
  const x = (v: number) => L + (v / 10) * (W - L - R);
  const y = (v: number) => H - B - (v / 100) * (H - B - T);
  const jitter = (s: string) => ((s.charCodeAt(0) + s.length * 7) % 9) - 4;
  return (
    <div>
      {pts.length === 0 ? (
        <p className="py-4 text-sm text-ink-500">No investor has both a score and a fit value yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter chart of fund fit against follow-up score" className="w-full">
            {[0, 25, 50, 75, 100].map((g) => (
              <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" /><text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="var(--ink-500)">{g}</text></g>
            ))}
            {[0, 2, 4, 6, 8, 10].map((g) => (
              <g key={g}><line x1={x(g)} x2={x(g)} y1={T} y2={H - B} stroke="var(--line)" strokeDasharray="2 4" /><text x={x(g)} y={H - B + 14} textAnchor="middle" fontSize="10" fill="var(--ink-500)">{g}</text></g>
            ))}
            <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--ink-700)">Fund fit (stage, sector, region), 0–10</text>
            <text transform={`translate(11 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="var(--ink-700)">Follow-up score, 0–100</text>
            {pts.map((c) => {
              const s = ACTION_STYLE[c.action] ?? ACTION_STYLE.NOT_ASSESSED!;
              return (
                <Link key={c.slug} href={`/vc/${c.slug}`}>
                  <circle cx={x(c.fitScore!) + jitter(c.slug)} cy={y(c.score!)} r={c.action === "REACH_OUT_NOW" ? 9 : 7} fill={s.dot} fillOpacity="0.75" stroke="#fff" strokeWidth="1.5">
                    <title>{`${c.firm}: score ${c.score}, fit ${c.fitScore}, ${s.label}`}</title>
                  </circle>
                </Link>
              );
            })}
          </svg>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label="Legend">
            {Object.entries(ACTION_STYLE).filter(([k]) => k !== "NOT_ASSESSED").map(([k, s]) => <li key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />{s.label}</li>)}
          </ul>
          <details className="mt-2 text-sm text-ink-700"><summary className="cursor-pointer text-ink-500">Data as a list ({pts.length} investors)</summary>
            <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">{pts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((c) => <li key={c.slug}><Link className="hover:text-brand" href={`/vc/${c.slug}`}>{c.firm}</Link>: score {c.score}, fit {c.fitScore}</li>)}</ul>
          </details>
        </>
      )}
    </div>
  );
}
