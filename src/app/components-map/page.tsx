import type { Metadata } from "next";
import { Card, CardTitle } from "@/components/ui/cards";
import { BRAND, pageTitle } from "@/config/brand";

export const metadata: Metadata = { title: pageTitle("Components map") };

/** The exam's Components Map (deliverable E6). Source of truth: docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md. */
const COMPONENTS: Array<[string, string, string, string, string]> = [
  ["C1", "Website", "The pages you see, and the code behind them. Code lives on GitHub; Vercel publishes it.", "Next.js, Vercel, GitHub", "Live site (E4) and code repository (E5)"],
  ["C2", "Scheduler", "Starts a scan every Monday and Thursday morning, or when you press Run now.", "Vercel Cron", "Runs twice a week (E7)"],
  ["C4", "Database", "Stores the 50 investors, what was found, the scores and your notes.", "Neon Postgres", "A live table that stays current (E11)"],
  ["C5", "Scan manager", "Splits a scan into one small job per investor and picks up where it left off if it stops.", "TypeScript + database queue", "Reliable at 50 investors"],
  ["C6", "Source collector", "Looks for fresh news and posts about each investor: their own blog, Google News and logistics trade-press feeds.", "RSS and web feeds", "Live data (E1), 30-day signals (E9)"],
  ["C7", "Page reader", "Opens each article safely and finds its real publish date.", "Safe fetcher, date rules", "Only the last 30 days counts (E9)"],
  ["C8", "Name checker", "Checks the article is about the right investor, not a company with a similar name.", "TypeScript", "Right investor, right person (E9)"],
  ["C9", "Gemini Flash (AI)", "Reads the article and writes down what happened with an exact quote. It never gives scores or decisions.", "Gemini Flash", "Gemini only (E3)"],
  ["C10", "Fact checker", "Throws out anything where the quote is not on the page, the date is too old, or the story is a copy of one already counted.", "TypeScript rules", "Real and observable (E9)"],
  ["C12", "Scoring", "Gives each investor 0 to 100 from a points table. You can edit the table in Settings.", "TypeScript + editable rubric", "Explains why (E8)"],
  ["C13", "Action picker", "Turns the score and your contact history into one action: reach out, follow up, monitor, on hold.", "TypeScript", "Who to contact and why (E8), quiet investors (E10)"],
  ["C14", "Data guard", "Makes it impossible for a scan to change your notes or contact history, and proves it with a before-and-after check.", "Database permissions, one safe write function, triggers", "Notes never overwritten (E12, E13)"],
  ["C15", "History saver", "Keeps a permanent copy of every scan result, so earlier results are never rewritten.", "Database", "History and explanation"],
  ["C18", "Dashboard", "Today's contacts, what changed, quiet investors, each investor's page and Settings.", "Next.js, Tailwind", "Easy to act on (E8, E10)"],
  ["C20", "Run logs", "Shows what each scan did, what it rejected and why, and every AI call.", "Database tables", "Trust and proof"],
  ["C21", "Safety rules", "Limits on repeated requests, a secret key for the scheduler, and database rules that block changes to protected data.", "Origin checks, rate limits, secrets", "Safe public site"],
  ["C22", "Automatic checks", "Tests that run before any change goes live.", "Vitest, compliance script", "Credibility"],
];

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
        <CardTitle>Components</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-semibold">ID</th><th className="px-3 font-semibold">Component</th><th className="px-3 font-semibold">What it does</th><th className="px-3 font-semibold">Built with</th><th className="px-3 font-semibold">Why it matters</th></tr></thead>
            <tbody>
              {COMPONENTS.map(([id, name, what, tech, req]) => (
                <tr key={id} className="border-t border-line align-top"><td className="py-2 pr-3 font-mono text-xs">{id}</td><td className="px-3 font-medium text-ink-900">{name}</td><td className="px-3 text-ink-700">{what}</td><td className="px-3 text-ink-700">{tech}</td><td className="px-3 text-ink-700">{req}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
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
