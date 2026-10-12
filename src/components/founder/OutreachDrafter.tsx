"use client";

import { Copy, Mail } from "lucide-react";
import { useState } from "react";
import { TagAI } from "@/components/ui/chips";

interface Draft {
  subject: string;
  body: string;
  placeholders: string[];
  model: string;
  basedOn: { title: string; date: string; url: string };
}

/** Gemini drafts a first email from validated signals. The founder copies it; nothing is ever sent from here. */
export function OutreachDrafter({ vcId, advisable, saved }: { vcId: string; advisable: boolean; saved: Array<{ id: string; subject: string; body: string; createdAt: string }> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const make = async () => {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/founder/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vcId }) });
    const j = (await r.json().catch(() => ({}))) as Partial<Draft> & { ok?: boolean; error?: string; detail?: string; reason?: string };
    setBusy(false);
    if (j.ok) setDraft(j as Draft);
    else setMsg(j.reason === "NO_SIGNALS" ? (j.detail ?? "No validated signal to base a draft on.") : (j.error ?? j.detail ?? "Could not draft right now."));
  };
  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setMsg("Copy is not available in this browser; select the text instead.");
    }
  };
  return (
    <div className="space-y-3">
      <button type="button" onClick={make} disabled={busy} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">
        <Mail size={16} aria-hidden="true" />
        {busy ? "Drafting…" : advisable ? "Draft outreach" : "Draft anyway (not recommended right now)"}
      </button>
      {msg && <p role="status" className="text-sm text-ink-700">{msg}</p>}
      {draft && (
        <article className="rounded-2xl border border-line bg-bg p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-500"><TagAI>AI draft</TagAI><span>never sent automatically</span>{!advisable && <span className="font-semibold text-orange-700">not recommended right now</span>}</div>
          <p className="text-sm font-semibold text-ink-900">Subject: {draft.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{draft.body}</p>
          {draft.placeholders.length > 0 && <p className="mt-2 text-xs text-ink-500">Fill in before sending: {draft.placeholders.join(" · ")}</p>}
          <p className="mt-2 text-xs text-ink-500">Based on: <a className="text-brand hover:underline" href={draft.basedOn.url} target="_blank" rel="noopener noreferrer">{draft.basedOn.title}</a> ({draft.basedOn.date}) · {draft.model}</p>
          <button type="button" onClick={copy} className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink-700 hover:border-brand"><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>
        </article>
      )}
      {!draft && saved.length > 0 && (
        <details className="text-sm text-ink-700"><summary className="cursor-pointer text-ink-500">Earlier drafts ({saved.length})</summary>
          {saved.map((d) => <div key={d.id} className="mt-2 rounded-xl bg-bg p-3"><p className="font-semibold">{d.subject}</p><p className="whitespace-pre-wrap">{d.body}</p><p className="mt-1 text-xs text-ink-500">{d.createdAt.slice(0, 16).replace("T", " ")} UTC</p></div>)}
        </details>
      )}
    </div>
  );
}
