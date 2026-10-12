import { describe, expect, it } from "vitest";
import { loadSources, loadTaxonomy } from "@/lib/config";
import {
  clusterKey, clusterKeyCandidates, independentSourceCount, isIndependentSource, isSameEvent, normalizeEntity,
  registrableDomain, shingleSimilarity, typeFamily,
} from "@/lib/engine/dedupe";
import { crossCheckTier } from "@/lib/engine/taxonomy";
import {
  normalizeQuote, v10Relevance, v11Schema, v12NotSynthetic, v13Duplicate, v14Subject, v15Language, v2Fetch, v9Quote,
} from "@/lib/engine/validators";

const tax = loadTaxonomy();
const syndicators = loadSources().domain_classes.wire_and_pr_syndicators;

const PRESS = "Acme Freight Pvt Ltd today announced a Seed round led by Blume Ventures to expand its fleet visibility platform across India. The funding will be used to hire engineers and open new corridors for trucking operators. Founders said the platform already tracks thousands of shipments daily across carriers.";

describe("V2 fetch and V9 quote verification", () => {
  it("rejects non-200 and short pages as FETCH_FAILED", () => {
    expect(v2Fetch({ status: 403, text: PRESS })).toMatchObject({ ok: false, code: "FETCH_FAILED" });
    expect(v2Fetch({ status: 200, text: "Subscribe to read more." })).toMatchObject({ ok: false, code: "FETCH_FAILED" });
    expect(v2Fetch({ status: 200, text: PRESS.repeat(2) }).ok).toBe(true);
  });
  it("a quote that is NOT in the fetched text is rejected QUOTE_NOT_FOUND", () => {
    expect(v9Quote("Blume Ventures invested $50 million in a drone company", PRESS)).toMatchObject({ ok: false, code: "QUOTE_NOT_FOUND" });
  });
  it("a verbatim quote passes, with odd whitespace, case, curly quotes and dashes normalised", () => {
    expect(v9Quote("a Seed round   led by\nBLUME Ventures", PRESS).ok).toBe(true);
    expect(v9Quote("it’s “great” — really", "Founders said it's \"great\" - really, and moved on.").ok).toBe(true);
    expect(normalizeQuote("A B–C")).toBe("a b-c");
  });
  it("rejects empty and over-long excerpts", () => {
    expect(v9Quote("", PRESS).ok).toBe(false);
    expect(v9Quote("x".repeat(301), "x".repeat(400)).ok).toBe(false);
  });
});

describe("V10 relevance cross-check can only DOWNGRADE", () => {
  it("never upgrades: a broad model tier stays broad even when logistics words appear", () => {
    expect(crossCheckTier("broad", "logistics freight fleet", tax).tier).toBe("broad");
  });
  it("downgrades a 'direct' claim with no logistics keywords", () => {
    const c = crossCheckTier("direct", "A generic startup raised a funding round for its AI product.", tax);
    expect(c.tier).toBe("broad");
    expect(c.downgraded).toBe(true);
  });
  it("downgrades direct to adjacent when only adjacent keywords hit", () => {
    expect(crossCheckTier("direct", "robotics and manufacturing automation", tax).tier).toBe("adjacent");
  });
  it("keeps direct with a real logistics keyword", () => {
    expect(crossCheckTier("direct", "Last-mile delivery and fleet management software", tax).tier).toBe("direct");
  });
  it("ambiguous phrases do not count: 'software supply chain attack' is not logistics", () => {
    const c = crossCheckTier("direct", "A software supply chain attack hit open source maintainers.", tax);
    expect(c.tier).not.toBe("direct");
  });
  it("whole-word matching: 'ai' does not match inside 'maintain', 'tms' not inside 'systems'", () => {
    const c = crossCheckTier("broad", "maintain complex systems", tax);
    expect(c.hits.broad).not.toContain("ai");
    expect(c.hits.direct).not.toContain("tms");
  });
  it("none stays none and is rejected IRRELEVANT", () => {
    expect(v10Relevance("none", "logistics", tax)).toMatchObject({ ok: false, code: "IRRELEVANT" });
    expect(v10Relevance("direct", "freight forwarding platform", tax)).toMatchObject({ ok: true, tier: "direct" });
  });
});

