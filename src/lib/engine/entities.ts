/**
 * Entity resolution: "which VC is this really about?" (docs/05 section 4, V7, V8).
 * - whole-word alias matching (never "accelerate" for Accel); single-token brand names are case-sensitive
 * - collision list: ambiguous aliases need VC-context words within +-80 chars
 * - longest alias wins across ALL funds ("Lightspeed India" is not a mention of Lightspeed Venture Partners)
 * - person-level attribution only for tracked people named in the excerpt
 */
export interface VcIdentity {
  id: string;
  firm: string;
  aliases: string[];
  tracked_people: string[];
}

export const AMBIGUOUS_ALIASES = [
  "Accel", "Eclipse", "Emergence", "Initialized", "Precursor", "Insight", "Antler", "Susa", "Together", "Better", "Prime", "Titan",
  "Lightspeed", "Blume", "Elevation", "Bessemer", "General Catalyst",
];

export const VC_CONTEXT_WORDS = ["venture", "ventures", "capital", "partners", "fund", "vc", "invest", "invested", "investor", "investors", "investment", "backed", "backs", "led", "leads", "portfolio", "seed", "series"];
const CONTEXT_WINDOW = 80;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface Mention {
  vcId: string;
  alias: string;
  index: number;
}

interface IndexEntry {
  vcId: string;
  alias: string;
  caseSensitive: boolean;
  re: RegExp;
}

export interface AliasIndex {
  entries: IndexEntry[];
}

export function aliasesOf(vc: VcIdentity): string[] {
  return [...new Set([vc.firm, ...vc.aliases].map((a) => a.trim()).filter((a) => a.length >= 3))];
}

export function buildAliasIndex(vcs: VcIdentity[]): AliasIndex {
  const entries: IndexEntry[] = [];
  for (const vc of vcs) {
    for (const alias of aliasesOf(vc)) {
      const caseSensitive = !/\s/.test(alias); // single-token brand name
      entries.push({
        vcId: vc.id,
        alias,
        caseSensitive,
        re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(alias)}(?![A-Za-z0-9])`, caseSensitive ? "g" : "gi"),
      });
    }
  }
  return { entries };
}

/** All alias occurrences in `text`, with overlapping matches resolved to the longest alias (ties keep every fund). */
export function findMentions(text: string, index: AliasIndex): Mention[] {
  const raw: Array<Mention & { end: number }> = [];
  for (const e of index.entries) {
    e.re.lastIndex = 0;
    for (const m of text.matchAll(e.re)) raw.push({ vcId: e.vcId, alias: e.alias, index: m.index!, end: m.index! + m[0].length });
  }
  return raw
    .filter((a) => !raw.some((b) => b !== a && b.index <= a.index && b.end >= a.end && b.end - b.index > a.end - a.index))
    .map(({ vcId, alias, index: i }) => ({ vcId, alias, index: i }));
}

export const isAmbiguousAlias = (alias: string) => AMBIGUOUS_ALIASES.some((a) => norm(a) === norm(alias));

export function hasContextWords(text: string, at: number, len: number): boolean {
  const from = Math.max(0, at - CONTEXT_WINDOW);
  const around = text.slice(from, at + len + CONTEXT_WINDOW).toLowerCase();
  return VC_CONTEXT_WORDS.some((w) => new RegExp(`(?<![a-z])${w}(?![a-z])`).test(around));
}

export type EntityVerdict =
  | { ok: true; mentions: number; inTitle: boolean; inLead: boolean }
  | { ok: false; code: "AMBIGUOUS_ENTITY" | "NOT_ATTRIBUTABLE"; detail: string };

/**
 * V7. Passes when (alias in title) OR (>= 2 mentions) OR (a mention in the first 400 chars).
 * Mentions of an ambiguous alias only count when VC-context words sit within +-80 chars.
 */
export function entityMatch(doc: { title: string; text: string }, vcId: string, index: AliasIndex): EntityVerdict {
  const countable = (text: string) =>
    findMentions(text, index).filter(
      (m) => m.vcId === vcId && (!isAmbiguousAlias(m.alias) || hasContextWords(text, m.index, m.alias.length)),
    );
  const all = findMentions(`${doc.title}\n${doc.text}`, index).filter((m) => m.vcId === vcId);
  const inTitle = countable(doc.title).length > 0;
  const body = countable(doc.text);
  const inLead = body.some((m) => m.index < 400);
  const mentions = body.length + (inTitle ? 1 : 0);
  if (inTitle || body.length >= 2 || inLead) return { ok: true, mentions, inTitle, inLead };
  if (all.length > 0) {
    return { ok: false, code: "AMBIGUOUS_ENTITY", detail: "alias found but without VC context (or only a single late mention)" };
  }
  return { ok: false, code: "NOT_ATTRIBUTABLE", detail: "no alias of the target investor found in the document" };
}

export const ACTIVITY_ROLES = ["lead_investor", "participating_investor", "author", "speaker", "portfolio_announcement", "host"] as const;
export const PERSON_ROLES = ["author", "speaker", "host", "lead_investor"] as const;

/** V8: mentioned_only / unknown is not activity. */
export function roleIsActivity(role: string): boolean {
  return (ACTIVITY_ROLES as readonly string[]).includes(role);
}

/**
 * Person-level attribution is allowed only if the person is tracked AND named in the evidence excerpt AND the role is
 * author/speaker/host/lead. Otherwise the signal stays firm-level: a firm's investment never proves a partner decided it.
 */
export function attributionLevel(
  vc: VcIdentity,
  person: string | null | undefined,
  excerpt: string,
  role: string,
): { level: "firm" | "person"; person: string | null } {
  if (!person) return { level: "firm", person: null };
  const tracked = vc.tracked_people.find((p) => norm(p) === norm(person));
  const named = tracked ? new RegExp(`(?<![A-Za-z])${escapeRe(tracked)}(?![A-Za-z])`, "i").test(excerpt) : false;
  if (tracked && named && (PERSON_ROLES as readonly string[]).includes(role)) return { level: "person", person: tracked };
  return { level: "firm", person: null };
}
