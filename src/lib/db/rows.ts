import { z } from "zod";

/** Row shapes for the tables the UI reads. Hand-written (no codegen). Founder-owned vs system columns follow db/migrations/0001. */
const dateStr = z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().nullable());

export const vcRowSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  firm: z.string(),
  thesis: z.string().nullable(),
  website: z.string().nullable(),
  hq_region: z.string().nullable(),
  stage_focus: z.string().nullable(),
  sector_tags: z.array(z.string()),
  aliases: z.array(z.string()),
  tracked_people: z.array(z.string()),
  contact_status: z.enum(["TO_REACH_OUT", "WAITING_FOR_RESPONSE", "IN_CONVERSATION", "MEETING_SCHEDULED", "PASSED"]),
  last_contact_date: dateStr,
  reconnect_after: dateStr,
  personal_notes: z.string().nullable(),
  is_demo_relationship: z.boolean(),
  last_signal_date: dateStr,
  signal_summary: z.string().nullable(),
  follow_up_score: z.number().int().nullable(),
  recommended_action: z.string().nullable(),
  assessment_status: z.string(),
});
export type VcRow = z.infer<typeof vcRowSchema>;

export const companyProfileSchema = z.looseObject({
  id: z.literal(1),
  company_name: z.string(),
  product_description: z.string(),
  sector: z.string(),
  stage: z.string(),
  geography: z.string().nullable(),
  relevance_keywords: z.array(z.string()),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

const count = z.coerce.number().int();
export const overviewSchema = z.object({
  total: count,
  reach_out_now: count,
  follow_up_now: count,
  monitor: count,
  hold: count,
  dont_prioritize: count,
  assessment_incomplete: count,
  not_assessed: count,
  quiet: count,
});
export type Overview = z.infer<typeof overviewSchema>;
