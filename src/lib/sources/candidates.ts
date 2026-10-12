import { registrableDomain } from "@/lib/engine/dedupe";
import type { SourcesConfig } from "@/lib/config";
import type { Candidate, SourceType } from "./types";

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|_hsenc|_hsmi|oc|ocid|cmpid|source)$/i;

/** Strip tracking params and fragments, lower-case the host, drop default ports and trailing slashes. */
export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  u.search = "";
  for (const [k, v] of keep.sort(([a], [b]) => a.localeCompare(b))) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Which kind of source a URL is, from config/sources.json domain_classes. Used for evidence-quality points. */
export function classifySource(url: string, vcDomains: string[], cfg: SourcesConfig): SourceType {
  const dom = registrableDomain(url);
  if (vcDomains.some((d) => registrableDomain(d) === dom)) return /blog|insights|news|post|essay|writing/i.test(url) ? "official_blog" : "official_site";
  const is = (list: string[]) => list.some((d) => dom === d || dom.endsWith(`.${d}`));
  if (is(cfg.domain_classes.reputable_news)) return "reputable_news";
  if (is(cfg.domain_classes.trade_press)) return "trade_press";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(dom)) return "video";
  if (/spotify\.com|podcasts\.apple\.com|soundcloud\.com|anchor\.fm|buzzsprout\.com/.test(dom)) return "podcast";
  if (/eventbrite|luma\.com|lu\.ma|meetup\.com/.test(dom)) return "event_page";
  if (/twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com/.test(dom)) return "social";
  return "other";
}

const KEYWORD_HIT = /logistic|supply chain|freight|fleet|warehouse|last.?mile|3pl|shipping|trucking/i;

/**
 * Per-VC task budget: canonical-dedupe, drop URLs already stored for this VC, rank
 * (official domain first, newest published hint, logistics keyword in title), keep the top N.
 */
export function selectCandidates(
  all: Candidate[],
  opts: { vcDomains: string[]; alreadyStored?: Set<string>; max: number; cfg: SourcesConfig },
): Candidate[] {
  const seen = new Set<string>(opts.alreadyStored ?? []);
  const unique: Candidate[] = [];
  for (const c of all) {
    if (seen.has(c.canonicalUrl)) continue;
    seen.add(c.canonicalUrl);
    unique.push(c);
  }
  const official = (c: Candidate) => (opts.vcDomains.some((d) => registrableDomain(d) === registrableDomain(c.url)) ? 0 : 1);
  const hint = (c: Candidate) => (c.publishedHint ? Date.parse(c.publishedHint) || 0 : 0);
  return unique
    .sort(
      (a, b) =>
        official(a) - official(b) ||
        hint(b) - hint(a) ||
        Number(KEYWORD_HIT.test(b.title ?? "")) - Number(KEYWORD_HIT.test(a.title ?? "")),
    )
    .slice(0, opts.max);
}

export function toCandidate(c: Omit<Candidate, "canonicalUrl">): Candidate | null {
  try {
    return { ...c, canonicalUrl: canonicalizeUrl(c.url) };
  } catch {
    return null;
  }
}
