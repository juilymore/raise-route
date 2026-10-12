import { z } from "zod";

/** Gemini `extract` output contract (docs/04 section 3). Lives in the engine so validator V11 and the Gemini layer share one schema. */
export const EventSchema = z.object({
  doc_id: z.string(),
  is_vc_activity: z.boolean(),
  vc_role: z.enum(["lead_investor", "participating_investor", "author", "speaker", "host", "portfolio_announcement", "mentioned_only", "unknown"]),
  signal_type: z.enum(["investment", "portfolio_activity", "fund_news", "blog_post", "thesis_update", "interview", "podcast", "conference", "news_mention", "team_news", "other"]),
  title: z.string().max(160),
  summary: z.string().max(400),
  subject_entity: z.string().nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  event_date_basis: z.enum(["explicit_in_text", "not_stated"]),
  commitment: z.enum(["confirmed", "reported", "rumor", "discussion", "not_applicable"]),
  attribution_level: z.enum(["firm", "person", "unknown"]),
  attributed_person: z.string().nullable(),
  relevance_tier: z.enum(["direct", "adjacent", "b2b_saas", "broad", "none"]),
  relevance_reason: z.string().max(240),
  evidence_excerpt: z.string().max(300),
  confidence: z.object({
    attribution: z.number().min(0).max(1),
    relevance: z.number().min(0).max(1),
    date: z.number().min(0).max(1),
  }),
  uncertainties: z.array(z.string()).max(5),
});
export type ExtractedEvent = z.infer<typeof EventSchema>;

export const ExtractOutputSchema = z.object({ events: z.array(EventSchema).max(12) });
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
