"use client";

import clsx from "clsx";
import { Gauge, LayoutDashboard, Radar, Settings, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Truck },
  { href: "/runs", label: "Runs", icon: Radar },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function PillNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 rounded-full border border-line bg-bg p-1 md:flex">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={isActive(path, n.href) ? "page" : undefined}
          className={clsx(
            "rounded-full px-4 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
            isActive(path, n.href) ? "bg-brand text-white" : "text-ink-700 hover:bg-white",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function IconRail() {
  const path = usePathname();
  return (
    <nav aria-label="Quick navigation" className="hidden w-14 shrink-0 flex-col items-center gap-2 py-4 md:flex">
      {NAV.map((n) => {
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            title={n.label}
            aria-label={n.label}
            aria-current={isActive(path, n.href) ? "page" : undefined}
            className={clsx(
              "grid h-10 w-10 place-items-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
              isActive(path, n.href) ? "bg-brand text-white" : "text-ink-500 hover:bg-bg hover:text-ink-900",
            )}
          >
            <Icon size={19} aria-hidden="true" />
          </Link>
        );
      })}
      <span className="mt-auto text-ink-500" aria-hidden="true"><Gauge size={16} /></span>
    </nav>
  );
}

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV.map((n) => {
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(path, n.href) ? "page" : undefined}
            className={clsx("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive(path, n.href) ? "text-brand" : "text-ink-500")}
          >
            <Icon size={20} aria-hidden="true" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
