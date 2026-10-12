import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import { scoringSchema, sourcesSchema, taxonomySchema } from "./schemas";

export * from "./schemas";

/** Read + validate one config file. Throws with the file name and failing paths so a bad edit fails fast. */
export function loadConfigFile<T>(file: string, schema: ZodType<T>, dir = join(process.cwd(), "config")): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    throw new Error(`config/${file}: cannot read or parse JSON (${(e as Error).message})`);
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config/${file} is invalid: ${issues}`);
  }
  return res.data;
}

export const loadScoring = (dir?: string) => loadConfigFile("scoring.v1.json", scoringSchema, dir);
export const loadTaxonomy = (dir?: string) => loadConfigFile("taxonomy.json", taxonomySchema, dir);
export const loadSources = (dir?: string) => loadConfigFile("sources.json", sourcesSchema, dir);

let cache: { scoring: ReturnType<typeof loadScoring>; taxonomy: ReturnType<typeof loadTaxonomy>; sources: ReturnType<typeof loadSources> } | undefined;
export function getConfig() {
  return (cache ??= { scoring: loadScoring(), taxonomy: loadTaxonomy(), sources: loadSources() });
}
