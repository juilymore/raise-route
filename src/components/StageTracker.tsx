import { Truck } from "lucide-react";

const STAGES = [
  { key: "TO_REACH_OUT", label: "To reach out" },
  { key: "WAITING_FOR_RESPONSE", label: "Contacted" },
  { key: "IN_CONVERSATION", label: "In conversation" },
  { key: "MEETING_SCHEDULED", label: "Meeting" },
  { key: "PASSED", label: "Term sheet / Passed" },
] as const;

/** Shipment-tracking style relationship stage: a truck marks the current stage on a dotted route line. */
export function StageTracker({ status }: { status: string }) {
  const idx = Math.max(0, STAGES.findIndex((s) => s.key === status));
  return (
    <ol className="relative flex items-start justify-between" aria-label={`Relationship stage: ${STAGES[idx]?.label}`}>
      <span aria-hidden="true" className="absolute left-3 right-3 top-3 border-t-2 border-dotted border-line" />
      {STAGES.map((s, i) => (
        <li key={s.key} className="relative z-10 flex w-1/5 flex-col items-center text-center" aria-current={i === idx ? "step" : undefined}>
          <span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${i === idx ? "border-brand bg-brand text-white" : i < idx ? "border-brand bg-white" : "border-line bg-white"}`}>
            {i === idx ? <Truck size={12} aria-hidden="true" /> : null}
          </span>
          <span className={`mt-1 text-[11px] leading-tight ${i === idx ? "font-semibold text-ink-900" : "text-ink-500"}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
