import { z } from "zod";

/**
 * Validated SERVER env. Nothing here is NEXT_PUBLIC_*: the browser never needs a secret.
 * Parsing is lazy (getEnv) so `next build` and tests work without a populated .env.local;
 * code that needs a secret calls requireEnv("NAME") and fails loudly if it is missing.
 */
const bool = (def: boolean) => z.stringbool().default(def);
const int = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL_PRIMARY: z.string().startsWith("gemini-").default("gemini-3.8-flash"),
  GEMINI_MODEL_FALLBACKS: z
    .string()
    .default("gemini-3.6-flash,gemini-2.5-flash")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().startsWith("gemini-"))),
  GEMINI_ENABLE_GROUNDING: bool(true),
  LLM_MAX_CALLS_PER_RUN: int(200),
  LLM_MAX_CONCURRENCY: int(3),

  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  FOUNDER_ACCESS_CODE: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  PIPELINE_TIME_BUDGET_MS: int(240000),
  MANUAL_RUN_COOLDOWN_MINUTES: int(30),

  RESEND_API_KEY: z.string().min(1).optional(),
  DIGEST_FROM: z.string().optional(),
  DIGEST_RECIPIENT: z.string().email().optional(),
  DIGEST_AUTO_SEND: bool(false),

  TAVILY_API_KEY: z.string().min(1).optional(),
  EXA_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

/** Treat empty strings (as in a copied .env.example) as "not set". */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""));
  return schema.parse(cleaned);
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = getEnv()[key];
  if (v === undefined || v === null) throw new Error(`Missing required environment variable ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

/** For /api/health: which secrets are present. Booleans only, never values. */
export function envPresence(env: Env = getEnv()) {
  const keys = [
    "GEMINI_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "FOUNDER_ACCESS_CODE",
    "SESSION_SECRET", "CRON_SECRET", "RESEND_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY",
  ] as const;
  return Object.fromEntries(keys.map((k) => [k, env[k] !== undefined]));
}
