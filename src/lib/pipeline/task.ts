import { createHash } from "node:crypto";
import type { ScoringConfig, SourcesConfig, TaxonomyConfig } from "@/lib/config";
import { actionReason, regionFromGeography, signalSummary } from "@/lib/engine/explain";
import { checkWindow, isResurfaced, mentionsDate, reconcileEventDate, resolveDate, type ResolvedDate } from "@/lib/engine/dates";
import { clusterKey, independentSourceCount, isIndependentSource, isSameEvent, registrableDomain } from "@/lib/engine/dedupe";
import { attributionLevel, entityMatch, type AliasIndex } from "@/lib/engine/entities";
import { decide } from "@/lib/engine/actions";
import { score } from "@/lib/engine/scoring";
import { crossCheckTier, keywordHits } from "@/lib/engine/taxonomy";
import type { AssessmentStatus, ContactStatus, FundProfile, RelevanceTier, ScoringSignal } from "@/lib/engine/types";
import { v14Subject, v15Language, v2Fetch, v8Role, v9Quote } from "@/lib/engine/validators";
import { discoverGrounded, extractEvents, type GeminiClient, type CompanyContext } from "@/lib/gemini";
import { classifySource, selectCandidates, toCandidate } from "@/lib/sources/candidates";
import { discoverOfficialFeed } from "@/lib/sources/discovery";
import { extractArticle } from "@/lib/sources/extract";
import type { SafeFetcher } from "@/lib/sources/fetcher";
import { buildQueries, fetchGoogleNews, newsItemsToCandidates } from "@/lib/sources/googleNews";
import type { SectorItem } from "@/lib/sources/sectorFeeds";
import { sectorItemsToCandidates } from "@/lib/sources/sectorFeeds";
import type { Candidate } from "@/lib/sources/types";
import type { PipelineStore } from "./store";

/**
 * One VC, one run (docs/01 section 2, stage S3). Order of trust:
 *   channels -> candidates stored BEFORE interpretation -> SSRF-safe fetch -> validators -> Gemini extract (no tools)
 *   -> per-event validators (quote, role, date, relevance, dedupe) -> signals -> assessment status -> score + action (pure code)
 *   -> immutable recommendation snapshot -> apply_assessment (the only write to vc_pipeline).
 * Failure is never silence: any failed channel or skipped work becomes PARTIAL/FAILED => ASSESSMENT_INCOMPLETE, never "quiet".
 */
export interface VcInput {
  id: string;
  firm: string;
  website: string | null;
  aliases: string[];
  tracked_people: string[];
  hq_region: string | null;
  stage_focus: string | null;
  sector_tags: string[];
  contact_status: ContactStatus;
  last_contact_date: string | null;
  reconnect_after: string | null;
  is_demo_relationship: boolean;
}

export interface TaskDeps {
  db: PipelineStore;
  fetcher: Pick<SafeFetcher, "fetch">;
  gemini: GeminiClient;
  cfg: { scoring: ScoringConfig; sources: SourcesConfig; taxonomy: TaxonomyConfig };
  aliasIndex: AliasIndex;
  company: CompanyContext & { geography: string | null };
  sector: { byVc: Map<string, SectorItem[]>; allFailed: boolean };
  run: { id: string; today: string; windowStart: string };
  groundingEnabled: boolean;
}

