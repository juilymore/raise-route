/**
 * Field names that hold founder-private data. Anything carrying one of these keys must never reach a model prompt, a log line
 * or the pipeline. Lives outside src/lib/pipeline|gemini|engine|sources on purpose: those folders must not even mention these columns
 * (scripts/check-compliance.mjs rule R2), they only call assertNoFounderData().
 */
export const FOUNDER_PRIVATE_KEYS = [
  "personal_notes", "contact_history", "contact_status", "last_contact_date", "reconnect_after", "notes", "email", "phone",
] as const;

/** Throws if any object handed to it carries a founder-private key at any depth. */
export function assertNoFounderData(...objs: unknown[]): void {
  const seen = new Set<unknown>();
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if ((FOUNDER_PRIVATE_KEYS as readonly string[]).includes(k.toLowerCase())) {
        throw new Error(`Refusing to proceed: founder-private field "${path}${k}" must never be sent to a model`);
      }
      walk(v, `${path}${k}.`);
    }
  };
  objs.forEach((o, i) => walk(o, `arg${i}.`));
}
