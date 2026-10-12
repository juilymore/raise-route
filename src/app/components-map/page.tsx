import type { Metadata } from "next";
import { Card, CardTitle } from "@/components/ui/cards";
import { BRAND, pageTitle } from "@/config/brand";

export const metadata: Metadata = { title: pageTitle("Components map") };

/** The exam's Components Map (deliverable E6). Source of truth: docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md. */
const STEPS = [
  "Every Monday and Thursday morning (or when you press Run now) a scan starts.",
  "The scan manager makes one small job for each of the 50 investors and saves a fingerprint of your notes and contact history.",
  "For each investor we look for fresh news and posts: their own blog, Google News and logistics trade-press feeds.",
  "Each article is opened safely and its real publish date is found. Anything older than 30 days is dropped.",
  "We check the article is really about that investor. Then Gemini writes down what happened, with an exact quote from the page.",
  "Code double-checks the quote is on the page, the date is recent and the story is not a copy. Rejected items are kept with the reason.",
  "Code gives the investor a score from 0 to 100 and picks one action, using your contact history (for example: do not email twice in a week).",
  "Only the signal columns of the investor table are updated. Your notes and contact history cannot change, and a before-and-after check proves it.",
];


export default function ComponentsMapPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Components map</h1>
        <p className="mt-1 text-sm text-ink-500">How {BRAND.name} works, in plain words: who does what, from the trigger to the result.</p>
      </div>

      <Card>
        <CardTitle aside={<a href="/components-map.png" download className="text-sm font-semibold text-brand hover:underline">Download PNG</a>}>Map by actor and stage</CardTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/components-map.png" alt="Swimlane map: actors down the side, stages across (trigger, input, context, processing, AI, output), showing how Vikram, the scheduler, the source collector, Gemini Flash, the rules engine, the database and integrations connect" className="w-full rounded-xl border border-line" />
      </Card>

      <Card>
        <CardTitle>Data flow</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      </Card>

      <Card>
        <CardTitle>Services and cost</CardTitle>
        <p className="text-sm text-ink-700">Vercel Hobby (free) · Neon free tier · Google AI Studio (Gemini Flash, small pay-as-you-go cost; a full 50-investor run is on the order of 50 to 100 model calls) · optional Resend for the email digest. No Claude or other model provider is used anywhere in the product; the AI ledger on each run page proves it.</p>
      </Card>
    </div>
  );
}
