#!/usr/bin/env node
/**
 * npm run db:test  — runs db/tests/guard_test.sql against DATABASE_URL_UNPOOLED (owner role).
 * Node replacement for `psql -f` (psql is not required). The two psql meta-commands in the file
 * (\set, \echo) are stripped. NOTICE lines ("PASS: ...") are printed as they arrive.
 * Loads .env.local if present (no dotenv dependency).
 */
import { readFileSync } from "node:fs";
import { connectOwner } from "./_db.mjs";

const sql = readFileSync("db/tests/guard_test.sql", "utf8")
  .split(/\r?\n/)
  .filter((l) => !l.startsWith("\\"))
  .join("\n");

const client = await connectOwner();
let pass = 0;
client.on("notice", (n) => {
  if (n.message.startsWith("PASS:")) pass++;
  console.log(n.message);
});
try {
  await client.query(sql);
  console.log(`\nALL GUARD TESTS PASSED (${pass} checks, transaction rolled back)`);
} catch (e) {
  console.error("\nGUARD TESTS FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
