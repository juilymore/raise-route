#!/usr/bin/env node
/**
 * npm run db:migrate [-- --seed]
 * Applies db/migrations/*.sql in filename order, once each (tracked in ops._migrations), as the project OWNER.
 * With --seed (or `npm run db:seed`) also runs db/seed.sql, which is idempotent (ON CONFLICT DO NOTHING) and never overwrites founder data.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { connectOwner } from "./_db.mjs";

const seedOnly = process.argv.includes("--seed-only");
const withSeed = process.argv.includes("--seed") || seedOnly;
const client = await connectOwner();
try {
  if (!seedOnly) {
    await client.query("create schema if not exists ops; create table if not exists ops._migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())");
    const done = new Map((await client.query("select name, sha256 from ops._migrations")).rows.map((r) => [r.name, r.sha256]));
    for (const f of readdirSync("db/migrations").filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(`db/migrations/${f}`, "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      if (done.has(f)) {
        console.log(`skip   ${f}${done.get(f) !== sha ? "  (WARNING: file changed since it was applied)" : ""}`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into ops._migrations (name, sha256) values ($1,$2)", [f, sha]);
        await client.query("commit");
        console.log(`apply  ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${f}: ${e.message}`);
      }
    }
  }
  if (withSeed) {
    await client.query(readFileSync("db/seed.sql", "utf8"));
    const { rows } = await client.query("select (select count(*) from public.vc_pipeline)::int vcs, (select company_name from public.company_profile where id=1) company");
    console.log(`seed   ok  vc_pipeline rows=${rows[0].vcs} company=${rows[0].company}`);
  }
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
