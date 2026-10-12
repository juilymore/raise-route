// Shared helpers for db scripts: load .env.local and connect as the OWNER over a DIRECT (unpooled) connection.
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/** Neon pooled hosts contain "-pooler"; migrations/tests need the direct host. Strip it if someone pasted the pooled string. */
export function ownerUrl() {
  loadEnv();
  const raw = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!raw) {
    console.error("Set DATABASE_URL_UNPOOLED in .env.local (owner connection string).");
    process.exit(2);
  }
  return raw.replace(/(@[^/.]+)-pooler(\.)/, "$1$2");
}

export async function connectOwner() {
  const client = new pg.Client({ connectionString: ownerUrl(), ssl: { rejectUnauthorized: true } });
  await client.connect();
  return client;
}
