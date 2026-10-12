"use client";

import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TagAI } from "@/components/ui/chips";

/** One-line summary of the last scan. Dismissable; the choice is remembered per browser only (never required for the page to work). */
export function AiBanner({ text, href, cta, id }: { text: string; href: string; cta: string; id: string }) {
  const key = `banner:${id}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-ink-700" role="status">
      <Sparkles size={16} className="shrink-0 text-ai" aria-hidden="true" />
      <TagAI />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href={href} className="shrink-0 font-semibold text-brand underline-offset-2 hover:underline">{cta}</Link>
      <button
        type="button"
        aria-label="Dismiss"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-white"
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            /* storage unavailable: fine */
          }
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
