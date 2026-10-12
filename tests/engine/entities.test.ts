import { describe, expect, it } from "vitest";
import { attributionLevel, buildAliasIndex, entityMatch, findMentions, type VcIdentity } from "@/lib/engine/entities";
import { v7Entity, v8Role } from "@/lib/engine/validators";

const accel: VcIdentity = { id: "accel", firm: "Accel", aliases: ["Accel India", "Accel Partners"], tracked_people: ["Prashanth Prakash"] };
const lsGlobal: VcIdentity = { id: "ls", firm: "Lightspeed Venture Partners", aliases: ["Lightspeed"], tracked_people: [] };
const lsIndia: VcIdentity = { id: "lsi", firm: "Lightspeed India", aliases: ["Lightspeed India Partners"], tracked_people: [] };
const eclipse: VcIdentity = { id: "ecl", firm: "Eclipse Ventures", aliases: ["Eclipse"], tracked_people: [] };
const index = buildAliasIndex([accel, lsGlobal, lsIndia, eclipse]);

describe("alias matching and ambiguity (V7)", () => {
  it("'Accel' does not match 'accelerate' / 'accelerating' / 'acceleration'", () => {
    const text = "Companies are accelerating adoption. We accelerate growth; the acceleration is real.";
    expect(findMentions(text, index).filter((m) => m.vcId === "accel")).toHaveLength(0);
    expect(v7Entity({ title: "Growth", text }, "accel", index)).toMatchObject({ ok: false });
  });
  it("lower-case single-token 'accel' is not the brand (case-sensitive)", () => {
    expect(findMentions("the accel pedal and the accel module", index)).toHaveLength(0);
  });
  it("matches the real firm with VC context in the title", () => {
    expect(v7Entity({ title: "Accel leads $20M round in a freight startup", text: "Accel, the venture capital firm, led the round." }, "accel", index)).toMatchObject({ ok: true });
  });
  it("an ambiguous alias without VC-context words is rejected AMBIGUOUS_ENTITY (Eclipse the astronomy event)", () => {
    const r = v7Entity({ title: "Night sky", text: "A total Eclipse will be visible across the region on Tuesday evening, astronomers said." }, "ecl", index);
    expect(r).toMatchObject({ ok: false, code: "AMBIGUOUS_ENTITY" });
  });
  it("an ambiguous alias WITH VC context passes", () => {
    const r = v7Entity({ title: "Eclipse Ventures backs warehouse robotics startup", text: "Eclipse, the venture fund, invested in the round." }, "ecl", index);
    expect(r.ok).toBe(true);
  });
  it("'Lightspeed India' is not a mention of Lightspeed Venture Partners (longest alias wins)", () => {
    const ms = findMentions("Lightspeed India Partners led the round.", index);
    expect(ms.map((m) => m.vcId)).toEqual(["lsi"]);
    expect(findMentions("Lightspeed announced a new fund.", index).map((m) => m.vcId)).toEqual(["ls"]);
  });
  it("a single late mention without any other cue is not enough", () => {
    const filler = "Lorem ipsum dolor sit amet. ".repeat(40);
    const r = entityMatch({ title: "Market roundup", text: `${filler} Accel was also mentioned once at the very end.` }, "accel", index);
    expect(r.ok).toBe(false);
  });
  it("two mentions anywhere pass", () => {
    const filler = "Lorem ipsum dolor sit amet. ".repeat(40);
    const r = entityMatch({ title: "Market roundup", text: `${filler} Accel venture partners said so. ${filler} Accel Partners again.` }, "accel", index);
    expect(r.ok).toBe(true);
  });
});

describe("role and attribution (V8)", () => {
  it("mentioned_only is not activity", () => {
    expect(v8Role("mentioned_only")).toMatchObject({ ok: false, code: "NOT_ATTRIBUTABLE" });
    expect(v8Role("unknown")).toMatchObject({ ok: false });
    expect(v8Role("lead_investor").ok).toBe(true);
    expect(v8Role("host").ok).toBe(true);
    expect(v8Role("author", false)).toMatchObject({ ok: false });
  });
  it("person-level attribution needs tracked + named in excerpt + a personal role", () => {
    const ex = "Prashanth Prakash said on the podcast that logistics is underbuilt.";
    expect(attributionLevel(accel, "Prashanth Prakash", ex, "speaker")).toEqual({ level: "person", person: "Prashanth Prakash" });
    expect(attributionLevel(accel, "Prashanth Prakash", "Accel led the round.", "speaker").level).toBe("firm"); // not named in excerpt
    expect(attributionLevel(accel, "Prashanth Prakash", ex, "participating_investor").level).toBe("firm"); // a firm investment never proves a partner decided
    expect(attributionLevel(accel, "Somebody Else", "Somebody Else spoke.", "speaker").level).toBe("firm"); // not tracked
    expect(attributionLevel(accel, null, ex, "speaker").level).toBe("firm");
  });
});
