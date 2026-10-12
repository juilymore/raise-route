"use client";

import clsx from "clsx";
import { LayoutDashboard, Mail, Radar, Settings, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Truck },
  { href: "/runs", label: "Runs", icon: Radar },
  { href: "/digests", label: "Email digest", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function PillNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 rounded-full border border-white/25 bg-white/10 p-1 shadow-inner backdrop-blur-md md:flex">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={isActive(path, n.href) ? "page" : undefined}
          className={clsx(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
            isActive(path, n.href) ? "bg-white/30 text-white shadow-[0_2px_10px_rgba(0,0,0,.12)] ring-1 ring-white/50 backdrop-blur-md" : "text-white/85 hover:bg-white/15 hover:text-white",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
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
