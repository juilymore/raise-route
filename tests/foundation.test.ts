import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, pageTitle } from "@/config/brand";
import { loadScoring, loadSources, loadTaxonomy, scoringSchema } from "@/lib/config";
import { loadConfigFile } from "@/lib/config/disk";
import { envPresence, parseEnv } from "@/lib/env";
import { assertIdent, buildInsert } from "@/lib/db/sql";

describe("brand", () => {
  it("is the single source of the app name", () => {
    expect(BRAND.name).toBe("RaiseRoute");
    expect(BRAND.tagline).toBe("Your fundraising route, mapped");
    expect(pageTitle()).toContain("RaiseRoute");
    expect(pageTitle("Pipeline")).toBe("Pipeline · RaiseRoute");
  });
  it("is not hard-coded anywhere else in src", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).not.toMatch(/RaiseRoute/);
  });
});

describe("config loaders", () => {
  it("loads and validates the shipped config files", () => {
    expect(loadScoring().version).toBe("v1.0.0");
    expect(loadScoring().language.quiet).toBe("No qualifying signal found in the sources checked in the past 30 days.");
    expect(loadTaxonomy().direct).toContain("logistics");
    expect(loadSources().fetch.block_private_and_link_local_ips).toBe(true);
  });
  it("fails fast with a readable message on a bad config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const bad = JSON.parse(readFileSync("config/scoring.v1.json", "utf8"));
    delete bad.actions.reach_out_now_min_score;
    writeFileSync(join(dir, "scoring.v1.json"), JSON.stringify(bad));
    expect(() => loadConfigFile("scoring.v1.json", scoringSchema, dir)).toThrow(/actions\.reach_out_now_min_score/);
  });
  it("fails on missing file", () => {
    expect(() => loadConfigFile("nope.json", scoringSchema, tmpdir())).toThrow(/cannot read/);
  });
});

describe("env", () => {
  it("applies defaults and treats empty strings as unset", () => {
    const env = parseEnv({ GEMINI_API_KEY: "", DATABASE_URL: "" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GEMINI_MODEL_PRIMARY).toBe("gemini-3.8-flash");
    expect(env.GEMINI_MODEL_FALLBACKS).toEqual(["gemini-3.6-flash", "gemini-3.7-flash"]);
    expect(env.PIPELINE_TIME_BUDGET_MS).toBe(240000);
  });
  it("rejects non-Gemini model ids", () => {
    expect(() => parseEnv({ GEMINI_MODEL_PRIMARY: "gpt-4o" })).toThrow();
    expect(() => parseEnv({ GEMINI_MODEL_FALLBACKS: "gemini-3.7-flash,other-model" })).toThrow();
  });
  it("presence report contains booleans only, never values", () => {
    const env = parseEnv({ GEMINI_API_KEY: "super-secret-key", DATABASE_URL: "postgres://u:p@h/db" });
    const p = envPresence(env);
    expect(p.GEMINI_API_KEY).toBe(true);
    expect(p.RESEND_API_KEY).toBe(false);
    expect(JSON.stringify(p)).not.toContain("super-secret-key");
    expect(Object.values(p).every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("db sql helpers", () => {
  it("builds a parameterised insert and never interpolates values", () => {
    const { text, values } = buildInsert(["signals"], "signals", { title: "x'; drop table signals;--", meta: { a: 1 } });
    expect(text).toBe("insert into public.signals (title, meta) values ($1, $2) returning *");
    expect(values).toEqual(["x'; drop table signals;--", '{"a":1}']);
  });
  it("refuses tables outside the allow-list (pipeline cannot insert into vc_pipeline)", () => {
    expect(() => buildInsert(["signals"], "vc_pipeline", { name: "x" })).toThrow(/not allowed/);
  });
  it("refuses unsafe column names", () => {
    expect(() => assertIdent("a; drop table x")).toThrow();
    expect(() => buildInsert(["signals"], "signals", { "title) values (1); --": 1 })).toThrow(/Unsafe/);
  });
});
