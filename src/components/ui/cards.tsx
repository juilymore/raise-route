import clsx from "clsx";
import { Route } from "lucide-react";
import Link from "next/link";
import { RouteMotif } from "@/components/brand/Logo";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(14,31,43,.04),0_8px_24px_rgba(14,31,43,.04)]", className)}>{children}</section>;
}

export function CardTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-xl font-semibold text-ink-900">{children}</h2>
      {aside}
    </div>
  );
}

export function KpiCard({ label, value, hint, hero, href }: { label: string; value: number | string; hint?: string; hero?: boolean; href?: string }) {
  const body = (
    <div
      className={clsx(
        "relative h-full overflow-hidden rounded-[20px] p-4 sm:p-5",
        hero ? "text-white shadow-[0_8px_24px_rgba(15,118,110,.25)]" : "border border-line bg-surface text-ink-900 shadow-[0_1px_2px_rgba(14,31,43,.04)]",
      )}
      style={hero ? { background: "linear-gradient(135deg, var(--brand-ink), var(--brand))" } : undefined}
    >
      {hero && <RouteMotif className="pointer-events-none absolute -right-6 -top-2 h-24 w-56 text-white opacity-15" />}
      <div className={clsx("relative text-xs font-semibold uppercase tracking-wide", hero ? "text-white/80" : "text-ink-500")}>{label}</div>
      <div className={clsx("relative mt-1 font-display font-bold tabular-nums", hero ? "text-5xl" : "text-4xl")}>{value}</div>
      {hint && <div className={clsx("relative mt-1 text-xs", hero ? "text-white/80" : "text-ink-500")}>{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-bg text-ink-500"><Route size={22} aria-hidden="true" /></span>
      <p className="font-display text-base font-semibold text-ink-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-500">{body}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
