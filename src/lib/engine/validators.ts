import type { SourcesConfig, TaxonomyConfig } from "@/lib/config";
import { isSameEvent, type EventLike, shingleSimilarity, SIMILARITY_THRESHOLD, isSyndicator, registrableDomain } from "./dedupe";
import { checkUrlSyntax } from "./ssrf";
import { checkWindow, isResurfaced, reconcileEventDate } from "./dates";
import { entityMatch, roleIsActivity, type AliasIndex } from "./entities";
import { EventSchema } from "./eventSchema";
import { crossCheckTier } from "./taxonomy";
import type { RelevanceTier } from "./types";

/**
 * V1-V15 from docs/01 section 3. Each validator is a pure function returning {ok, code, detail}.
 * Every rejected candidate is stored (with its code) for the Run Audit: rejection is a feature, not clutter.
 */
export type RejectCode =
  | "SSRF_BLOCKED" | "FETCH_FAILED" | "DATE_UNVERIFIED" | "DATE_INCOHERENT" | "OLD_EVENT" | "FUTURE_DATE"
  | "AMBIGUOUS_ENTITY" | "NOT_ATTRIBUTABLE" | "QUOTE_NOT_FOUND" | "IRRELEVANT" | "INVALID_MODEL_OUTPUT"
  | "SYNTHETIC" | "DUPLICATE_SYNDICATED" | "LANGUAGE_UNSUPPORTED";

export type Verdict<T extends object = object> = ({ ok: true; code?: undefined; detail?: string } & T) | { ok: false; code: RejectCode; detail: string };

const pass = <T extends object>(extra?: T, detail?: string): Verdict<T> => ({ ok: true, detail, ...(extra ?? ({} as T)) });
const fail = (code: RejectCode, detail: string): { ok: false; code: RejectCode; detail: string } => ({ ok: false, code, detail });

/** V1 - URL is http(s), host not on never_fetch, not an internal/private address (literal forms; DNS is re-checked by the fetcher). */
export function v1Url(url: string, sources: SourcesConfig) {
  const r = checkUrlSyntax(url, { allowedSchemes: sources.fetch.allowed_schemes, neverFetch: sources.domain_classes.never_fetch });
  return r.ok ? pass() : fail("SSRF_BLOCKED", r.detail);
}

/** V2 - HTTP 200 and at least 400 chars of article text. */
export function v2Fetch(res: { status: number; text: string }, minChars = 400) {
  if (res.status !== 200) return fail("FETCH_FAILED", `HTTP ${res.status}`);
  if (res.text.trim().length < minChars) return fail("FETCH_FAILED", `only ${res.text.trim().length} chars of text (< ${minChars}); paywall or empty page`);
  return pass();
}

/** V3 - the date ladder produced a date. dateModified / retrieval time never count. */
export function v3DateResolved(resolved: { date: string } | null) {
  return resolved ? pass({ date: resolved.date }) : fail("DATE_UNVERIFIED", "no rung of the date ladder produced a date");
}

/** V4 - model event_date vs published date coherence (see dates.reconcileEventDate). */
export function v4DateCoherence(modelEventDate: string | null, publishedDate: string) {
  const r = reconcileEventDate(modelEventDate, publishedDate);
  return r.ok ? pass({ eventDate: r.eventDate, capped: r.capped }) : fail(r.code, `model event_date ${modelEventDate} is after published date ${publishedDate}`);
}

/** V5 - -tolerance <= age <= window. */
export function v5Window(eventDate: string, runDate: string, cfg: { window_days: number; future_date_tolerance_days: number }) {
  const r = checkWindow(eventDate, runDate, cfg.window_days, cfg.future_date_tolerance_days);
  return r.ok ? pass({ ageDays: r.ageDays }) : fail(r.code!, `age ${r.ageDays} days (window ${cfg.window_days}, future tolerance ${cfg.future_date_tolerance_days})`);
}

/** V6 - resurfaced page: old datePublished but recent dateModified is OLD. */
export function v6NotResurfaced(published: string | null, modified: string | null, runDate: string, windowDays: number) {
  return isResurfaced(published, modified, runDate, windowDays)
    ? fail("OLD_EVENT", `published ${published} but modified ${modified}: an old article resurfacing`)
    : pass();
}

/** V7 - the document is really about this VC (alias rules, collision list, context words). */
export function v7Entity(doc: { title: string; text: string }, vcId: string, index: AliasIndex) {
  const r = entityMatch(doc, vcId, index);
  return r.ok ? pass({ mentions: r.mentions }) : fail(r.code, r.detail);
}

