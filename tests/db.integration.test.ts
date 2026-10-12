import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Integration test against the REAL Neon database. Skipped (not failed) when DATABASE_URL is not configured.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}
const live = Boolean(process.env.DATABASE_URL);

describe.skipIf(!live)("live Neon database (as role app_service)", () => {
  it("connects as the restricted role", async () => {
    const { query } = await import("@/lib/db/client");
    const [r] = await query<{ u: string }>("select current_user as u");
    expect(r?.u).toBe("app_service");
  });
  it("has 50 VCs, validated by the zod row schema", async () => {
    const { listVcs } = await import("@/lib/db/readDb");
    const vcs = await listVcs();
    expect(vcs).toHaveLength(50);
    expect(new Set(vcs.map((v) => v.slug)).size).toBe(50);
    expect(vcs.every((v) => v.is_demo_relationship)).toBe(true);
  });
  it("has the sample company profile (id=1) flagged as sample", async () => {
    const { getCompanyProfile } = await import("@/lib/db/readDb");
    const { profile, isSample } = await getCompanyProfile();
    expect(profile.company_name).toBe("FreightLoop");
    expect(isSample).toBe(true);
  });
  it("v_pipeline_overview works", async () => {
    const { getOverview } = await import("@/lib/db/readDb");
    const o = await getOverview();
    expect(o.total).toBe(50);
  });
  it("the app role cannot write vc_pipeline directly (Integrity Guard layer 1)", async () => {
    const { query } = await import("@/lib/db/client");
    await expect(query("update public.vc_pipeline set personal_notes = 'x'")).rejects.toMatchObject({ code: "42501" });
    await expect(query("update public.vc_pipeline set follow_up_score = 1")).rejects.toMatchObject({ code: "42501" });
    await expect(query("delete from public.vc_pipeline")).rejects.toMatchObject({ code: "42501" });
  });
});
