import { describe, expect, it } from "vitest";
import { loadScoring } from "@/lib/config";
import { applyOverrides, editableGroups, parseStored } from "@/lib/config/effective";

describe("editable scoring rubric", () => {
  it("no overrides => the defaults, untouched", () => {
    const r = applyOverrides(null);
    expect(r.ok && r.scoring.version).toBe(loadScoring().version);
  });
  it("applies a valid override and marks the version as custom", () => {
    const r = applyOverrides({ values: { "actions.reach_out_now_min_score": 70 }, revision: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scoring.actions.reach_out_now_min_score).toBe(70);
      expect(r.scoring.version).toContain("+custom.3");
    }
  });
  it("refuses points that do not add up to 100, bad thresholds, unknown paths and bad numbers", () => {
    expect(applyOverrides({ values: { "max_points.relevance": 40 }, revision: 1 }).ok).toBe(false);
    expect(applyOverrides({ values: { "actions.follow_up_now_min_score": 90 }, revision: 1 }).ok).toBe(false);
    expect(applyOverrides({ values: { "language.quiet": 1 }, revision: 1 }).ok).toBe(false);
    expect(applyOverrides({ values: { "actions.monitor_min_score": -5 }, revision: 1 }).ok).toBe(false);
    expect(applyOverrides({ values: { "relevance_tier_weight.direct": 2 }, revision: 1 }).ok).toBe(false);
  });
  it("a swap that keeps the total at 100 is accepted", () => {
    expect(applyOverrides({ values: { "max_points.relevance": 25, "max_points.recency": 25 }, revision: 1 }).ok).toBe(true);
  });
  it("lists editable rows with defaults, and ignores malformed stored values", () => {
    const g = editableGroups(loadScoring());
    expect(g.find((x) => x.key === "max_points")!.rows.length).toBe(6);
    expect(parseStored("junk")).toBeNull();
    expect(parseStored({ values: { a: 1, b: "x" } })?.values).toEqual({ a: 1 });
  });
});
