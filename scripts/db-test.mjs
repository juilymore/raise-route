#!/usr/bin/env node
/**
 * npm run db:test  — runs db/tests/guard_test.sql against DATABASE_URL_UNPOOLED (owner role).
 * Node replacement for `psql -f` (psql is not required). The two psql meta-commands in the file
 * (\set, \echo) are stripped. NOTICE lines ("PASS: ...") are printed as they arrive.
 * Loads .env.local if present (no dotenv dependency).
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("db:test needs DATABASE_URL_UNPOOLED (owner connection string) in .env.local. Not run.");
  process.exit(2);
}

const sql = readFileSync("db/tests/guard_test.sql", "utf8")
  .split(/\r?\n/)
  .filter((l) => !l.startsWith("\\"))
  .join("\n");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
let pass = 0;
client.on("notice", (n) => {
  if (n.message.startsWith("PASS:")) pass++;
  console.log(n.message);
});
try {
  await client.connect();
  await client.query(sql);
  console.log(`\nALL GUARD TESTS PASSED (${pass} checks, transaction rolled back)`);
} catch (e) {
  console.error("\nGUARD TESTS FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
