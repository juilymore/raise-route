#!/usr/bin/env node
/**
 * npm run db:app-role — sets a fresh random password on the restricted login role app_service and writes
 * DATABASE_URL (pooled host, user app_service) into .env.local. The password is never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { connectOwner, ownerUrl } from "./_db.mjs";

const pw = randomBytes(24).toString("hex");
const client = await connectOwner();
try {
  await client.query(`alter role app_service with login password '${pw}'`);
} finally {
  await client.end();
}
const u = new URL(ownerUrl());
const pooledHost = u.hostname.replace(/^([^.]+)\./, "$1-pooler.");
const url = `postgresql://app_service:${pw}@${pooledHost}${u.pathname}?sslmode=require`;
let env = readFileSync(".env.local", "utf8");
env = /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`) : env + `\nDATABASE_URL=${url}\n`;
writeFileSync(".env.local", env);
console.log("app_service password rotated; DATABASE_URL in .env.local now uses role app_service (pooled host).");
