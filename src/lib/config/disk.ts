import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";

/** Disk-based loader for TESTS and scripts only (keeps node:fs out of the app bundle). Throws with file name and failing paths. */
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
