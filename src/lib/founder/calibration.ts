/**
 * Calibration statistics. Pure functions so the honesty rules are testable:
 *  - every figure is shown with its sample size (n)
 *  - fewer than MIN_SAMPLES => "too few to conclude"
 *  - the copy never claims the system "learns": feedback is stored for the founder's review and never changes scores or data.
 */
export const MIN_SAMPLES = 20;

export interface FeedbackRow {
  vote: "POSITIVE" | "NEGATIVE";
  reasons: string[];
}

export interface OutcomeRow {
  outcome: "RESPONSE_RECEIVED" | "MEETING_BOOKED" | "PASSED" | "NO_RESPONSE";
}

export function summarizeFeedback(rows: FeedbackRow[]) {
  const n = rows.length;
  const positive = rows.filter((r) => r.vote === "POSITIVE").length;
  const negative = n - positive;
  const byReason: Record<string, number> = {};
  for (const r of rows) if (r.vote === "NEGATIVE") for (const reason of r.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
  const reasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  return { n, positive, negative, reasons, enough: n >= MIN_SAMPLES, usefulRate: n === 0 ? null : positive / n };
}

export function summarizeOutcomes(rows: OutcomeRow[]) {
  const n = rows.length;
  const count = (o: OutcomeRow["outcome"]) => rows.filter((r) => r.outcome === o).length;
  const responses = count("RESPONSE_RECEIVED") + count("MEETING_BOOKED");
  return {
    n,
    response: count("RESPONSE_RECEIVED"),
    meeting: count("MEETING_BOOKED"),
    passed: count("PASSED"),
    noResponse: count("NO_RESPONSE"),
    responseRate: n === 0 ? null : responses / n,
    enough: n >= MIN_SAMPLES,
  };
}

export const REASON_LABEL: Record<string, string> = {
  WRONG_RELEVANCE: "Not relevant to my business",
  WRONG_ATTRIBUTION: "Wrong investor or person",
  SIGNAL_TOO_WEAK: "Signal too weak",
  SIGNAL_TOO_OLD: "Signal too old",
  SOURCE_UNRELIABLE: "Source unreliable",
  SCORE_TOO_HIGH: "Score too high",
  SCORE_TOO_LOW: "Score too low",
  RELATIONSHIP_MISUNDERSTOOD: "Misread my relationship",
  OTHER: "Other",
};
