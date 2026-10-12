export type RelevanceTier = "direct" | "adjacent" | "b2b_saas" | "broad" | "none";

export type SignalType =
  | "investment" | "portfolio_activity" | "fund_news" | "blog_post" | "thesis_update"
  | "interview" | "podcast" | "conference" | "news_mention" | "team_news" | "other";

export type Commitment = "confirmed" | "reported" | "rumor" | "discussion" | "not_applicable";

export type ContactStatus = "TO_REACH_OUT" | "WAITING_FOR_RESPONSE" | "IN_CONVERSATION" | "MEETING_SCHEDULED" | "PASSED";

export type AssessmentStatus = "SIGNAL_FOUND" | "QUIET" | "PARTIAL" | "FAILED";

export type RecommendedAction =
  | "REACH_OUT_NOW" | "FOLLOW_UP_NOW" | "MONITOR" | "HOLD" | "DONT_PRIORITIZE" | "ASSESSMENT_INCOMPLETE";

export type HoldReason = "RECENT_CONTACT" | "AWAITING_RESPONSE" | "RECONNECT_DATE" | "ACTIVE_CONVERSATION";

/** A validated, in-window-candidate signal as the scoring engine sees it. Dates are ISO yyyy-mm-dd. */
export interface ScoringSignal {
  id: string;
  event_date: string;
  signal_type: SignalType;
  relevance_tier: RelevanceTier;
  commitment?: Commitment;
  source_type: string;
  date_basis: string;
  excerpt_verified: boolean;
  is_synthetic?: boolean;
  independent_source_count?: number;
  url_ok?: boolean;
}

export interface FundProfile {
  stage_focus: string | null;
  sector_tags: string[];
  hq_region: string | null;
}

export interface Relationship {
  contact_status: ContactStatus;
  last_contact_date: string | null;
  reconnect_after: string | null;
}

export interface FundFit {
  stage: number;
  sector: number;
  geo: number;
  total: number;
}

export interface SignalPoints {
  relevance: number;
  recency: number;
  strength: number;
  evidence_quality: number;
  sum: number;
  age_days: number;
}

export interface ScoreBreakdown {
  relevance: number;
  recency: number;
  strength: number;
  corroboration: number;
  evidence_quality: number;
  fund_fit: number;
}

export interface ScoreResult {
  qualifying: number;
  follow_up_score: number | null;
  fit: FundFit;
  top: ScoringSignal | null;
  breakdown: ScoreBreakdown | null;
  last_signal_date: string | null;
}

export interface Decision {
  action: RecommendedAction;
  hold_reason: HoldReason | null;
  reason_code: string;
}