type ChannelState = "ok" | "fail" | "none" | "skipped";
export interface TaskOutcome {
  status: "DONE" | "PARTIAL" | "FAILED";
  assessment: AssessmentStatus;
  action: string;
  stats: Record<string, unknown>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const isoDay = (d: string | null | undefined) => (d ? d.slice(0, 10) : null);

interface Doc {
  id: string;
  candidateId: string;
  url: string;
  title: string;
  text: string;
  resolved: ResolvedDate | null;
  sourceType: string;
  sourceName: string | null;
}

export async function processVc(deps: TaskDeps, vc: VcInput): Promise<TaskOutcome> {
  const { db, fetcher, gemini, cfg, run } = deps;
  const stats: Record<string, unknown> = {};
  const channels: Record<"A" | "B" | "C" | "D", ChannelState> = { A: "none", B: "none", C: "none", D: "skipped" };
  const rejected: Record<string, number> = {};
  const reject = (code: string) => (rejected[code] = (rejected[code] ?? 0) + 1);
  let fetchOk = 0;
  let fetchFailed = 0;
  let extractionIncomplete = false;
  let backlog = 0;
  let unresolvedNews = 0;
  const notes: string[] = [];

  const vcDomains = vc.website ? [vc.website] : [];
  const inWindow = (iso: string | null | undefined) => {
    const d = isoDay(iso);
    if (!d) return true; // unknown dates are decided later by the ladder
    return checkWindow(d, run.today, cfg.scoring.window_days, cfg.scoring.future_date_tolerance_days).ok;
  };
  const all: Candidate[] = [];

  // ---------------------------------------------------------------- channel A: official feed
  try {
    if (vc.website) {
      const d = await discoverOfficialFeed(fetcher as SafeFetcher, cfg.sources, vc.website);
      channels.A = d.feed ? "ok" : d.homepage.ok ? "none" : "fail";
      if (d.feed) {
        for (const it of d.feed.items.filter((i) => inWindow(i.publishedIso)).slice(0, 12)) {
          const c = it.link ? toCandidate({ url: it.link, channel: "official_feed", title: it.title, publishedHint: it.publishedIso ?? it.published, sourceName: "official feed" }) : null;
          if (c) all.push(c);
        }
      }
      await db.recordSourceHealth({
        vcId: vc.id, kind: d.feed ? (d.feed.kind === "youtube_rss" ? "youtube_rss" : d.feed.kind) : "website", url: d.feed?.url ?? d.website, label: `${vc.firm} official`,
        ok: d.feed !== null || d.homepage.ok, httpStatus: d.homepage.status, error: d.feed || d.homepage.ok ? undefined : d.homepage.error,
      }).catch(() => {});
    }
  } catch (e) {
    channels.A = "fail";
    notes.push(`A: ${(e as Error).message}`);
  }

  // ---------------------------------------------------------------- channel B: Google News RSS
  try {
    const queries = buildQueries(cfg.sources, vc.firm, vc.tracked_people.slice(0, 1));
    let okQ = 0;
    for (const q of queries) {
      const gn = await fetchGoogleNews(fetcher as SafeFetcher, cfg.sources, q);
      if (gn.ok) okQ++;
      else notes.push(`B query failed: ${gn.error}`);
      const recent = gn.items.filter((i) => i.publishedIso && inWindow(i.publishedIso)).slice(0, 6);
      const { candidates, unresolved } = await newsItemsToCandidates(recent, {
        get: async (u) => {
          const r = await fetcher.fetch(u, { skipRobots: true });
          return { ok: r.ok, body: r.body };
        },
      });
      unresolvedNews += unresolved.length;
      all.push(...candidates);
    }
    channels.B = okQ > 0 ? "ok" : "fail";
    await db.recordSourceHealth({ vcId: vc.id, kind: "news_query", url: `gnews:${vc.firm}`, label: "Google News", ok: okQ > 0, error: okQ > 0 ? undefined : "all queries failed" }).catch(() => {});
  } catch (e) {
    channels.B = "fail";
    notes.push(`B: ${(e as Error).message}`);
  }

  // ---------------------------------------------------------------- channel C: sector feeds (pushed)
  channels.C = deps.sector.allFailed ? "fail" : "ok";
  const sectorHits = deps.sector.byVc.get(vc.id) ?? [];
  all.push(...sectorItemsToCandidates(sectorHits.filter((i) => inWindow(i.publishedIso))));

  // ---------------------------------------------------------------- channel D: grounded search (budgeted, weak coverage only)
  if (deps.groundingEnabled && all.length < 3 && !gemini.capReached) {
    const g = await discoverGrounded(gemini, { target: { firm: vc.firm, aliases: vc.aliases }, windowStart: run.windowStart, today: run.today, runId: run.id, vcId: vc.id });
    channels.D = g.ok ? "ok" : "fail";
    if (!g.ok) notes.push(`D: ${g.error}`);
    for (const s of g.sources.slice(0, 8)) {
      const c = toCandidate({ url: s.uri, channel: "grounded_search", title: s.title ?? undefined, sourceName: "grounded" });
      if (c) all.push(c);
    }
  }

  // ---------------------------------------------------------------- select, store, fetch
  const known = await db.knownCandidateUrls(vc.id);
  const fresh = all.filter((c) => !known.has(c.canonicalUrl));
  const uniqueFresh = new Set(fresh.map((c) => c.canonicalUrl)).size;
  const selected = selectCandidates(all, { vcDomains, alreadyStored: known, max: cfg.sources.fetch.max_pages_per_vc_per_run, cfg: cfg.sources });
  backlog = Math.max(0, uniqueFresh - selected.length);

  const docs: Doc[] = [];
  for (const c of selected) {
    const sourceType = classifySource(c.url, vcDomains, cfg.sources);
    let candidateId: string;
    try {
      candidateId = await db.upsertCandidate({
        vcId: vc.id, runId: run.id, channel: c.channel, url: c.url, canonicalUrl: c.canonicalUrl, domain: registrableDomain(c.url),
        sourceName: c.sourceName ?? null, sourceType, title: c.title ?? null, publishedAt: isoDay(c.publishedHint), publishedBasis: c.publishedHint ? "feed" : null,
      });
    } catch (e) {
      notes.push(`store candidate failed: ${(e as Error).message}`);
      continue;
    }
    const rej = async (code: string, detail: string, extra: Record<string, unknown> = {}) => {
      reject(code);
      await db.updateCandidate(candidateId, { status: "REJECTED", rejectionCode: code, rejectionDetail: detail, ...extra });
    };

    const r = await fetcher.fetch(c.url);
    if (!r.ok || !/html|xml|text/i.test(r.contentType || "text/html")) {
      fetchFailed++;
      await rej(r.errorCode === "SSRF_BLOCKED" ? "SSRF_BLOCKED" : "FETCH_FAILED", r.error ?? `unsupported content type ${r.contentType}`, { httpStatus: r.status || null });
      continue;
    }
    const art = extractArticle(r.body);
    const v2 = v2Fetch({ status: r.status, text: art.text });
    if (!v2.ok) {
      fetchFailed++;
      await rej("FETCH_FAILED", v2.detail, { httpStatus: r.status, fetchedTextLen: art.text.length });
      continue;
    }
    fetchOk++;
    const resolved = resolveDate({ page: art.dates, feedPublished: c.publishedHint ?? null, url: r.finalUrl });
    const common = { httpStatus: r.status, fetchedTextLen: art.text.length, contentHash: sha256(art.text), publishedAt: resolved?.date ?? null, publishedBasis: resolved ? basisLabel(resolved) : null };
    if (isResurfaced(art.dates.jsonLdPublished ?? art.dates.metaPublished, art.dates.jsonLdModified ?? art.dates.metaModified, run.today, cfg.scoring.window_days)) {
      await rej("OLD_EVENT", "old article resurfacing (old datePublished, recent dateModified)", common);
      continue;
    }
    if (resolved) {
      const w = checkWindow(resolved.date, run.today, 3650, cfg.scoring.future_date_tolerance_days); // future check only
      if (!w.ok) { await rej(w.code!, `published ${resolved.date}`, common); continue; }
      if (resolved.date < run.windowStart) { await rej("OLD_EVENT", `published ${resolved.date}, before the 30-day window`, common); continue; }
    }
    const lang = v15Language(art.text);
    if (!lang.ok) { await rej("LANGUAGE_UNSUPPORTED", lang.detail ?? "", common); continue; }
    const ent = entityMatch({ title: art.title || c.title || "", text: art.text }, vc.id, deps.aliasIndex);
    if (!ent.ok) { await rej(ent.code, ent.detail, common); continue; }
    await db.updateCandidate(candidateId, common);
    docs.push({ id: `d${docs.length + 1}`, candidateId, url: r.finalUrl, title: art.title || c.title || "", text: art.text, resolved, sourceType, sourceName: c.sourceName ?? null });
  }

  // ---------------------------------------------------------------- Gemini extraction (no tools) + per-event validators
  const existing = await db.signalsInWindow(vc.id, run.today, cfg.scoring.window_days, cfg.scoring.future_date_tolerance_days);
  let newSignals = 0;
  if (docs.length > 0) {
    const ex = await extractEvents(gemini, {
      company: { product_description: deps.company.product_description, icp: deps.company.icp, relevance_keywords: deps.company.relevance_keywords },
      target: { firm: vc.firm, aliases: vc.aliases, tracked_people: vc.tracked_people },
      docs: docs.map((d) => ({ id: d.id, url: d.url, publishedHint: d.resolved?.date ?? null, text: d.text })),
      runId: run.id,
      vcId: vc.id,
    });
    if (ex.error) {
      extractionIncomplete = true;
      notes.push(`extract: ${ex.error}`);
    }
    const skipped = new Set(ex.skippedDocIds);
    const eventsByDoc = new Map<string, typeof ex.events>();
    for (const e of ex.events) eventsByDoc.set(e.doc_id, [...(eventsByDoc.get(e.doc_id) ?? []), e]);
    const acceptedThisRun: Array<{ vcId: string; signalType: string; subjectEntity: string | null; eventDate: string; url: string; text: string }> = [];

    for (const doc of docs) {
      if (skipped.has(doc.id)) continue; // stays PENDING: retried next run, and the VC is PARTIAL now
      const events = eventsByDoc.get(doc.id) ?? [];
      const verdicts: string[] = [];
      let qualifiedSignalId: string | null = null;
      if (events.length === 0) verdicts.push("NOT_ATTRIBUTABLE");
      for (const e of events) {
        const fail = (code: string) => { verdicts.push(code); reject(code); };
        const role = v8Role(e.vc_role, e.is_vc_activity);
        if (!role.ok) { fail(role.code); continue; }
        const q = v9Quote(e.evidence_excerpt, doc.text);
        if (!q.ok) { fail("QUOTE_NOT_FOUND"); continue; }
        // event date: model date reconciled with the ladder date; or, with no ladder date, only an explicit-in-text model date
        let eventDate: string;
        let basis: "explicit_in_text" | "structured_metadata" | "published_date";
        if (doc.resolved) {
          const rec = reconcileEventDate(e.event_date_basis === "explicit_in_text" ? e.event_date : null, doc.resolved.date);
          if (!rec.ok) { fail(rec.code); continue; }
          eventDate = rec.eventDate;
          basis = doc.resolved.basis === "explicit_in_text" ? "explicit_in_text" : doc.resolved.basis;
        } else if (e.event_date && e.event_date_basis === "explicit_in_text") {
          const m = resolveDate({ modelExplicitDate: e.event_date });
          // ladder rung 6 is only trusted if the page text itself states that date (the model alone cannot supply a date)
          if (!m || !mentionsDate(doc.text, m.date)) { fail("DATE_UNVERIFIED"); continue; }
          eventDate = m.date;
          basis = "explicit_in_text";
        } else { fail("DATE_UNVERIFIED"); continue; }
        const w = checkWindow(eventDate, run.today, cfg.scoring.window_days, cfg.scoring.future_date_tolerance_days);
        if (!w.ok) { fail(w.code!); continue; }
        const subj = v14Subject(e.signal_type, e.subject_entity, doc.text);
        if (!subj.ok) { fail("NOT_ATTRIBUTABLE"); continue; }
        const cross = crossCheckTier(e.relevance_tier, `${e.title} ${e.evidence_excerpt} ${e.summary}`, cfg.taxonomy);
        if (cross.tier === "none") { fail("IRRELEVANT"); continue; }
        const att = attributionLevel({ id: vc.id, firm: vc.firm, aliases: vc.aliases, tracked_people: vc.tracked_people }, e.attributed_person, e.evidence_excerpt, e.vc_role);

        // V13 dedupe against signals already stored (any run) and those accepted in this run
        const ev = { vcId: vc.id, signalType: e.signal_type, subjectEntity: e.subject_entity, eventDate };
        const dupStored = existing.find((s) => isSameEvent(ev, { vcId: vc.id, signalType: String(s.signal_type), subjectEntity: (s.subject_entity as string | null) ?? null, eventDate: String(s.event_date) }));
        const dupRun = acceptedThisRun.find((a) => isSameEvent(ev, a));
        if (dupStored || dupRun) {
          const prim = dupRun ? { url: dupRun.url, text: dupRun.text } : { url: String(dupStored!.primary_source_url), text: "" };
          const ind = isIndependentSource(prim, { url: doc.url, text: doc.text }, cfg.sources.domain_classes.wire_and_pr_syndicators);
          if (dupStored && ind.independent) {
            const supporting = [...((dupStored.supporting_sources as Array<{ url: string }>) ?? [])];
            if (!supporting.some((s) => s.url === doc.url)) supporting.push({ url: doc.url, name: doc.sourceName, domain: registrableDomain(doc.url), published_at: doc.resolved?.date ?? null, independent: true } as never);
            const count = independentSourceCount({ url: String(dupStored.primary_source_url), text: "" }, supporting.map((s) => ({ url: s.url, text: "" })), cfg.sources.domain_classes.wire_and_pr_syndicators);
            await db.upsertSignal({ ...(dupStoredRow(dupStored, vc.id)), supporting_sources: supporting, independent_source_count: count, run_id: run.id });
          }
          fail("DUPLICATE_SYNDICATED");
          verdicts[verdicts.length - 1] = `DUPLICATE_SYNDICATED (${ind.independent ? "independent supporting source" : ind.reason})`;
          continue;
        }

        const hits = keywordHits(`${e.title} ${e.evidence_excerpt} ${e.summary}`, cfg.taxonomy);
        const signalId = await db.upsertSignal({
          vc_id: vc.id,
          cluster_key: clusterKey(vc.id, e.signal_type, e.subject_entity, eventDate),
          signal_type: e.signal_type,
          title: e.title,
          summary: e.summary,
          subject_entity: e.subject_entity,
          event_date: eventDate,
          event_date_basis: basis,
          published_at: doc.resolved?.date ?? null,
          primary_source_url: doc.url,
          primary_source_name: doc.sourceName,
          primary_source_type: doc.sourceType,
          evidence_excerpt: e.evidence_excerpt,
          excerpt_verified: true,
          supporting_sources: [],
          independent_source_count: 1,
          attribution_level: att.level,
          attributed_person: att.person,
          relevance_tier: cross.tier,
          relevance_keywords_hit: [...hits.direct, ...hits.adjacent, ...hits.b2b_saas].slice(0, 8),
          relevance_downgraded: cross.downgraded,
          model_confidence: e.confidence,
          is_synthetic: false,
          commitment: e.commitment,
          run_id: run.id,
        });
        acceptedThisRun.push({ ...ev, url: doc.url, text: doc.text });
        qualifiedSignalId = signalId;
        newSignals++;
        verdicts.push("QUALIFIED");
      }
      if (qualifiedSignalId) {
        await db.updateCandidate(doc.candidateId, { status: "QUALIFIED", signalId: qualifiedSignalId, extraction: events });
      } else {
        const code = verdicts.find((v) => v !== "QUALIFIED") ?? "NOT_ATTRIBUTABLE";
        await db.updateCandidate(doc.candidateId, { status: "REJECTED", rejectionCode: code.split(" ")[0], rejectionDetail: verdicts.join(", "), extraction: events });
      }
    }
  }

  // ---------------------------------------------------------------- assessment status (never confuse failure with inactivity)
  const stored = await db.signalsInWindow(vc.id, run.today, cfg.scoring.window_days, cfg.scoring.future_date_tolerance_days);
  const scoringSignals: ScoringSignal[] = stored.map((s) => ({
    id: String(s.id),
    event_date: String(s.event_date),
    signal_type: s.signal_type as ScoringSignal["signal_type"],
    relevance_tier: s.relevance_tier as RelevanceTier,
    commitment: (s.commitment as ScoringSignal["commitment"]) === "not_applicable" ? undefined : (s.commitment as ScoringSignal["commitment"]),
    source_type: String(s.primary_source_type ?? "other"),
    date_basis: String(s.event_date_basis),
    excerpt_verified: Boolean(s.excerpt_verified),
    is_synthetic: Boolean(s.is_synthetic),
    independent_source_count: Number(s.independent_source_count ?? 1),
    url_ok: true,
  }));

  const okChannels = (Object.values(channels) as ChannelState[]).filter((s) => s === "ok").length;
  const perVcOk = channels.A === "ok" || channels.B === "ok";
  const attempted = (Object.values(channels) as ChannelState[]).filter((s) => s === "ok" || s === "fail").length;
  const allFetchesFailed = selected.length > 0 && fetchOk === 0 && fetchFailed > 0;
  const incomplete = extractionIncomplete || backlog > 0 || allFetchesFailed || unresolvedNews > 0;
  let assessment: AssessmentStatus;
  if (scoringSignals.length > 0) assessment = "SIGNAL_FOUND";
  else if (perVcOk && okChannels >= 2 && !incomplete) assessment = "QUIET";
  else if (attempted > 0 && okChannels === 0) assessment = "FAILED";
  else assessment = "PARTIAL";
  if (extractionIncomplete && scoringSignals.length === 0 && docs.length > 0 && fetchOk === docs.length && okChannels === 0) assessment = "FAILED";

  const fund: FundProfile = { stage_focus: vc.stage_focus, sector_tags: vc.sector_tags, hq_region: vc.hq_region };
  const res = score(scoringSignals, fund, regionFromGeography(deps.company.geography), run.today, cfg.scoring);
  const dec = decide(res, { contact_status: vc.contact_status, last_contact_date: vc.last_contact_date, reconnect_after: vc.reconnect_after }, run.today, assessment, cfg.scoring);
  const topRow = res.top ? stored.find((s) => String(s.id) === res.top!.id) : undefined;
  const summary = signalSummary(res, topRow ? { title: String(topRow.title), event_date: String(topRow.event_date), primary_source_name: (topRow.primary_source_name as string | null) ?? null, primary_source_url: String(topRow.primary_source_url) } : null);
  const reason = actionReason(dec, cfg.scoring);

  await db.insertRecommendation({
    run_id: run.id,
    vc_id: vc.id,
    follow_up_score: res.follow_up_score,
    fit_score: res.fit.total,
    action: dec.action,
    hold_reason: dec.hold_reason,
    reason: reason || dec.reason_code,
    assessment_status: assessment,
    signal_ids: stored.map((s) => String(s.id)),
    score_breakdown: res.breakdown,
    relationship_snapshot: { contact_status: vc.contact_status, last_contact_date: vc.last_contact_date, reconnect_after: vc.reconnect_after, is_demo_relationship: vc.is_demo_relationship },
    scoring_version: cfg.scoring.version,
  });
  await db.applyAssessment(vc.id, run.id, {
    last_signal_date: res.last_signal_date,
    signal_summary: summary,
    follow_up_score: res.follow_up_score,
    recommended_action: dec.action,
    hold_reason: dec.hold_reason,
    action_reason: reason || dec.reason_code,
    assessment_status: assessment,
    score_breakdown: res.breakdown,
    fit_score: res.fit.total,
    qualifying_signal_count: res.qualifying,
    scoring_version: cfg.scoring.version,
  });

  Object.assign(stats, {
    channels,
    candidates: { found: all.length, selected: selected.length, backlog, fetched_ok: fetchOk, fetch_failed: fetchFailed, unresolved_news: unresolvedNews },
    rejected,
    new_signals: newSignals,
    signals_in_window: scoringSignals.length,
    assessment,
    action: dec.action,
    reason_code: dec.reason_code,
    notes: notes.slice(0, 8),
  });
  return { status: assessment === "FAILED" ? "FAILED" : assessment === "PARTIAL" ? "PARTIAL" : "DONE", assessment, action: dec.action, stats };
}

const basisLabel = (r: ResolvedDate) => (r.rung <= 2 ? (r.rung === 1 ? "json_ld" : "meta_tag") : r.rung === 3 ? "feed" : r.rung === 4 ? "time_element" : r.rung === 5 ? "url_pattern" : "model_extracted");

function dupStoredRow(s: Record<string, unknown>, vcId: string) {
  return {
    vc_id: vcId,
    cluster_key: String(s.cluster_key),
    signal_type: s.signal_type,
    title: s.title,
    summary: s.summary,
    subject_entity: s.subject_entity,
    event_date: s.event_date,
    event_date_basis: s.event_date_basis,
    primary_source_url: s.primary_source_url,
    primary_source_name: s.primary_source_name,
    primary_source_type: s.primary_source_type,
    evidence_excerpt: s.evidence_excerpt,
    excerpt_verified: s.excerpt_verified,
    attribution_level: s.attribution_level,
    attributed_person: s.attributed_person,
    relevance_tier: s.relevance_tier,
    is_synthetic: s.is_synthetic,
    commitment: s.commitment,
  };
}
