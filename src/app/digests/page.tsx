import type { Metadata } from "next";
import Link from "next/link";
import { DigestActions } from "@/components/founder/DigestActions";
import { Card, EmptyState, timeAgo } from "@/components/ui/cards";
import { DIGEST_STATUS, friendlyDigestError } from "@/components/ui/digestStatus";
import { pageTitle } from "@/config/brand";
import { currentIsFounder } from "@/lib/founder/server";
import { listDigests } from "@/lib/db/readDb";

export const metadata: Metadata = { title: pageTitle("Email digest") };
export const dynamic = "force-dynamic";

export default async function DigestsPage() {
  let rows;
  try {
    rows = await listDigests();
  } catch (e) {
    console.error("[digests]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  const founder = await currentIsFounder().catch(() => false);
  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink-900 sm:text-[32px]">Email digest</h1>
        <p className="mt-1 text-sm text-ink-500">After every scan, RaiseRoute can email Vikram a short summary: who to contact, who changed, who is quiet. Each email is saved here exactly as it was written.</p>
      </div>
      {founder && <Card><p className="mb-3 text-sm text-ink-700"><strong>Preview</strong> shows the email without sending it. <strong>Email it to me</strong> sends the latest summary to the address set for this app. The same email is never sent twice.</p><DigestActions /></Card>}
      <Card>
        {rows.length === 0 ? <EmptyState title="No digests yet" body="A digest is created after a run finishes." /> : (
          <ul className="divide-y divide-line">
            {rows.map((d) => {
              const s = DIGEST_STATUS[d.status] ?? { label: d.status, cls: "bg-gray-100 text-gray-600", help: "" };
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <Link href={`/digests/${d.id}`} className="font-medium text-ink-900 hover:text-brand">{d.subject}</Link>
                    <div className="text-xs text-ink-500">run {d.run_key} · {timeAgo(d.created_at)}{d.sent_at ? ` · sent ${timeAgo(d.sent_at)}` : ""}</div>
                  </div>
                  <span title={s.help} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
                  {d.status === "FAILED" && friendlyDigestError(d.error) && <p className="w-full text-xs text-red-700">{friendlyDigestError(d.error)}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
