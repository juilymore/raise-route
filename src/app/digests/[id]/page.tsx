import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DigestActions } from "@/components/founder/DigestActions";
import { Card, CardTitle, Stat } from "@/components/ui/cards";
import { pageTitle } from "@/config/brand";
import { currentIsFounder } from "@/lib/founder/server";
import { getDigest } from "@/lib/db/readDb";
import { DIGEST_STATUS } from "@/components/ui/digestStatus";

export const metadata: Metadata = { title: pageTitle("Digest") };
export const dynamic = "force-dynamic";

export default async function DigestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d;
  try {
    d = await getDigest(id);
  } catch (e) {
    console.error("[digest page]", (e as Error).message);
    return <div className="mx-auto max-w-xl py-16 text-center text-ink-500">The database could not be reached. Please try again in a moment.</div>;
  }
  if (!d) notFound();
  const founder = await currentIsFounder().catch(() => false);
  const s = DIGEST_STATUS[d.digest.status] ?? { label: d.digest.status, cls: "bg-gray-100 text-gray-600", help: "" };
  const bySection = new Map<string, typeof d.items>();
  d.items.forEach((i) => bySection.set(i.section, [...(bySection.get(i.section) ?? []), i]));
  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <Link href="/digests" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand"><ArrowLeft size={15} aria-hidden="true" />Digests</Link>
      <header>
        <h1 className="font-display text-[24px] font-bold text-ink-900 sm:text-[28px]">{d.digest.subject}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500"><span title={s.help} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>run {d.digest.run_key} · to {d.digest.recipient}</p>
      </header>
      <Card>
        <CardTitle>Delivery</CardTitle>
        <p className="text-sm text-ink-700">{s.help}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Provider message id" value={d.digest.provider_message_id ?? "none"} />
          <Stat label="Sent at" value={d.digest.sent_at ? d.digest.sent_at.slice(0, 16).replace("T", " ") + " UTC" : "not sent"} />
          <Stat label="Error" value={d.digest.error ?? "none"} />
        </dl>
        {founder && d.digest.status !== "SENT" && <div className="mt-4"><DigestActions runId={d.digest.run_id} label="Refresh status" /></div>}
      </Card>
      <Card>
        <CardTitle>The exact email</CardTitle>
        <iframe title="Email preview" sandbox="" srcDoc={d.html} className="h-[640px] w-full rounded-xl border border-line bg-white" />
      </Card>
      <Card>
        <CardTitle>Items included ({d.items.length})</CardTitle>
        {[...bySection].map(([section, list]) => (
          <div key={section} className="mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{section.replaceAll("_", " ").toLowerCase()}</h3>
            <p className="text-sm text-ink-700">{list.map((i, k) => <span key={i.slug}>{k > 0 ? ", " : ""}<Link className="hover:text-brand" href={`/vc/${i.slug}`}>{i.firm}</Link></span>)}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}
