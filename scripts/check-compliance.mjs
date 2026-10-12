#!/usr/bin/env node
/**
 * Exam + integrity compliance gate.  Run: node scripts/check-compliance.mjs   (wired into `npm run verify`)
 * Fails (exit 1) if the repo violates a hard exam rule or a data-integrity rule.
 *   R1  No Claude/Anthropic API usage anywhere in the product ("All AI tasks must use Gemini Flash").
 *   R2  Pipeline code must not call founder-write RPCs or write vc_pipeline directly.
 *   R3  No secrets referenced from client components ("use client").
 *   R4  Only Gemini model ids appear in code/config (ledger also enforces this in the DB).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "dist", ".claude", "docs", "prompts", "scripts", "db"]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|env|example|yml|yaml|sql)$/i;
const failures = [];
const fail = (rule, file, msg) => failures.push(`[${rule}] ${relative(ROOT, file)}: ${msg}`);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(name) || name === "package.json" || name.startsWith(".env")) yield p;
  }
}

// R1 — scan manifests + lockfiles + source for Anthropic/Claude API usage
const R1 = [/@anthropic-ai\//i, /api\.anthropic\.com/i, /\banthropic\b/i, /\bclaude-(?:3|sonnet|opus|haiku|fable|mythos|\d)/i, /ANTHROPIC_API_KEY/];
for (const f of [...walk(ROOT)]) {
  if (/check-compliance\.mjs$/.test(f) || /README|CLAUDE\.md|\.md$/i.test(f)) continue; // docs may MENTION the rule
  const txt = readFileSync(f, "utf8");
  for (const re of R1) if (re.test(txt)) fail("R1", f, `forbidden Claude/Anthropic reference matching ${re}`);
}
for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
  const p = join(ROOT, lock);
  if (existsSync(p) && /@anthropic-ai\//.test(readFileSync(p, "utf8"))) fail("R1", p, "lockfile contains @anthropic-ai/*");
}

// R2 — pipeline layer must never write founder data
const pipelineDirs = ["src/lib/pipeline", "src/lib/engine", "src/lib/gemini", "src/lib/sources", "src/app/api/cron", "src/app/api/pipeline"];
for (const d of pipelineDirs) {
  const dir = join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const txt = readFileSync(f, "utf8");
    if (/founder_update_vc|founder_append_contact_event/.test(txt)) fail("R2", f, "pipeline code references a founder-write RPC");
    if (/from\(\s*['"`]vc_pipeline['"`]\s*\)\s*\.\s*(update|insert|upsert|delete)/.test(txt)) fail("R2", f, "direct write to vc_pipeline (use apply_assessment RPC only)");
    if (/\b(update|insert\s+into|delete\s+from)\s+(public\.)?vc_pipeline\b/i.test(txt)) fail("R2", f, "raw SQL write to vc_pipeline (use apply_assessment RPC only)");
    if (/lib\/db\/founderDb|from\s+['"`]\.{1,2}\/founderDb['"`]/.test(txt)) fail("R2", f, "pipeline code imports founderDb (pipelineDb only)");
    if (/personal_notes|contact_history/.test(txt) && !/\.test\.|__tests__/.test(f)) fail("R2", f, "pipeline code touches founder-owned columns (personal_notes/contact_history)");
  }
}

// R3 — client components must not reference secrets
const SECRET = /SERVICE_ROLE|DATABASE_URL|GEMINI_API_KEY|RESEND_API_KEY|CRON_SECRET|SESSION_SECRET|FOUNDER_ACCESS_CODE|TAVILY_API_KEY|EXA_API_KEY/;
const srcDir = join(ROOT, "src");
if (existsSync(srcDir)) {
  for (const f of walk(srcDir)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(f)) continue;
    const txt = readFileSync(f, "utf8");
    if (/^\s*['"]use client['"]/m.test(txt) && SECRET.test(txt)) fail("R3", f, "client component references a server secret");
    if (/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|GEMINI|RESEND|CRON)/.test(txt)) fail("R3", f, "secret exposed through NEXT_PUBLIC_*");
  }
}

// R4 — every model id mentioned must be a Gemini model
if (existsSync(srcDir)) {
  for (const f of walk(srcDir)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const txt = readFileSync(f, "utf8");
    for (const m of txt.matchAll(/['"`]((?:gpt|o1|o3|llama|mistral|deepseek|grok)[-\w.]*)['"`]/gi)) fail("R4", f, `non-Gemini model id "${m[1]}"`);
  }
}

if (failures.length) {
  console.error("\nCOMPLIANCE CHECK FAILED\n" + failures.map((x) => " - " + x).join("\n") + "\n");
  process.exit(1);
}
console.log("compliance check passed: no Claude API usage, pipeline cannot touch founder data, no client-side secrets, Gemini-only models");
