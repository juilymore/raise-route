// npm run scan:secrets — greps the production build output (.next) and tracked files for the VALUES of the secrets in .env.local.
// Prints only names and counts, never values. Run after `npm run build`.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.+)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const secretNames = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "GEMINI_API_KEY", "SESSION_SECRET", "CRON_SECRET", "FOUNDER_ACCESS_CODE", "RESEND_API_KEY", "VERCEL_OIDC_TOKEN", "OPENROUTER_API_KEY"];
const secrets = secretNames
  .filter((n) => env[n] && env[n].length >= 8)
  .map((n) => ({ name: n, value: env[n], host: n.startsWith("DATABASE") ? (env[n].match(/@([^/?]+)/) ?? [])[1] : null }));

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (s.size < 20_000_000) yield p;
  }
}
const hits = new Map();
let files = 0;
if (existsSync(".next")) {
  for (const f of walk(".next")) {
    if (/\.(map|png|jpg|ico|woff2?)$/.test(f)) continue;
    files++;
    let txt;
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const s of secrets) {
      if (txt.includes(s.value) || (s.host && txt.includes(s.host))) hits.set(`${s.name} in ${f.replace(/\\/g, "/")}`, true);
    }
  }
}
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of tracked) {
  if (/\.(png|jpg|ico|lock)$|package-lock/.test(f)) continue;
  let txt;
  try {
    txt = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  files++;
  for (const s of secrets) if (txt.includes(s.value)) hits.set(`${s.name} in tracked file ${f}`, true);
}
console.log(`scanned ${files} files (build output + tracked files) for ${secrets.length} secret values`);
if (hits.size) {
  console.log("LEAKS FOUND:\n" + [...hits.keys()].map((k) => " - " + k).join("\n"));
  process.exit(1);
}
console.log("no secret values found in the build output or in tracked files");
