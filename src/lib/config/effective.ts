import { loadScoring, scoringSchema, type ScoringConfig } from "./index";

/**
 * Editable scoring rubric. The defaults stay in config/scoring.v1.json (and reproduce config/golden_vectors.json).
 * The founder can override individual NUMBERS from Settings; overrides are stored in app_settings ('scoring_overrides')
 * and layered on top of the defaults at the start of each run. The engine itself is unchanged: it still just receives a config.
 * Gemini never sees or changes any of this.
 */
export type Overrides = Record<string, number>;
export interface StoredOverrides {
  values: Overrides;
  revision: number;
}

export interface Group {
  key: string;
  title: string;
  hint: string;
  /** dotted path prefix; every numeric leaf below it is one editable row */
  prefix: string;
  /** upper bound for rows in this group (weights are fractions) */
  max?: number;
}

export const GROUPS: Group[] = [
  { key: "max_points", title: "Points per factor", hint: "How many of the 100 points each factor can earn. Must add up to 100.", prefix: "max_points" },
  { key: "relevance", title: "Relevance weight by tier", hint: "How much a signal counts by how close it is to your business (1 = fully).", prefix: "relevance_tier_weight", max: 1 },
  { key: "strength", title: "Signal strength by type", hint: "Base points for each kind of signal. An investment outranks a mention.", prefix: "strength.base_by_signal_type" },
  { key: "strength_mult", title: "Strength multiplier by tier", hint: "Scales the strength points by relevance tier.", prefix: "strength.multiplier_by_relevance_tier", max: 1 },
  { key: "commit", title: "Strength multiplier by certainty", hint: "Confirmed, reported or rumoured deals.", prefix: "strength.commitment_multiplier", max: 1 },
  { key: "damping", title: "Recency and evidence damping by tier", hint: "Fresh but irrelevant activity must not look like an opportunity.", prefix: "relevance_damping.by_tier", max: 1 },
  { key: "corro", title: "Corroboration", hint: "Extra points when independent sources agree.", prefix: "corroboration" },
  { key: "evidence_src", title: "Evidence quality: source type", hint: "Points by where the evidence comes from.", prefix: "evidence_quality.source_type_points" },
  { key: "evidence_date", title: "Evidence quality: how the date was found", hint: "Points by how reliable the date is.", prefix: "evidence_quality.date_basis_points" },
  { key: "fund_stage", title: "Fund fit: stage", hint: "Does the fund invest at your stage.", prefix: "fund_fit.stage_points" },
  { key: "fund_sector", title: "Fund fit: sector", hint: "Does the fund invest in your sector.", prefix: "fund_fit.sector_points" },
  { key: "fund_geo", title: "Fund fit: geography", hint: "Region match.", prefix: "fund_fit.geo_points" },
  { key: "actions", title: "When to act", hint: "Score needed for each action and the waiting rules (days).", prefix: "actions" },
];

const EXTRA_PATHS = ["recency.min_points_if_in_window", "evidence_quality.excerpt_verified_points", "evidence_quality.url_ok_points", "evidence_quality.synthetic_cap", "fund_fit.sector_unknown_points"];
const GROUP_EXTRA: Record<string, string[]> = {
  corro: ["corroboration.per_additional_independent_event", "corroboration.max_from_events", "corroboration.bonus_if_top_event_has_2plus_independent_sources"],
  actions: ["actions.reach_out_now_min_score", "actions.follow_up_now_min_score", "actions.monitor_min_score", "actions.waiting_cooldown_days", "actions.overdue_follow_up_days", "actions.reach_out_max_signal_age_days", "actions.gate_min_stage_points"],
};

const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
function set(o: Record<string, unknown>, path: string, v: unknown) {
  const ks = path.split(".");
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[ks[ks.length - 1]!] = v;
}

export interface Row {
  path: string;
  label: string;
  value: number;
  base: number;
}
export interface GroupRows extends Group {
  rows: Row[];
}

const pretty = (s: string) => s.replaceAll("_", " ");
const rowLabel = (p: string) => pretty(p.split(".").slice(-1)[0]!);

/** Every editable number, grouped, with the default alongside. */
export function editableGroups(effective: ScoringConfig, defaults: ScoringConfig = loadScoring()): GroupRows[] {
  return GROUPS.map((g) => {
    const paths = g.key in GROUP_EXTRA ? GROUP_EXTRA[g.key]! : Object.keys((get(effective, g.prefix) as Record<string, unknown>) ?? {}).map((k) => `${g.prefix}.${k}`);
    const rows = paths
      .filter((p) => typeof get(effective, p) === "number")
      .map((p) => ({ path: p, label: rowLabel(p), value: get(effective, p) as number, base: get(defaults, p) as number }));
    return { ...g, rows };
  }).concat([{ key: "other", title: "Other points", hint: "Small fixed rules.", prefix: "", rows: EXTRA_PATHS.map((p) => ({ path: p, label: rowLabel(p), value: get(effective, p) as number, base: get(loadScoring(), p) as number })).filter((r) => typeof r.value === "number") }]);
}

const editable = (defaults: ScoringConfig): Set<string> => {
  const all = new Set<string>();
  for (const g of editableGroups(defaults, defaults)) for (const r of g.rows) all.add(r.path);
  return all;
};
const maxFor = (path: string): number | undefined => GROUPS.find((g) => g.prefix && path.startsWith(`${g.prefix}.`))?.max;

export type ApplyResult = { ok: true; scoring: ScoringConfig } | { ok: false; error: string };

/** Layer overrides on the defaults and validate. Unknown paths, non-numbers, negatives and impossible combinations are refused. */
export function applyOverrides(stored: StoredOverrides | null | undefined, defaults: ScoringConfig = loadScoring()): ApplyResult {
  if (!stored || Object.keys(stored.values).length === 0) return { ok: true, scoring: defaults };
  const allowed = editable(defaults);
  const next = structuredClone(defaults) as Record<string, unknown>;
  for (const [path, v] of Object.entries(stored.values)) {
    if (!allowed.has(path)) return { ok: false, error: `${path} cannot be edited` };
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, error: `${rowLabel(path)} must be a number, 0 or more` };
    const cap = maxFor(path);
    if (cap !== undefined && v > cap) return { ok: false, error: `${rowLabel(path)} must be between 0 and ${cap}` };
    if (v > 1000) return { ok: false, error: `${rowLabel(path)} is too large` };
    set(next, path, v);
  }
  const parsed = scoringSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: "the resulting rubric is invalid" };
  const s = parsed.data;
  const total = Object.values(s.max_points).reduce<number>((a, b) => a + (typeof b === "number" ? b : 0), 0);
  if (total !== 100) return { ok: false, error: `points per factor must add up to 100 (now ${total})` };
  const a = s.actions;
  if (!(a.reach_out_now_min_score >= a.follow_up_now_min_score && a.follow_up_now_min_score >= a.monitor_min_score && a.reach_out_now_min_score <= 100)) {
    return { ok: false, error: "thresholds must satisfy: reach out >= follow up >= monitor, and reach out <= 100" };
  }
  s.version = `${defaults.version}+custom.${stored.revision}`;
  return { ok: true, scoring: s };
}

/** Parse what is in the database; anything malformed is ignored (defaults apply). */
export function parseStored(raw: unknown): StoredOverrides | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { values?: unknown; revision?: unknown };
  if (!r.values || typeof r.values !== "object") return null;
  const values: Overrides = {};
  for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) if (typeof v === "number") values[k] = v;
  return { values, revision: typeof r.revision === "number" ? r.revision : 1 };
}
