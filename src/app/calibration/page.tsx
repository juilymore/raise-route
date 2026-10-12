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
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Calibration: are the suggestions any good?</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">This page checks the app against real life. You tell it two things: was a suggestion useful (thumbs up or down on a card), and what happened after you contacted an investor. The page then shows how often the app was right. The count behind every number is shown, so you know how much to trust it.</p>
      </div>

      <Card>
        <CardTitle aside={<span className="text-xs tabular-nums text-ink-500">n = {f.n}</span>}>Your thumbs up and down</CardTitle>
        {f.n === 0 ? (
          <EmptyState title="No thumbs yet" body="On the dashboard, each suggestion has a thumbs up and a thumbs down. Press one after you decide whether the suggestion was good. Your answers show up here." />
        ) : (
          <>
            <p className="text-sm text-ink-700"><strong className="tabular-nums">{f.positive}</strong> thumbs up and <strong className="tabular-nums">{f.negative}</strong> thumbs down: {pct(f.usefulRate)} of suggestions were useful (out of {f.n} rated).</p>
            {!f.enough && <p className="mt-2 rounded-xl bg-bg p-3 text-sm text-ink-700">Too few ratings so far (fewer than {MIN_SAMPLES}) to say anything reliable. Think of these numbers as a first impression.</p>}
            {f.reasons.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">Why a suggestion got a thumbs down</h3>
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
        <CardTitle aside={<span className="text-xs tabular-nums text-ink-500">n = {o.n}</span>}>What happened after you reached out</CardTitle>
        {o.n === 0 ? (
          <EmptyState title="No results logged yet" body="After you contact an investor, open their page and log what happened (replied, meeting, passed, no response). That tells us whether the suggestions lead to real conversations." />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-ink-500">Replied</dt><dd className="tabular-nums font-medium">{o.response}</dd></div>
              <div><dt className="text-xs text-ink-500">Meeting booked</dt><dd className="tabular-nums font-medium">{o.meeting}</dd></div>
              <div><dt className="text-xs text-ink-500">Passed</dt><dd className="tabular-nums font-medium">{o.passed}</dd></div>
              <div><dt className="text-xs text-ink-500">No response</dt><dd className="tabular-nums font-medium">{o.noResponse}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-ink-700">{pct(o.responseRate)} of the investors you contacted replied or booked a meeting (out of {o.n}).</p>
            {!o.enough && <p className="mt-2 rounded-xl bg-bg p-3 text-sm text-ink-700">Too few results so far (fewer than {MIN_SAMPLES}) to say anything reliable.</p>}
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Good to know</CardTitle>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">
          <li>Your thumbs are saved only for you to look at. They do <strong>not</strong> change any score or action, and the app does not teach itself from them.</li>
          <li>If the numbers show the suggestions are off, change the scoring numbers in Settings. That is a deliberate change you make; nothing changes by itself.</li>
          <li>{d.drafts} email draft{d.drafts === 1 ? "" : "s"} written so far. The app never sends a draft for you.</li>
        </ul>
      </Card>
    </div>
  );
}
