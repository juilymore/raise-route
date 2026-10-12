"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a run is in progress, re-read the page every few seconds so the truck and counts stay current. */
export function AutoRefresh({ active, everyMs = 8000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
