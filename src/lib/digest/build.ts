import { BRAND } from "@/config/brand";

/**
 * Pure digest builder: turns THIS run's recommendation snapshots into the email (subject, HTML, plain text) and the item rows.
 * Sections, in order: Reach out now - Follow up now - Monitor - Hold (with reason) - Quiet investors - Priority changes.
 * No model writes this text; every sentence comes from validated facts, so it cannot state anything the data does not support.
 */
export interface DigestItem {
  recommendationId: string;
  slug: string;
  firm: string;
  action: string;
  holdReason: string | null;
  score: number | null;
  assessmentStatus: string;
  reason: string;
  signalTitle: string | null;
  eventDate: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  prevAction: string | null;
  prevScore: number | null;
}

export interface DigestInput {
  runKey: string;
  runDate: string; // yyyy-mm-dd
  baseUrl: string;
  items: DigestItem[];
  quietCopy: string;
  incompleteCopy: string;
}

export type Section = "REACH_OUT_NOW" | "FOLLOW_UP_NOW" | "MONITOR" | "HOLD" | "QUIET" | "CHANGES" | "INCOMPLETE";

export interface BuiltDigest {
  subject: string;
  html: string;
  text: string;
  sections: Array<{ section: Section; recommendationId: string; rank: number }>;
  counts: { reachOut: number; followUp: number; monitor: number; hold: number; quiet: number; incomplete: number; changes: number };
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

const HOLD_TEXT: Record<string, string> = { RECENT_CONTACT: "recent contact", AWAITING_RESPONSE: "awaiting response", RECONNECT_DATE: "reconnect date", ACTIVE_CONVERSATION: "active conversation" };
const ACTION_LABEL: Record<string, string> = { REACH_OUT_NOW: "Reach out now", FOLLOW_UP_NOW: "Follow up now", MONITOR: "Monitor", HOLD: "Hold", DONT_PRIORITIZE: "Don't prioritize", ASSESSMENT_INCOMPLETE: "Incomplete" };

export function subjectFor(runDate: string, reachOut: number, followUp: number): string {
  const d = new Date(`${runDate}T12:00:00Z`);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(",", "");
  const parts = [`${reachOut} to reach out`, `${followUp} follow-up${followUp === 1 ? "" : "s"}`];
  return `${BRAND.digestSubjectPrefix} · ${day} · ${parts.join(", ")}`;
}

const whyNow = (i: DigestItem) =>
  i.signalTitle ? `${i.signalTitle}${i.eventDate ? ` (${i.eventDate}${i.sourceDomain ? `, ${i.sourceDomain}` : ""})` : ""}` : i.reason;

export function buildDigest(input: DigestInput): BuiltDigest {
  const by = (pred: (i: DigestItem) => boolean) => input.items.filter(pred).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.firm.localeCompare(b.firm));
  const reachOut = by((i) => i.action === "REACH_OUT_NOW");
  const followUp = by((i) => i.action === "FOLLOW_UP_NOW");
  const monitor = by((i) => i.action === "MONITOR");
  const hold = by((i) => i.action === "HOLD");
  const quiet = input.items.filter((i) => i.assessmentStatus === "QUIET").sort((a, b) => a.firm.localeCompare(b.firm));
  const incomplete = input.items.filter((i) => i.action === "ASSESSMENT_INCOMPLETE").sort((a, b) => a.firm.localeCompare(b.firm));
  const changes = input.items
    .filter((i) => i.prevAction !== null && (i.prevAction !== i.action || Math.abs((i.score ?? 0) - (i.prevScore ?? 0)) >= 10))
    .sort((a, b) => Math.abs((b.score ?? 0) - (b.prevScore ?? 0)) - Math.abs((a.score ?? 0) - (a.prevScore ?? 0)))
    .slice(0, 8);

  const link = (slug: string) => `${input.baseUrl.replace(/\/$/, "")}/vc/${slug}`;
  const sections: BuiltDigest["sections"] = [];
  const add = (section: Section, list: DigestItem[]) => list.forEach((i, idx) => sections.push({ section, recommendationId: i.recommendationId, rank: idx + 1 }));
  add("REACH_OUT_NOW", reachOut); add("FOLLOW_UP_NOW", followUp); add("MONITOR", monitor); add("HOLD", hold); add("QUIET", quiet); add("CHANGES", changes); add("INCOMPLETE", incomplete);

  const row = (i: DigestItem, withHold = false) => {
    const src = safeUrl(i.sourceUrl);
    return `<tr><td style="padding:12px 0;border-top:1px solid #e3e8e6">
      <div><a href="${esc(link(i.slug))}" style="color:#0f766e;font-weight:700;text-decoration:none;font-size:16px">${esc(i.firm)}</a>
      <span style="color:#0e1f2b;font-weight:700"> · ${i.score ?? "–"}</span>
      ${withHold && i.holdReason ? `<span style="color:#5e7280"> · hold: ${esc(HOLD_TEXT[i.holdReason] ?? i.holdReason)}</span>` : ""}</div>
      <div style="color:#2b3f4d;font-size:14px;margin-top:4px">${esc(whyNow(i))}</div>
      ${src ? `<div style="margin-top:4px;font-size:12px"><a href="${esc(src)}" style="color:#5e7280">Source: ${esc(i.sourceDomain ?? "link")}${i.eventDate ? ` · ${esc(i.eventDate)}` : ""}</a></div>` : ""}
    </td></tr>`;
  };
  const block = (title: string, list: DigestItem[], withHold = false) =>
    list.length === 0 ? "" : `<h2 style="font-size:18px;margin:24px 0 4px;color:#0e1f2b">${esc(title)} <span style="color:#5e7280;font-weight:400">(${list.length})</span></h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${list.map((i) => row(i, withHold)).join("")}</table>`;

