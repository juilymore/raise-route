import type { ScoringConfig } from "@/lib/config";
import { daysBetween } from "./scoring";
import type { AssessmentStatus, Decision, Relationship, ScoreResult } from "./types";

/**
 * Relationship-aware action engine: first matching rule wins (docs/03 section 3). Port of reference_engine.decide().
 * Score and action are different things; this function never changes the score.
 */
export function decide(
  res: ScoreResult,
  rel: Relationship,
  today: string,
  assessment: AssessmentStatus,
  cfg: ScoringConfig,
): Decision {
  const A = cfg.actions;
  const st = rel.contact_status;
  const last = rel.last_contact_date;
  const rc = rel.reconnect_after;
  const days = last ? daysBetween(last, today) : null;
  const top = res.top;
  const s = res.follow_up_score;
  const has = res.qualifying > 0 && top !== null && s !== null;

  if (assessment === "FAILED" || (assessment === "PARTIAL" && !has)) {
    return { action: "ASSESSMENT_INCOMPLETE", hold_reason: null, reason_code: "INCOMPLETE" };
  }

  const strongOk =
    has &&
    A.gate_tiers.includes(top.relevance_tier) &&
    (top.excerpt_verified || !A.gate_require_excerpt_verified) &&
    res.fit.stage >= A.gate_min_stage_points &&
    !top.is_synthetic &&
    !(top.commitment !== undefined && A.gate_disallow_commitments.includes(top.commitment)) &&
    daysBetween(top.event_date, today) <= A.reach_out_max_signal_age_days;
  const monitorOk = has && A.monitor_requires_tiers.includes(top.relevance_tier);
  const score = s ?? 0;

  if (st === "PASSED") {
    if (rc && today >= rc && has && score >= A.reach_out_now_min_score && strongOk) {
      return { action: "MONITOR", hold_reason: null, reason_code: "REOPEN_WINDOW" };
    }
    return { action: "DONT_PRIORITIZE", hold_reason: null, reason_code: "PASSED" };
  }
  if (rc && rc > today) return { action: "HOLD", hold_reason: "RECONNECT_DATE", reason_code: "RECONNECT_DATE" };

  if (st === "IN_CONVERSATION" || st === "MEETING_SCHEDULED") {
    const hook = has && score >= A.follow_up_now_min_score && strongOk;
    return {
      action: "HOLD",
      hold_reason: "ACTIVE_CONVERSATION",
      reason_code: hook ? "ACTIVE_CONVERSATION_WITH_HOOK" : "ACTIVE_CONVERSATION",
    };
  }

  if (st === "WAITING_FOR_RESPONSE") {
    if (days === null) return { action: "HOLD", hold_reason: "AWAITING_RESPONSE", reason_code: "AWAITING_RESPONSE" };
    if (days < A.waiting_cooldown_days) return { action: "HOLD", hold_reason: "RECENT_CONTACT", reason_code: "RECENT_CONTACT" };
    if (has && last !== null && top.event_date >= last && score >= A.follow_up_now_min_score && strongOk) {
      return { action: "FOLLOW_UP_NOW", hold_reason: null, reason_code: "NEW_HOOK_SINCE_CONTACT" };
    }
    if (monitorOk && score >= A.monitor_min_score) {
      return { action: "MONITOR", hold_reason: null, reason_code: "WAITING_NO_STRONG_HOOK" };
    }
    return {
      action: "DONT_PRIORITIZE",
      hold_reason: null,
      reason_code: days >= A.overdue_follow_up_days ? "OVERDUE_NO_HOOK" : "NO_HOOK",
    };
  }

  // TO_REACH_OUT
  if (!has) return { action: "DONT_PRIORITIZE", hold_reason: null, reason_code: "QUIET" };
  if (strongOk && score >= A.reach_out_now_min_score) {
    return { action: "REACH_OUT_NOW", hold_reason: null, reason_code: "STRONG_RELEVANT_SIGNAL" };
  }
  if (monitorOk && score >= A.monitor_min_score) {
    return {
      action: "MONITOR",
      hold_reason: null,
      reason_code: score >= A.reach_out_now_min_score ? "GATE_CAPPED" : "MODERATE_SIGNAL",
    };
  }
  if (!monitorOk) return { action: "DONT_PRIORITIZE", hold_reason: null, reason_code: "GENERIC_ACTIVITY_NOT_RELEVANT" };
  return { action: "DONT_PRIORITIZE", hold_reason: null, reason_code: "WEAK_SIGNAL" };
}
