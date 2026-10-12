import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScoring } from "@/lib/config";
import { decide } from "@/lib/engine/actions";
import { score } from "@/lib/engine/scoring";
import type { AssessmentStatus, FundProfile, Relationship, ScoringSignal } from "@/lib/engine/types";

interface Vector {
  name: string;
  today: string;
  input: {
    signals: ScoringSignal[];
    fund: FundProfile;
    company_geography: string | null;
    relationship: Relationship;
    assessment_status: AssessmentStatus;
  };
  expected: {
    qualifying_signals: number;
    follow_up_score: number | null;
    fit: { stage: number; sector: number; geo: number; total: number };
    breakdown: Record<string, number> | null;
    last_signal_date: string | null;
    action: string;
    hold_reason: string | null;
    reason_code: string;
  };
}

const golden = JSON.parse(readFileSync("config/golden_vectors.json", "utf8")) as { scoring_version: string; vectors: Vector[] };
const cfg = loadScoring();

describe("golden vectors (reference_engine.py is the spec)", () => {
  it("has 30 vectors and matches the config version", () => {
    expect(golden.vectors).toHaveLength(30);
    expect(golden.scoring_version).toBe(cfg.version);
  });

  for (const v of golden.vectors) {
    it(v.name, () => {
      const res = score(v.input.signals, v.input.fund, v.input.company_geography, v.today, cfg);
      const dec = decide(res, v.input.relationship, v.today, v.input.assessment_status, cfg);
      expect({
        qualifying_signals: res.qualifying,
        follow_up_score: res.follow_up_score,
        fit: res.fit,
        breakdown: res.breakdown,
        last_signal_date: res.last_signal_date,
        action: dec.action,
        hold_reason: dec.hold_reason,
        reason_code: dec.reason_code,
      }).toEqual(v.expected);
    });
  }
});
