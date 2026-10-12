/** A truck driving from one place to another along a dotted road. Pure CSS/SVG, no client JS. Used for loading and for a run in progress. */
export function Truck({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="56" height="32" viewBox="0 0 56 32" aria-hidden="true">
      <g className="rr-truck-body">
        <rect x="1" y="3" width="33" height="19" rx="3" fill="var(--brand)" />
        <rect x="4" y="7" width="12" height="3" rx="1.5" fill="#fff" opacity=".55" />
        <path d="M36 9h9l8 7v6H36z" fill="var(--accent)" />
        <path d="M40 11.5h4.5l4 4H40z" fill="#fff" opacity=".85" />
      </g>
      <rect x="0" y="22" width="54" height="2" rx="1" fill="var(--brand-ink)" opacity=".25" />
      <g>
        <circle cx="12" cy="25" r="4.2" fill="#0e1f2b" />
        <circle className="rr-wheel" cx="12" cy="25" r="1.7" fill="#fff" />
        <circle cx="44" cy="25" r="4.2" fill="#0e1f2b" />
        <circle className="rr-wheel" cx="44" cy="25" r="1.7" fill="#fff" />
      </g>
    </svg>
  );
}

function Pin({ x, label, color }: { x: number; label: string; color: string }) {
  return (
    <g className="rr-pin" style={{ animationDelay: x > 100 ? ".6s" : "0s" }}>
      <path d={`M${x} 6c-5 0-8 3.6-8 8 0 5.5 8 14 8 14s8-8.500 8-14c0-4.400-3-8-8-8z`} fill={color} />
      <circle cx={x} cy="14" r="3" fill="#fff" />
      <text x={x} y="42" textAnchor="middle" fontSize="9" fill="var(--ink-500)">{label}</text>
    </g>
  );
}

export function TruckLoader({ label = "Finding the route…", from = "Investors", to = "Signals", width = 300 }: { label?: string; from?: string; to?: string; width?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width, height: 74, ["--road" as string]: `${width}px` }}>
        <svg width={width} height="74" viewBox={`0 0 ${width} 74`} className="absolute inset-0" aria-hidden="true">
          <Pin x={18} label={from} color="var(--brand)" />
          <Pin x={width - 18} label={to} color="var(--accent)" />
          <line className="rr-road" x1="30" y1="62" x2={width - 30} y2="62" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 13" />
        </svg>
        <div className="rr-truck absolute left-0" style={{ top: 25 }}><Truck /></div>
      </div>
      <p className="text-sm font-medium text-ink-700">{label}</p>
    </div>
  );
}