describe("V11 schema, V12 synthetic, V14 subject, V15 language", () => {
  const good = {
    doc_id: "d1", is_vc_activity: true, vc_role: "lead_investor", signal_type: "investment", title: "t", summary: "s",
    subject_entity: "Acme Freight", event_date: "2026-10-05", event_date_basis: "explicit_in_text", commitment: "confirmed",
    attribution_level: "firm", attributed_person: null, relevance_tier: "direct", relevance_reason: "r", evidence_excerpt: "e",
    confidence: { attribution: 0.9, relevance: 0.9, date: 0.9 }, uncertainties: [],
  };
  it("V11 accepts a valid event and rejects malformed output", () => {
    expect(v11Schema(good).ok).toBe(true);
    expect(v11Schema({ ...good, vc_role: "ceo" })).toMatchObject({ ok: false, code: "INVALID_MODEL_OUTPUT" });
    expect(v11Schema({ ...good, event_date: "5 Oct" })).toMatchObject({ ok: false });
    expect(v11Schema("not json")).toMatchObject({ ok: false });
  });
  it("V12 synthetic can never be live evidence", () => {
    expect(v12NotSynthetic(true)).toMatchObject({ ok: false, code: "SYNTHETIC" });
    expect(v12NotSynthetic(false).ok).toBe(true);
  });
  it("V14 investment signals need a subject entity that appears in the text", () => {
    expect(v14Subject("investment", null, PRESS)).toMatchObject({ ok: false, code: "NOT_ATTRIBUTABLE" });
    expect(v14Subject("investment", "Drone Corp", PRESS).ok).toBe(false);
    expect(v14Subject("investment", "Acme Freight", PRESS).ok).toBe(true);
    expect(v14Subject("blog_post", null, PRESS).ok).toBe(true);
  });
  it("V15 accepts English and rejects non-English / non-Latin text", () => {
    expect(v15Language(PRESS.repeat(2)).ok).toBe(true);
    const hindi = "यह एक उदाहरण पाठ है जो हिंदी में लिखा गया है और इसमें कई शब्द हैं ताकि पहचान हो सके कि भाषा अंग्रेज़ी नहीं है।".repeat(3);
    expect(v15Language(hindi)).toMatchObject({ ok: false, code: "LANGUAGE_UNSUPPORTED" });
    const german = "Das Unternehmen hat heute eine neue Finanzierungsrunde bekannt gegeben, die von mehreren Investoren in Deutschland unterstützt wird und das Wachstum beschleunigen soll.".repeat(2);
    expect(v15Language(german).ok).toBe(false);
  });
});

