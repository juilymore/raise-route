import clsx from "clsx";

export const ACTION_STYLE: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  REACH_OUT_NOW: { label: "Reach out now", bg: "#DCFCE7", fg: "#166534", dot: "#22C55E" },
  FOLLOW_UP_NOW: { label: "Follow up now", bg: "#CCFBF1", fg: "#115E59", dot: "#14B8A6" },
  MONITOR: { label: "Monitor", bg: "#DBEAFE", fg: "#1E40AF", dot: "#3B82F6" },
  HOLD: { label: "Hold", bg: "#E5E7EB", fg: "#374151", dot: "#9CA3AF" },
  DONT_PRIORITIZE: { label: "Don't prioritize", bg: "#F3F4F6", fg: "#6B7280", dot: "#D1D5DB" },
  ASSESSMENT_INCOMPLETE: { label: "Incomplete", bg: "#FFEDD5", fg: "#9A3412", dot: "#F97316" },
  NOT_ASSESSED: { label: "Not assessed yet", bg: "#F3F4F6", fg: "#6B7280", dot: "#D1D5DB" },
};

export const HOLD_LABEL: Record<string, string> = {
  RECENT_CONTACT: "recent contact",
  AWAITING_RESPONSE: "awaiting response",
  RECONNECT_DATE: "reconnect date",
  ACTIVE_CONVERSATION: "active conversation",
};

/** Colour never carries meaning alone: the label text is always shown. */
export function ActionChip({ action, holdReason, className }: { action: string; holdReason?: string | null; className?: string }) {
  const s = ACTION_STYLE[action] ?? ACTION_STYLE.NOT_ASSESSED!;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", className)} style={{ background: s.bg, color: s.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />
      {s.label}
      {action === "HOLD" && holdReason ? <span className="font-normal opacity-80">· {HOLD_LABEL[holdReason] ?? holdReason.toLowerCase()}</span> : null}
    </span>
  );
}

/** Violet tag: this text was produced or derived by AI (Gemini extracts, code scores). */
export function TagAI({ children = "AI" }: { children?: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ai">{children}</span>;
}

/** Amber tag: founder-entered data. */
export function TagYou() {
  return <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">You</span>;
}

export function DemoChip({ children = "Demo data" }: { children?: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{children}</span>;
}

export function LiveChip() {
  return <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live</span>;
}

export function SourceChip({ url, domain, date, verified }: { url: string; domain: string | null; date?: string | null; verified?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-700 hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
      <span className="truncate">{domain ?? "source"}</span>
      {date ? <span className="tabular-nums text-ink-500">· {date}</span> : null}
      {verified ? <span title="Quote found verbatim in the fetched page" className="text-emerald-600">✓</span> : null}
    </a>
  );
}
