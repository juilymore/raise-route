import type { ScoringConfig } from "@/lib/config";
import type { Decision, ScoreResult } from "./types";

/**
 * Human-readable explanation of a decision, built ONLY from validated facts and config strings.
 * No model writes this text; nothing here can state something that is not in the inputs.
 */
const REASON_TEXT: Record<string, string> = {
  STRONG_RELEVANT_SIGNAL: "Strong, fresh, relevant activity in the last 30 days and a good stage fit: worth reaching out now.",
  MODERATE_SIGNAL: "Some relevant activity, but not strong enough to prioritise this week.",
  GATE_CAPPED: "High score, but a safety gate stopped it from being REACH OUT NOW (stage fit, rumour, age of the signal, unverified quote or demo data).",
  GENERIC_ACTIVITY_NOT_RELEVANT: "Recent activity found, but it is not about logistics, supply chain or B2B software, so it is not a reason to reach out.",
  WEAK_SIGNAL: "Only a weak signal was found.",
  QUIET: "",
  INCOMPLETE: "",
  PASSED: "This investor passed. Not prioritised unless a reconnect date is reached with a strong new signal.",
  REOPEN_WINDOW: "Reconnect date reached and a strong new signal appeared: worth a look.",
  RECONNECT_DATE: "On hold until the reconnect date you set.",
  ACTIVE_CONVERSATION: "You are in an active conversation. Hold; no new outreach needed.",
  ACTIVE_CONVERSATION_WITH_HOOK: "You are in an active conversation, and this new activity is a natural hook to mention.",
  AWAITING_RESPONSE: "Waiting for a response (no contact date recorded). Hold.",
  RECENT_CONTACT: "You contacted them recently. Give it time before another message.",
  NEW_HOOK_SINCE_CONTACT: "You have been waiting a while, and this investor did something new and relevant after your last contact: a natural reason to follow up.",
  WAITING_NO_STRONG_HOOK: "Waiting for a response; there is activity but no strong new hook yet. Keep an eye on it.",
  NO_HOOK: "Waiting for a response, and nothing new to follow up on.",
  OVERDUE_NO_HOOK: "Waiting more than two weeks with nothing new to follow up on.",
};

export function actionReason(d: Decision, cfg: ScoringConfig): string {
  if (d.reason_code === "QUIET") return cfg.language.quiet;
  if (d.reason_code === "INCOMPLETE") return cfg.language.incomplete;
  return REASON_TEXT[d.reason_code] ?? d.reason_code;
}

/** One sentence: what happened, when, and where it came from. */
export function signalSummary(res: ScoreResult, top: { title: string; event_date: string; primary_source_name?: string | null; primary_source_url: string } | null): string | null {
  if (!top) return null;
  let host = "";
  try {
    host = new URL(top.primary_source_url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  const src = top.primary_source_name || host;
  const more = res.qualifying > 1 ? ` (+${res.qualifying - 1} more signal${res.qualifying > 2 ? "s" : ""})` : "";
  return `${top.title} (${top.event_date}${src ? `, ${src}` : ""})${more}`.slice(0, 400);
}

/** Company geography is free text in Settings. Map it to the single region label the fund data uses, or null (unknown stays unknown). */
export function regionFromGeography(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const first = (pairs: Array<[string, RegExp]>) => {
    let best: { region: string; at: number } | null = null;
    for (const [region, re] of pairs) {
      const m = re.exec(t);
      if (m && (best === null || m.index < best.at)) best = { region, at: m.index };
    }
    return best?.region ?? null;
  };
  return first([
    ["India", /\bindia\b/],
    ["SEA", /southeast asia|south-east asia|\bsea\b|singapore|indonesia|vietnam|thailand|malaysia|philippines/],
    ["US", /\bus\b|\busa\b|united states|north america/],
    ["Europe", /europe|\buk\b|united kingdom|germany|france/],
  ]);
}
