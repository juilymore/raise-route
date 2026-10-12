import type { ZodType } from "zod";
import scoringJson from "../../../config/scoring.v1.json";
import sourcesJson from "../../../config/sources.json";
import taxonomyJson from "../../../config/taxonomy.json";
import { scoringSchema, sourcesSchema, taxonomySchema } from "./schemas";

export * from "./schemas";

/** Validate an already-parsed JSON value (used for the bundled defaults so Vercel does not need filesystem access at runtime). */
function validate<T>(file: string, raw: unknown, schema: ZodType<T>): T {
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config/${file} is invalid: ${issues}`);
  }
  return res.data;
}

// Config is imported statically (bundled into the build): no filesystem access at runtime.
export const loadScoring = () => validate("scoring.v1.json", scoringJson, scoringSchema);
export const loadTaxonomy = () => validate("taxonomy.json", taxonomyJson, taxonomySchema);
export const loadSources = () => validate("sources.json", sourcesJson, sourcesSchema);

let cache: { scoring: ReturnType<typeof loadScoring>; taxonomy: ReturnType<typeof loadTaxonomy>; sources: ReturnType<typeof loadSources> } | undefined;
export function getConfig() {
  return (cache ??= { scoring: loadScoring(), taxonomy: loadTaxonomy(), sources: loadSources() });
}
