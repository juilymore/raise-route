"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { REASON_LABEL } from "@/lib/founder/calibration";

/** 👍/👎 on one recommendation snapshot. A thumbs-down asks why. Founder-only (the server checks again). */
export function FeedbackButtons({ recommendationId }: { recommendationId: string }) {
  const [state, setState] = useState<"idle" | "asking" | "saving" | "done" | "error">("idle");
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const send = async (vote: "POSITIVE" | "NEGATIVE") => {
    setState("saving");
    const r = await fetch("/api/founder/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId, vote, reasons: vote === "NEGATIVE" ? reasons : [], note: note || undefined }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) setState("done");
    else {
      setErr(j.error ?? "Could not save");
      setState(vote === "NEGATIVE" ? "asking" : "error");
    }
  };
  if (state === "done") return <span className="text-xs text-emerald-700" role="status">Thanks, saved for your review.</span>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Useful" disabled={state === "saving"} onClick={() => send("POSITIVE")} className="grid h-11 w-11 place-items-center rounded-xl border border-line text-ink-700 hover:border-emerald-500 hover:text-emerald-700"><ThumbsUp size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Not useful" aria-expanded={state === "asking"} disabled={state === "saving"} onClick={() => setState("asking")} className="grid h-11 w-11 place-items-center rounded-xl border border-line text-ink-700 hover:border-red-400 hover:text-red-600"><ThumbsDown size={17} aria-hidden="true" /></button>
      </div>
      {state === "asking" && (
        <fieldset className="space-y-1.5 rounded-xl border border-line bg-bg p-3">
          <legend className="px-1 text-xs font-semibold text-ink-700">What was wrong?</legend>
          {Object.entries(REASON_LABEL).map(([k, v]) => (
            <label key={k} className="flex min-h-[32px] items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={reasons.includes(k)} onChange={(e) => setReasons((r) => (e.target.checked ? [...r, k] : r.filter((x) => x !== k)))} />
              {v}
            </label>
          ))}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note" className="mt-1 min-h-[40px] w-full rounded-lg border border-line px-3 text-sm" />
          {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
          <button type="button" disabled={reasons.length === 0 || state !== "asking"} onClick={() => send("NEGATIVE")} className="min-h-[40px] rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </fieldset>
      )}
    </div>
  );
}
