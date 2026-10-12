import { BRAND } from "@/config/brand";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import type { PipelineStore } from "@/lib/pipeline/store";
import { buildDigest, type DigestItem } from "./build";

/**
 * Create the immutable digest for a run, then (optionally) send it.
 * Idempotent: digest_key = digest-<run_id>. A SENT digest is never sent again. Status SENT is recorded ONLY when the provider
 * returns a message id; no key => DEV_NOT_SENT (the UI says so plainly); a failed send => FAILED with the error, retryable by hand.
 */
export interface SendPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}
export type Sender = (p: SendPayload) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;

export const resendSender = (apiKey: string): Sender => async (p) => {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": p.idempotencyKey },
      body: JSON.stringify({ from: p.from, to: [p.to], subject: p.subject, html: p.html, text: p.text }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok && typeof j.id === "string" && j.id) return { ok: true, id: j.id };
    return { ok: false, error: `Resend HTTP ${r.status}: ${j.message ?? j.name ?? "no message id returned"}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: `Resend request failed: ${(e as Error).message}`.slice(0, 300) };
  }
};

/** Postgres `date` columns arrive as JS Date objects from the driver; accept both Date and string. */
export function toIsoDay(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  const m = typeof v === "string" ? v.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : new Date().toISOString().slice(0, 10);
}

export interface DigestResult {
  digestId: string;
  status: string;
  created: boolean;
  alreadySent: boolean;
  messageId?: string;
  error?: string;
}

export async function createAndMaybeSendDigest(
  db: Pick<PipelineStore, "digestSnapshot" | "getDigestByKey" | "insertDigest" | "insertDigestItems" | "updateDigestStatus" | "getRun">,
  opts: { runId: string; send: boolean; sender?: Sender; recipient?: string; from?: string; baseUrl?: string },
): Promise<DigestResult> {
  const env = getEnv();
  const key = `digest-${opts.runId}`;
  const sender = opts.sender ?? (env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY) : undefined);
  const recipient = opts.recipient ?? env.DIGEST_RECIPIENT;
  const from = opts.from ?? env.DIGEST_FROM ?? `${BRAND.emailFromName} <onboarding@resend.dev>`;

  let existing = await db.getDigestByKey(key);
  if (existing?.status === "SENT") return { digestId: String(existing.id), status: "SENT", created: false, alreadySent: true, messageId: (existing.provider_message_id as string | null) ?? undefined };

  let created = false;
  if (!existing) {
    const run = await db.getRun(opts.runId);
    if (!run) throw new Error("unknown run");
    const items = await db.digestSnapshot(opts.runId);
    const cfg = getConfig().scoring;
    const built = buildDigest({
      runKey: String(run.run_key),
      runDate: toIsoDay(run.window_end),
      baseUrl: opts.baseUrl ?? env.APP_BASE_URL,
      items: items as DigestItem[],
      quietCopy: cfg.language.quiet,
      incompleteCopy: cfg.language.incomplete,
    });
    const row = await db.insertDigest({ run_id: opts.runId, digest_key: key, recipient: recipient ?? "unset", subject: built.subject, html: built.html, text_body: built.text, status: "PREVIEW" });
    await db.insertDigestItems(String(row!.id), built.sections);
    existing = row;
    created = true;
  }
  const id = String(existing!.id);
  if (!opts.send) return { digestId: id, status: String(existing!.status), created, alreadySent: false };

  if (!sender || !recipient) {
    await db.updateDigestStatus(id, { status: "DEV_NOT_SENT", error: !recipient ? "DIGEST_RECIPIENT is not set" : "RESEND_API_KEY is not set" });
    return { digestId: id, status: "DEV_NOT_SENT", created, alreadySent: false };
  }
  await db.updateDigestStatus(id, { status: "SENDING" });
  const res = await sender({ from, to: recipient, subject: String(existing!.subject), html: String(existing!.html), text: String(existing!.text_body), idempotencyKey: key });
  if (res.ok) {
    await db.updateDigestStatus(id, { status: "SENT", provider: "resend", providerMessageId: res.id, sentAt: new Date().toISOString() });
    return { digestId: id, status: "SENT", created, alreadySent: false, messageId: res.id };
  }
  await db.updateDigestStatus(id, { status: "FAILED", provider: "resend", error: res.error });
  return { digestId: id, status: "FAILED", created, alreadySent: false, error: res.error };
}
