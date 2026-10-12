import type { ScoringConfig } from "@/lib/config";
import type { FundFit, FundProfile, ScoreResult, ScoringSignal, SignalPoints } from "./types";

/**
 * Deterministic scoring. Port of scripts/reference_engine.py: every number comes from config/scoring.v1.json,
 * rounding is round-half-up per component, and the operation order is kept identical to the reference so the
 * floating-point results match the golden vectors exactly.
 */
export const roundHalfUp = (x: number) => Math.floor(x + 0.5);

const MS_PER_DAY = 86_400_000;

/** Whole days from isoA to isoB (positive when isoB is later). Dates are yyyy-mm-dd, compared in UTC. */
export function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`daysBetween: invalid date ${isoA} / ${isoB}`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Age of an event relative to the run date (negative = future). */
export const ageDays = (sig: { event_date: string }, today: string) => daysBetween(sig.event_date, today);

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`scoring config is missing ${what}`);
  return v;
}

export function qualifies(sig: ScoringSignal, today: string, cfg: ScoringConfig): boolean {
  const age = ageDays(sig, today);
  if (age < -cfg.future_date_tolerance_days) return false; // future-dated never qualifies
  return age <= cfg.window_days && sig.relevance_tier !== "none";
}

export function signalPoints(sig: ScoringSignal, today: string, cfg: ScoringConfig): SignalPoints {
  const age = Math.max(0, ageDays(sig, today));
  const tier = sig.relevance_tier;
  const relevance = roundHalfUp(cfg.max_points.relevance * need(cfg.relevance_tier_weight[tier], `relevance_tier_weight.${tier}`));
  const damp = need(cfg.relevance_damping.by_tier[tier], `relevance_damping.by_tier.${tier}`);
  const recency = Math.max(
    cfg.recency.min_points_if_in_window,
    roundHalfUp(cfg.max_points.recency * (1 - age / cfg.window_days) * damp),
  );
  const S = cfg.strength;
  let commitmentMult = 1.0;
  if (S.commitment_types.includes(sig.signal_type)) {
    commitmentMult = need(S.commitment_multiplier[sig.commitment ?? "confirmed"], `strength.commitment_multiplier.${sig.commitment}`);
  }
  const strength = roundHalfUp(
    need(S.base_by_signal_type[sig.signal_type], `strength.base_by_signal_type.${sig.signal_type}`) *
      need(S.multiplier_by_relevance_tier[tier], `strength.multiplier_by_relevance_tier.${tier}`) *
      commitmentMult,
  );
  const E = cfg.evidence_quality;
  let evidence =
    need(E.source_type_points[sig.source_type], `evidence_quality.source_type_points.${sig.source_type}`) +
    need(E.date_basis_points[sig.date_basis], `evidence_quality.date_basis_points.${sig.date_basis}`) +
    (sig.excerpt_verified ? E.excerpt_verified_points : 0) +
    ((sig.url_ok ?? true) ? E.url_ok_points : 0);
  evidence = roundHalfUp(evidence * damp); // irrelevant activity gets less credit for being well sourced
  if (sig.is_synthetic) evidence = Math.min(evidence, E.synthetic_cap);
  return { relevance, recency, strength, evidence_quality: evidence, sum: relevance + recency + strength + evidence, age_days: age };
}

export function corroboration(qualifying: ScoringSignal[], top: ScoringSignal, cfg: ScoringConfig): number {
  const C = cfg.corroboration;
  const n = qualifying.filter((s) => C.counts_tiers.includes(s.relevance_tier)).length;
  let pts = Math.min(C.max_from_events, C.per_additional_independent_event * Math.max(n - 1, 0));
  if ((top.independent_source_count ?? 1) >= 2) pts += C.bonus_if_top_event_has_2plus_independent_sources;
  return Math.min(cfg.max_points.corroboration, pts);
}

/** Unknown stays unknown: no stage/sector/geography data yields the configured neutral points, never an invented fact. */
export function fundFit(fund: FundProfile, companyGeo: string | null, cfg: ScoringConfig): FundFit {
  const F = cfg.fund_fit;
  const stage = F.stage_points[fund.stage_focus ?? "UNKNOWN"] ?? need(F.stage_points.UNKNOWN, "fund_fit.stage_points.UNKNOWN");
  const known = (fund.sector_tags ?? []).map((t) => F.sector_points[t]).filter((p): p is number => p !== undefined);
  const sector = known.length ? Math.max(...known) : F.sector_unknown_points;
  const G = F.geo_points;
  let geo: number;
  if (companyGeo === null) geo = G.company_unknown;
  else if (fund.hq_region === "Global" || fund.hq_region === companyGeo) geo = G.match_or_global;
  else geo = G.mismatch;
  return { stage, sector, geo, total: stage + sector + geo };
}

export function score(signals: ScoringSignal[], fund: FundProfile, companyGeo: string | null, today: string, cfg: ScoringConfig): ScoreResult {
  const q = signals.filter((s) => qualifies(s, today, cfg));
  const fit = fundFit(fund, companyGeo, cfg);
  if (q.length === 0) {
    return { qualifying: 0, follow_up_score: null, fit, top: null, breakdown: null, last_signal_date: null };
  }
  const scored = q.map((s) => ({ pts: signalPoints(s, today, cfg), s }));
  // top = highest sum; tie -> newer event; tie -> more independent sources (first wins on a full tie, like Python's max)
  let best = scored[0]!;
  for (const c of scored.slice(1)) {
    const a = [c.pts.sum, c.s.event_date, c.s.independent_source_count ?? 1] as const;
    const b = [best.pts.sum, best.s.event_date, best.s.independent_source_count ?? 1] as const;
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) best = c;
  }
  const corr = corroboration(q, best.s, cfg);
  const total = best.pts.sum + corr + fit.total;
  return {
    qualifying: q.length,
    follow_up_score: total,
    fit,
    top: best.s,
    breakdown: {
      relevance: best.pts.relevance,
      recency: best.pts.recency,
      strength: best.pts.strength,
      corroboration: corr,
      evidence_quality: best.pts.evidence_quality,
      fund_fit: fit.total,
    },
    last_signal_date: q.map((s) => s.event_date).reduce((a, b) => (a > b ? a : b)),
  };
}