/** V8 - the VC role must be real activity. mentioned_only / unknown is not activity. */
export function v8Role(role: string, isVcActivity = true) {
  if (!isVcActivity) return fail("NOT_ATTRIBUTABLE", "model says this is not VC activity");
  return roleIsActivity(role) ? pass() : fail("NOT_ATTRIBUTABLE", `role "${role}" is not investor activity`);
}

/** Quote normalisation: NFKC, curly quotes/dashes/nbsp to ASCII, collapse whitespace, lower-case. */
export function normalizeQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** V9 - evidence_excerpt is at most 300 chars and appears (whitespace/case/quote-normalised) in the fetched text. */
export function v9Quote(excerpt: string, fetchedText: string) {
  if (excerpt.trim().length === 0) return fail("QUOTE_NOT_FOUND", "empty excerpt");
  if (excerpt.length > 300) return fail("QUOTE_NOT_FOUND", `excerpt is ${excerpt.length} chars (max 300)`);
  return normalizeQuote(fetchedText).includes(normalizeQuote(excerpt)) ? pass() : fail("QUOTE_NOT_FOUND", "excerpt not found in the fetched text");
}

/** V10 - relevance tier is not "none" after the keyword cross-check, which may only downgrade. */
export function v10Relevance(modelTier: RelevanceTier, text: string, tax: TaxonomyConfig) {
  const c = crossCheckTier(modelTier, text, tax);
  return c.tier === "none" ? fail("IRRELEVANT", "relevance tier none") : pass({ tier: c.tier, downgraded: c.downgraded });
}

/** V11 - model JSON validates against the zod schema (the caller owns the single repair retry). */
export function v11Schema(raw: unknown) {
  const r = EventSchema.safeParse(raw);
  return r.success
    ? pass({ event: r.data })
    : fail("INVALID_MODEL_OUTPUT", r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
}

/** V12 - live evidence is never synthetic; synthetic data can never be counted as live. */
export function v12NotSynthetic(isSynthetic: boolean) {
  return isSynthetic ? fail("SYNTHETIC", "synthetic data cannot be live evidence") : pass();
}

/** V13 - duplicate / syndicated copy of an already-accepted event: merged as supporting source, never counted as independent. */
export function v13Duplicate(
  candidate: EventLike & { url: string; text: string },
  accepted: Array<EventLike & { url: string; text: string }>,
  syndicators: string[],
) {
  for (const a of accepted) {
    const sameEvent = isSameEvent(candidate, a);
    const nearCopy = shingleSimilarity(candidate.text, a.text) >= SIMILARITY_THRESHOLD;
    if (sameEvent || nearCopy) {
      const independent = registrableDomain(candidate.url) !== registrableDomain(a.url) && !isSyndicator(candidate.url, syndicators) && !nearCopy;
      return fail("DUPLICATE_SYNDICATED", `same event as ${a.url}${independent ? " (independent supporting source)" : " (not independent)"}`);
    }
  }
  return pass();
}

const INVESTMENT_LIKE = new Set(["investment", "portfolio_activity"]);

/** V14 - investment-type signals need a non-empty subject_entity that appears in the text. */
export function v14Subject(signalType: string, subjectEntity: string | null, text: string) {
  if (!INVESTMENT_LIKE.has(signalType)) return pass();
  if (!subjectEntity || !subjectEntity.trim()) return fail("NOT_ATTRIBUTABLE", "investment signal without a subject entity");
  return normalizeQuote(text).includes(normalizeQuote(subjectEntity)) ? pass() : fail("NOT_ATTRIBUTABLE", `subject "${subjectEntity}" not found in the text`);
}

const EN_STOP = new Set(["the", "and", "of", "to", "in", "for", "is", "on", "with", "that", "as", "by", "from", "at", "an", "it", "its", "has", "have", "was", "are", "will", "this", "their", "which", "also", "said"]);

/** V15 - English only: mostly Latin script and a healthy share of common English function words. */
export function v15Language(text: string) {
  const sample = text.slice(0, 4000);
  const letters = sample.match(/\p{L}/gu) ?? [];
  if (letters.length < 40) return fail("LANGUAGE_UNSUPPORTED", "too little text to detect language");
  const latin = letters.filter((c) => /[A-Za-zÀ-ɏ]/.test(c)).length / letters.length;
  const words = sample.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = words.filter((w) => EN_STOP.has(w)).length / Math.max(words.length, 1);
  return latin >= 0.9 && stop >= 0.08 ? pass() : fail("LANGUAGE_UNSUPPORTED", `latin ${(latin * 100).toFixed(0)}%, english stop-words ${(stop * 100).toFixed(0)}%`);
}