  const quietBlock = quiet.length === 0 ? "" : `<h2 style="font-size:18px;margin:24px 0 4px;color:#0e1f2b">Quiet investors <span style="color:#5e7280;font-weight:400">(${quiet.length})</span></h2>
    <p style="font-size:14px;color:#2b3f4d;margin:4px 0">${esc(input.quietCopy)}</p>
    <p style="font-size:13px;color:#5e7280;margin:4px 0">${quiet.map((q) => esc(q.firm)).join(", ")}</p>`;
  const changeBlock = changes.length === 0 ? "" : `<h2 style="font-size:18px;margin:24px 0 4px;color:#0e1f2b">Priority changes</h2><ul style="padding-left:18px;margin:4px 0;font-size:14px;color:#2b3f4d">${changes.map((c) => `<li><a href="${esc(link(c.slug))}" style="color:#0f766e;text-decoration:none">${esc(c.firm)}</a>: ${esc(ACTION_LABEL[c.prevAction ?? ""] ?? c.prevAction ?? "–")} (${c.prevScore ?? "–"}) → ${esc(ACTION_LABEL[c.action] ?? c.action)} (${c.score ?? "–"})</li>`).join("")}</ul>`;
  const incompleteBlock = incomplete.length === 0 ? "" : `<p style="font-size:13px;color:#9a3412;background:#ffedd5;padding:10px 12px;border-radius:10px;margin:20px 0 0">${incomplete.length} investor${incomplete.length === 1 ? "" : "s"} could not be fully checked (${esc(incomplete.slice(0, 6).map((i) => i.firm).join(", "))}${incomplete.length > 6 ? ", …" : ""}). ${esc(input.incompleteCopy)}</p>`;

  const nothing = reachOut.length + followUp.length === 0 ? `<p style="font-size:15px;color:#2b3f4d">No investor has a strong, fresh, relevant signal right now. Quiet is not a failure.</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f4;font-family:Inter,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:20px">
  <div style="background:#fff;border-radius:20px;padding:24px">
    <div style="font-size:20px;font-weight:700;color:#0f766e">${esc(BRAND.name)}</div>
    <div style="font-size:13px;color:#5e7280">${esc(BRAND.tagline)} · run ${esc(input.runKey)}</div>
    <p style="font-size:12px;color:#5e7280;background:#f3f5f4;padding:8px 10px;border-radius:10px;margin:14px 0 0">Signals are live from the last 30 days, each with a dated source. Contact status and notes shown in the app are demo data. Scores and actions are computed by code, not by AI.</p>
    ${nothing}${block("Reach out now", reachOut)}${block("Follow up now", followUp)}${block("Monitor", monitor)}${block("Hold", hold, true)}${quietBlock}${changeBlock}${incompleteBlock}
    <p style="margin-top:24px;font-size:12px;color:#5e7280"><a href="${esc(input.baseUrl)}" style="color:#0f766e">Open ${esc(BRAND.name)}</a></p>
  </div></div></body></html>`;

  const t = (title: string, list: DigestItem[], withHold = false) =>
    list.length === 0 ? "" : `\n${title.toUpperCase()} (${list.length})\n${list.map((i) => `- ${i.firm} (${i.score ?? "–"})${withHold && i.holdReason ? ` [hold: ${HOLD_TEXT[i.holdReason] ?? i.holdReason}]` : ""}: ${whyNow(i)}${safeUrl(i.sourceUrl) ? `\n  ${i.sourceUrl}` : ""}\n  ${link(i.slug)}`).join("\n")}\n`;
  const text = `${BRAND.name}: ${BRAND.tagline}\nRun ${input.runKey}\nSignals are live from the last 30 days with dated sources. Contact status and notes in the app are demo data. Scores and actions are computed by code.\n${reachOut.length + followUp.length === 0 ? "\nNo investor has a strong, fresh, relevant signal right now.\n" : ""}${t("Reach out now", reachOut)}${t("Follow up now", followUp)}${t("Monitor", monitor)}${t("Hold", hold, true)}${quiet.length ? `\nQUIET INVESTORS (${quiet.length})\n${input.quietCopy}\n${quiet.map((q) => q.firm).join(", ")}\n` : ""}${changes.length ? `\nPRIORITY CHANGES\n${changes.map((c) => `- ${c.firm}: ${ACTION_LABEL[c.prevAction ?? ""] ?? c.prevAction} (${c.prevScore ?? "–"}) -> ${ACTION_LABEL[c.action] ?? c.action} (${c.score ?? "–"})`).join("\n")}\n` : ""}${incomplete.length ? `\n${incomplete.length} investor(s) could not be fully checked. ${input.incompleteCopy}\n` : ""}\n${input.baseUrl}\n`;

  return {
    subject: subjectFor(input.runDate, reachOut.length, followUp.length),
    html,
    text,
    sections,
    counts: { reachOut: reachOut.length, followUp: followUp.length, monitor: monitor.length, hold: hold.length, quiet: quiet.length, incomplete: incomplete.length, changes: changes.length },
  };
}
