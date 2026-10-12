import { createHash } from "node:crypto";
import { daysBetween } from "./scoring";

/**
 * Dedupe and independence (docs/05 section 5, V13).
 * One event = one signal. Syndicated / press-release re-runs are the same evidence, never corroboration.
 */
export const TYPE_FAMILIES: Record<string, string> = {
  investment: "deal",
  portfolio_activity: "deal",
  fund_news: "deal",
  blog_post: "writing",
  thesis_update: "writing",
  interview: "appearance",
  podcast: "appearance",
  conference: "appearance",
  news_mention: "mention",
  team_news: "mention",
  other: "mention",
};
export const typeFamily = (t: string) => TYPE_FAMILIES[t] ?? "mention";

const SUFFIXES = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|company|technologies|technology|labs|systems|solutions|holdings|group|ai)\b\.?/g;

/** "Acme Logistics Pvt. Ltd." and "acme logistics" collapse to the same key. */
export function normalizeEntity(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const epochDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** Stored in signals.cluster_key. Events are bucketed by week; lookups must also try the neighbouring buckets (see clusterKeyCandidates). */
export function clusterKey(vcId: string, signalType: string, subjectEntity: string | null, eventDate: string, bucketOffset = 0): string {
  const bucket = Math.floor(epochDay(eventDate) / 7) + bucketOffset;
  return sha1(`${vcId}|${typeFamily(signalType)}|${normalizeEntity(subjectEntity).replace(/ /g, "-")}|${bucket}`);
}

/** Keys of the event's own week and both neighbours: matches the "+-7 days" rule without a range query. */
export const clusterKeyCandidates = (vcId: string, signalType: string, subjectEntity: string | null, eventDate: string) =>
  [0, -1, 1].map((o) => clusterKey(vcId, signalType, subjectEntity, eventDate, o));

export interface EventLike {
  vcId: string;
  signalType: string;
  subjectEntity: string | null;
  eventDate: string;
}

/** Same VC + same type family + same normalised subject + dates within 7 days => same event. */
export function isSameEvent(a: EventLike, b: EventLike): boolean {
  if (a.vcId !== b.vcId || typeFamily(a.signalType) !== typeFamily(b.signalType)) return false;
  const sa = normalizeEntity(a.subjectEntity);
  const sb = normalizeEntity(b.subjectEntity);
  if (!sa || sa !== sb) return false;
  return Math.abs(daysBetween(a.eventDate, b.eventDate)) <= 7;
}

function shingles(text: string, k = 3): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (words.length < k) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - k; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

/** Jaccard similarity of word 3-shingles, 0..1. */
export function shingleSimilarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

const TWO_PART_TLDS = new Set(["co.uk", "co.in", "com.au", "co.nz", "com.sg", "co.jp", "com.br", "org.uk", "ac.uk", "gov.in", "net.in", "org.in", "com.hk", "com.my", "co.za"]);

/** Registrable domain (eTLD+1) with a small built-in two-part-suffix list. Good enough to tell two publishers apart. */
export function registrableDomain(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    /* already a host */
  }
  host = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const last2 = labels.slice(-2).join(".");
  return TWO_PART_TLDS.has(last2) ? labels.slice(-3).join(".") : last2;
}

/** `wire_and_pr_syndicators` entries are domains ("prnewswire.com") or bare agency names ("pti", "ani"). */
export function isSyndicator(urlOrHost: string, syndicators: string[]): boolean {
  const dom = registrableDomain(urlOrHost);
  const labels = dom.split(".");
  return syndicators.some((s) => {
    const x = s.toLowerCase();
    return x.includes(".") ? dom === x || dom.endsWith(`.${x}`) : labels[0] === x;
  });
}

export const SIMILARITY_THRESHOLD = 0.85;

export interface SourceDoc {
  url: string;
  text: string;
}

/** A supporting source is independent only if: distinct registrable domain, text not a near-copy of the primary, not a syndicator. */
export function isIndependentSource(primary: SourceDoc, other: SourceDoc, syndicators: string[]): { independent: boolean; reason?: string } {
  if (registrableDomain(primary.url) === registrableDomain(other.url)) return { independent: false, reason: "same domain" };
  if (isSyndicator(other.url, syndicators)) return { independent: false, reason: "wire/PR syndicator" };
  if (shingleSimilarity(primary.text, other.text) >= SIMILARITY_THRESHOLD) return { independent: false, reason: "near-duplicate text" };
  return { independent: true };
}

/** independent_source_count: the primary plus supporting sources that are independent AND mutually distinct domains. */
export function independentSourceCount(primary: SourceDoc, supporting: SourceDoc[], syndicators: string[]): number {
  const domains = new Set([registrableDomain(primary.url)]);
  const accepted: SourceDoc[] = [primary];
  for (const s of supporting) {
    if (!accepted.every((a) => isIndependentSource(a, s, syndicators).independent)) continue;
    domains.add(registrableDomain(s.url));
    accepted.push(s);
  }
  return domains.size;
}
