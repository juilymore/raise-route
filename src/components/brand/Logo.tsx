import { BRAND, taglineFor } from "@/config/brand";

/** Route-glyph logo mark: two dots joined by a curved dotted path with an arrow head. Name comes from the brand constant. */
export function LogoMark({ size = 32, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${BRAND.name} logo`}>
      <rect width="64" height="64" rx="16" fill={light ? "#fff" : "var(--brand)"} />
      <circle cx="17" cy="45" r="5" fill={light ? "var(--brand)" : "#fff"} />
      <path d="M17 45 C 17 25, 41 41, 44 21" fill="none" stroke={light ? "var(--brand)" : "#fff"} strokeWidth="4" strokeLinecap="round" strokeDasharray="1 7" />
      <path d="M44 21 L36 24 M44 21 L46 29" fill="none" stroke="var(--accent)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ company, light = false }: { company?: string; light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark light={light} />
      <span className="flex flex-col gap-1.5 leading-none">
        <span className={`font-display text-[18px] font-bold tracking-tight ${light ? "text-white" : "text-ink-900"}`}>{BRAND.name}</span>
        <span className={`text-[11px] ${light ? "text-white/75" : "text-ink-500"}`}>{company ? taglineFor(company) : BRAND.tagline}</span>
      </span>
    </span>
  );
}

/** Faint dotted route line used as a background accent (greeting area, hero card). */
export function RouteMotif({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 320 120" fill="none">
      <path d="M8 100 C 70 20, 130 110, 190 50 S 280 20, 312 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 9" />
      <circle cx="8" cy="100" r="5" fill="currentColor" />
      <circle cx="190" cy="50" r="4" fill="currentColor" />
      <circle cx="312" cy="34" r="5" fill="currentColor" />
    </svg>
  );
}
