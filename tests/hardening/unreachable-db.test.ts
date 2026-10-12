import { describe, expect, it } from "vitest";

// Failure matrix row: "database unreachable => clear error, no partial writes claiming success, no secret in the response".
process.env.DATABASE_URL = "postgresql://app_service:supersecretpassword@db-does-not-exist.invalid:5432/neondb?sslmode=require";
process.env.GEMINI_API_KEY = "AIzaFakeKeyForThisTestOnly000000000000000";

describe("database unreachable", () => {
  it("/api/health reports the database as unavailable without leaking the host, user or password", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = JSON.stringify(await res.json());
    expect(body).toContain('"ok":false');
    expect(body).toContain("database unreachable");
    for (const leak of ["supersecretpassword", "db-does-not-exist", "app_service", "AIzaFakeKey"]) expect(body).not.toContain(leak);
  }, 30_000);

  it("a pipeline write against an unreachable database throws instead of reporting success", async () => {
    const { pipelineDb } = await import("@/lib/db/pipelineDb");
    await expect(pipelineDb.applyAssessment("00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001", { recommended_action: "MONITOR" })).rejects.toBeTruthy();
  }, 30_000);
});
