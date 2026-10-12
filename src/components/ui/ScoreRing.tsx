/** Circular score gauge. null = no qualifying signal: shown as an empty ring with a dash, never as 0. */
export function ScoreRing({ score, size = 52, color = "var(--brand)" }: { score: number | null; size?: number; color?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }} aria-label={score === null ? "No score: no qualifying signal" : `Score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        {score !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="rr-ring" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />}
      </svg>
      <span className="absolute font-display text-[15px] font-bold tabular-nums text-ink-900">{score === null ? "–" : score}</span>
    </span>
  );
}
