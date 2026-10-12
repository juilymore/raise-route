import type { TaxonomyConfig } from "@/lib/config";
import type { RelevanceTier } from "./types";

/**
 * Deterministic relevance CROSS-CHECK (config/taxonomy.json). Keywords can only DOWNGRADE the model's tier, never upgrade:
 * "software supply chain attack" must not become "direct". Ambiguous non-logistics phrases are blanked before matching.
 */
const ORDER: RelevanceTier[] = ["none", "broad", "b2b_saas", "adjacent", "direct"]; // low -> high
const rank = (t: RelevanceTier) => ORDER.indexOf(t);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word / whole-phrase, case-insensitive. "ai" never matches inside "maintain"; "tms" never inside "systems". */
export function containsTerm(haystack: string, term: string): boolean {
  const re = new RegExp(`(?<![a-z0-9])${escapeRe(term.toLowerCase())}(?![a-z0-9])`, "i");
  return re.test(haystack);
}

export function stripAmbiguous(text: string, tax: TaxonomyConfig): string {
  let out = text.toLowerCase();
  for (const p of tax.ambiguous_phrases_not_logistics) out = out.split(p.toLowerCase()).join(" ");
  return out;
}

export interface TierHits {
  direct: string[];
  adjacent: string[];
  b2b_saas: string[];
  broad: string[];
}

export function keywordHits(text: string, tax: TaxonomyConfig): TierHits {
  const clean = stripAmbiguous(text, tax);
  const hits = (terms: string[]) => terms.filter((t) => containsTerm(clean, t));
  return { direct: hits(tax.direct), adjacent: hits(tax.adjacent), b2b_saas: hits(tax.b2b_saas), broad: hits(tax.broad) };
}

/** Highest tier the text actually supports. With no keyword at all it is "broad" (broad has no requirement). */
export function supportedTier(hits: TierHits): RelevanceTier {
  if (hits.direct.length) return "direct";
  if (hits.adjacent.length) return "adjacent";
  if (hits.b2b_saas.length) return "b2b_saas";
  return "broad";
}

export interface CrossCheck {
  tier: RelevanceTier;
  modelTier: RelevanceTier;
  downgraded: boolean;
  supported: RelevanceTier;
  hits: TierHits;
}

/** Result tier = min(model tier, tier supported by the keywords). "none" from the model always stays "none". */
export function crossCheckTier(modelTier: RelevanceTier, text: string, tax: TaxonomyConfig): CrossCheck {
  const hits = keywordHits(text, tax);
  const supported = supportedTier(hits);
  const tier = modelTier === "none" ? "none" : rank(supported) < rank(modelTier) ? supported : modelTier;
  return { tier, modelTier, downgraded: tier !== modelTier, supported, hits };
}
