import type { Metadata } from "next";
import { Card, CardTitle } from "@/components/ui/cards";
import { LiveChip, TagAI, TagYou } from "@/components/ui/chips";
import { getConfig } from "@/lib/config";
import { BRAND, pageTitle } from "@/config/brand";

export const metadata: Metadata = { title: pageTitle("Data honesty") };

export default function DataHonestyPage() {
  const { scoring } = getConfig();
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Data honesty</h1>
        <p className="mt-1 text-sm text-ink-500">What in {BRAND.name} is live, what is pre-filled, and how evidence is checked.</p>
      </div>

      <Card>
        <CardTitle>What is what</CardTitle>
        <dl className="space-y-4 text-sm text-ink-700">
          <div><dt className="mb-1 flex items-center gap-2 font-semibold text-ink-900"><LiveChip /> Signals and evidence</dt><dd>Every signal (what happened, its date, the source link and the quoted sentence) comes from live public sources fetched at run time. Each quote is checked to exist word for word in the fetched page, and every date must fall in the last 30 days.</dd></div>
          <div><dt className="mb-1 flex items-center gap-2 font-semibold text-ink-900">Relationships</dt><dd>The contact status, last-contact dates, contact history and notes for each investor were <strong>pre-filled as starter (synthetic) data</strong> so the relationship-aware advice can be shown. Edit them on each investor&apos;s page; the system never changes them.</dd></div>
          <div><dt className="mb-1 flex items-center gap-2 font-semibold text-ink-900">Company profile</dt><dd>The company profile (FreightLoop) gives relevance scoring its context. Edit it in Settings.</dd></div>
          <div><dt className="mb-1 font-semibold text-ink-900">Investor profiles</dt><dd>Thesis, stage and sector tags in the starting list are unverified hints, not facts. Where something is unknown it stays unknown and counts as neutral in the score.</dd></div>
          <div><dt className="mb-1 flex items-center gap-2 font-semibold text-ink-900"><TagAI /> AI-derived vs <TagYou /> founder-entered</dt><dd>Text produced by AI is tagged violet. Text the founder wrote is tagged amber. Scores and actions are not written by AI: plain code computes them from verified facts.</dd></div>
        </dl>
      </Card>

      <Card>
        <CardTitle>How evidence is verified</CardTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
          <li>The page must load and contain real article text. Blocked, paywalled or empty pages are rejected, never guessed.</li>
          <li>The date comes from structured page data or the feed, never from when we fetched it and never from a &quot;last modified&quot; stamp. An old article that was edited recently is treated as old.</li>
          <li>The event must be inside the last {scoring.window_days} days.</li>
          <li>The page must really be about the investor (names like &quot;Accel&quot; vs &quot;accelerate&quot; are checked) and show real activity, not just a mention in a list.</li>
          <li>The quoted sentence must appear in the page text. If it does not, the evidence is thrown away.</li>
          <li>Copies of the same press release do not count as independent confirmation.</li>
        </ol>
        <p className="mt-3 text-sm text-ink-700">Everything that is rejected is kept with a reason on the run page, so you can see what was ignored and why.</p>
      </Card>

      <Card>
        <CardTitle>Quiet is not the same as incomplete</CardTitle>
        <p className="text-sm text-ink-700">&quot;{scoring.language.quiet}&quot; is shown only when enough sources were actually checked. If a source failed or pages could not be read, the investor is shown as <strong>Incomplete</strong>: &quot;{scoring.language.incomplete}&quot; The app never describes an investor as uninterested or inactive.</p>
      </Card>

      <Card>
        <CardTitle>Limits you should know about</CardTitle>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">
          <li>No LinkedIn or X (terms of service). No paid data vendors.</li>
          <li>Many news sites block automated readers; those pages are reported as not fetched.</li>
          <li>AI extraction is not perfectly repeatable. The checks above are what make the output trustworthy, not the model.</li>
        </ul>
      </Card>
    </div>
  );
}