describe("dedupe and independence (V13)", () => {
  const primary = { url: "https://www.techcrunch.com/2026/10/05/acme", text: PRESS };
  it("a syndicated copy (press-release wire) is not independent", () => {
    const wire = { url: "https://www.prnewswire.com/news/acme-raises", text: "Different words entirely about something else." };
    expect(isIndependentSource(primary, wire, syndicators)).toMatchObject({ independent: false, reason: "wire/PR syndicator" });
  });
  it("a near-identical copy on another domain is not independent", () => {
    const copy = { url: "https://some-blog.example.org/acme", text: PRESS + " Read more." };
    expect(shingleSimilarity(primary.text, copy.text)).toBeGreaterThanOrEqual(0.85);
    expect(isIndependentSource(primary, copy, syndicators).independent).toBe(false);
  });
  it("same registrable domain is not independent; a distinct, different article is", () => {
    expect(isIndependentSource(primary, { url: "https://techcrunch.com/other", text: "x y z w" }, syndicators).independent).toBe(false);
    const other = { url: "https://economictimes.indiatimes.com/acme", text: "Blume Ventures backed Acme Freight in a round reported by the newspaper with its own reporting on trucking corridors and fleet data." };
    expect(isIndependentSource(primary, other, syndicators).independent).toBe(true);
  });
  it("independent_source_count counts only independent distinct domains", () => {
    const wire = { url: "https://www.businesswire.com/x", text: PRESS };
    const other = { url: "https://economictimes.indiatimes.com/acme", text: "Own reporting about the same round with new quotes from founders and customers in the trucking sector." };
    expect(independentSourceCount(primary, [wire], syndicators)).toBe(1);
    expect(independentSourceCount(primary, [wire, other], syndicators)).toBe(2);
  });
  it("registrableDomain handles two-part suffixes", () => {
    expect(registrableDomain("https://www.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(registrableDomain("https://economictimes.indiatimes.com/x")).toBe("indiatimes.com");
    expect(registrableDomain("https://blog.example.com/x")).toBe("example.com");
  });
  it("same VC + subject + type family within 7 days is the same event (normalised names)", () => {
    const a = { vcId: "v", signalType: "investment", subjectEntity: "Acme Freight Pvt. Ltd.", eventDate: "2026-10-05" };
    const b = { vcId: "v", signalType: "portfolio_activity", subjectEntity: "acme freight", eventDate: "2026-10-10" };
    expect(isSameEvent(a, b)).toBe(true);
    expect(isSameEvent(a, { ...b, eventDate: "2026-10-15" })).toBe(false); // > 7 days
    expect(isSameEvent(a, { ...b, vcId: "other" })).toBe(false);
    expect(isSameEvent(a, { ...b, signalType: "blog_post" })).toBe(false);
    expect(normalizeEntity("Acme Freight Pvt. Ltd.")).toBe(normalizeEntity("ACME FREIGHT"));
    expect(typeFamily("podcast")).toBe(typeFamily("conference"));
  });
  it("cluster keys: same week same key; neighbouring-week events are found via candidates", () => {
    const k1 = clusterKey("v", "investment", "Acme Freight", "2026-10-06");
    expect(clusterKey("v", "portfolio_activity", "ACME FREIGHT Ltd", "2026-10-07")).toBe(k1);
    const later = clusterKeyCandidates("v", "investment", "Acme Freight", "2026-10-12");
    expect(later.some((k) => k === k1 || later.includes(clusterKey("v", "investment", "Acme Freight", "2026-10-05")))).toBe(true);
    expect(clusterKey("v", "investment", "Other Co", "2026-10-06")).not.toBe(k1);
  });
  it("V13 flags a syndicated duplicate of an accepted event and marks independence", () => {
    const accepted = [{ vcId: "v", signalType: "investment", subjectEntity: "Acme Freight", eventDate: "2026-10-05", url: primary.url, text: PRESS }];
    const syn = { vcId: "v", signalType: "investment", subjectEntity: "Acme Freight", eventDate: "2026-10-05", url: "https://www.prnewswire.com/a", text: PRESS };
    expect(v13Duplicate(syn, accepted, syndicators)).toMatchObject({ ok: false, code: "DUPLICATE_SYNDICATED" });
    expect(v13Duplicate(syn, accepted, syndicators).detail).toContain("not independent");
    const unrelated = { vcId: "v", signalType: "blog_post", subjectEntity: null, eventDate: "2026-10-09", url: "https://blume.vc/post", text: "An essay about vertical software and the future of work and why it matters for builders everywhere." };
    expect(v13Duplicate(unrelated, accepted, syndicators).ok).toBe(true);
  });
});

describe("audit hardening (P03 audit findings)", () => {
  it("B5: a tiny excerpt cannot verify (\"a\" is inside \"banana\")", () => {
    expect(v9Quote("a", "banana banana banana")).toMatchObject({ ok: false, code: "QUOTE_NOT_FOUND" });
  });
  it("B5: an excerpt must match on word boundaries", () => {
    expect(v9Quote("led the round in logistics", "Fund X misled the round in logistics again and again").ok).toBe(false);
    expect(v9Quote("led the round in logistics", "Fund X led the round in logistics, said the CEO.").ok).toBe(true);
  });
  it("B7: subject entity must match a whole word (Foo is not Foobar)", () => {
    expect(v14Subject("investment", "Foo", "The fund invested in Foobar Inc last week").ok).toBe(false);
    expect(v14Subject("investment", "Foo", "The fund invested in Foo last week").ok).toBe(true);
  });
});
