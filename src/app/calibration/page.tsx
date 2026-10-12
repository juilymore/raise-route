import type { Metadata } from "next";
import { Card, CardTitle, EmptyState } from "@/components/ui/cards";
import { pageTitle } from "@/config/brand";
import { MIN_SAMPLES, REASON_LABEL, summarizeFeedback, summarizeOutcomes } from "@/lib/founder/calibration";
import { getCalibrationData } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Calibration") };
export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

export default async function CalibrationPage() {
  let d;
  try {
    d = await getCalibrationData();
  } catch (e) {
    console.error("[calibration]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  const f = summarizeFeedback(d.feedback);
  const o = summarizeOutcomes(d.outcomes);
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Calibration</h1>
        <p className="mt-1 text-sm text-ink-500">How useful the recommendations have been, according to you. Every number shows how many ratings it is based on.</p>
      </div>

      <Card>
        <CardTitle aside={<span className="text-xs tabular-nums text-ink-500">n = {f.n}</span>}>Feedback on recommendations</CardTitle>
        {f.n === 0 ? (
          <EmptyState title="No feedback yet" body="Use the thumbs on a recommendation card. Ratings are saved for your review." />
        ) : (
          <>
            <p className="text-sm text-ink-700"><strong className="tabular-nums">{f.positive}</strong> useful, <strong className="tabular-nums">{f.negative}</strong> not useful ({pct(f.usefulRate)} useful, n = {f.n}).</p>
            {!f.enough && <p className="mt-2 rounded-xl bg-bg p-3 text-sm text-ink-700">Too few ratings to conclude anything (fewer than {MIN_SAMPLES}). Treat these numbers as anecdotes.</p>}
            {f.reasons.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">Why recommendations were marked not useful</h3>
                <ul className="space-y-1.5">
                  {f.reasons.map((r) => (
                    <li key={r.reason} className="flex items-center gap-3 text-sm">
                      <span className="w-56 shrink-0 text-ink-700">{REASON_LABEL[r.reason] ?? r.reason}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg" aria-hidden="true"><span className="block h-full rounded-full bg-brand" style={{ width: `${(r.count / Math.max(1, f.negative)) * 100}%` }} /></span>
                      <span className="w-10 text-right tabular-nums text-ink-500">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <CardTitle aside={<span className="text-xs tabular-nums text-ink-500">n = {o.n}</span>}>What happened after reaching out</CardTitle>
        {o.n === 0 ? (
          <EmptyState title="No outcomes logged yet" body="After you contact an investor, log what happened on their page. This is kept separate from thumbs feedback." />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-ink-500">Replied</dt><dd className="tabular-nums font-medium">{o.response}</dd></div>
              <div><dt className="text-xs text-ink-500">Meeting booked</dt><dd className="tabular-nums font-medium">{o.meeting}</dd></div>
              <div><dt className="text-xs text-ink-500">Passed</dt><dd className="tabular-nums font-medium">{o.passed}</dd></div>
              <div><dt className="text-xs text-ink-500">No response</dt><dd className="tabular-nums font-medium">{o.noResponse}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-ink-700">Replies or meetings: {pct(o.responseRate)} (n = {o.n}).</p>
            {!o.enough && <p className="mt-2 rounded-xl bg-bg p-3 text-sm text-ink-700">Too few outcomes to conclude anything (fewer than {MIN_SAMPLES}).</p>}
          </>
        )}
      </Card>

      <Card>
        <CardTitle>What this page does and does not do</CardTitle>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">
          <li>Your ratings are stored so <em>you</em> can review them. They do <strong>not</strong> change scores, actions or any of your data, and the system does not learn from them automatically.</li>
          <li>Changing the scoring rules is a deliberate, versioned edit to a configuration file, with the golden tests re-run.</li>
          <li>{d.drafts} outreach draft{d.drafts === 1 ? "" : "s"} generated so far. Drafts are never sent by the system.</li>
        </ul>
      </Card>
    </div>
  );
}
