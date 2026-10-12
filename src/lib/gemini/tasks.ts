import { z } from "zod";
import { EventSchema, type ExtractedEvent } from "@/lib/engine/eventSchema";
import { GeminiError, toGeminiJsonSchema, type GeminiClient } from "./client";
import {
  DISAMBIGUATE_SYSTEM, EXTRACT_SYSTEM, MAX_DOCS_PER_CALL, buildDisambiguatePrompt, buildExtractPrompt, buildGroundedDiscoveryPrompt,
  type CompanyContext, type SourceDoc, type TargetInvestor,
} from "./prompts";

/** Call-level schema is lenient about individual events so ONE malformed event does not discard the others (V11 runs per event). */
const LenientOutput = z.object({ events: z.array(z.unknown()).max(12) });
const lenientJsonSchema = toGeminiJsonSchema(z.object({ events: z.array(EventSchema).max(12) }));

export interface ExtractResult {
  events: ExtractedEvent[];
  /** Events the model returned that failed validation (V11) or referenced an unknown doc id. */
  invalid: Array<{ index: number; issues: string }>;
  calls: number;
  /** Docs that were never sent because the call cap was reached. Caller must mark the VC PARTIAL, never QUIET. */
  skippedDocIds: string[];
  error?: string;
}

/** Gemini `extract`: structured, NO tools. Up to 6 docs per call, more docs => more calls. */
export async function extractEvents(
  gemini: GeminiClient,
  a: { company: CompanyContext; target: TargetInvestor; docs: SourceDoc[]; runId?: string | null; vcId?: string | null },
): Promise<ExtractResult> {
  const out: ExtractResult = { events: [], invalid: [], calls: 0, skippedDocIds: [] };
  for (let i = 0; i < a.docs.length; i += MAX_DOCS_PER_CALL) {
    const batch = a.docs.slice(i, i + MAX_DOCS_PER_CALL);
    const ids = new Set(batch.map((d) => d.id));
    try {
      const r = await gemini.call({
        purpose: "extract",
        runId: a.runId,
        vcId: a.vcId,
        system: EXTRACT_SYSTEM,
        prompt: buildExtractPrompt(a.company, a.target, batch),
        schema: LenientOutput,
        jsonSchema: lenientJsonSchema,
        thinking: "low",
      });
      out.calls++;
      (r.data?.events ?? []).forEach((raw, idx) => {
        const p = EventSchema.safeParse(raw);
        if (!p.success) out.invalid.push({ index: i + idx, issues: p.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        else if (!ids.has(p.data.doc_id)) out.invalid.push({ index: i + idx, issues: `unknown doc_id ${p.data.doc_id}` });
        else out.events.push(p.data);
      });
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      out.error = `${e.kind}: ${e.detail ?? e.message}`;
      // Everything from this batch on was not (successfully) interpreted.
      out.skippedDocIds.push(...a.docs.slice(i).map((d) => d.id));
      break;
    }
  }
  return out;
}

const DisambiguateSchema = z.object({ is_target_vc: z.boolean(), reason: z.string().max(300) });

export async function disambiguate(
  gemini: GeminiClient,
  a: { target: TargetInvestor; title: string; excerpt: string; runId?: string | null; vcId?: string | null },
): Promise<{ is_target_vc: boolean; reason: string } | null> {
  try {
    const r = await gemini.call({
      purpose: "disambiguate",
      runId: a.runId,
      vcId: a.vcId,
      system: DISAMBIGUATE_SYSTEM,
      prompt: buildDisambiguatePrompt(a.target, a.title, a.excerpt),
      schema: DisambiguateSchema,
      jsonSchema: toGeminiJsonSchema(DisambiguateSchema),
      thinking: "low",
    });
    return r.data;
  } catch (e) {
    if (e instanceof GeminiError) return null; // unknown stays unknown: the caller rejects AMBIGUOUS_ENTITY
    throw e;
  }
}

export interface GroundedSource {
  title: string | null;
  /** The redirect URI Gemini returned (vertexaisearch...) */
  uri: string;
}

export interface GroundedDiscovery {
  ok: boolean;
  model: string | null;
  sources: GroundedSource[];
  searchQueries: string[];
  /** Free text from the model. NEVER trusted or parsed for facts; kept only for the audit log. */
  proseForAudit: string;
  error?: string;
}

/**
 * discover_grounded: googleSearch tool, then we harvest ONLY the grounding sources (title + URL). The prose is not evidence.
 * Pages are fetched by us afterwards and interpreted by the tool-free `extract` call. If grounding is not allowed on the
 * configured models (e.g. Gemini 3.x on the free tier) the call fails over and finally reports ok:false: the channel is
 * marked failed (=> PARTIAL coverage), never treated as "nothing found".
 */
export async function discoverGrounded(
  gemini: GeminiClient,
  a: { target: { firm: string; aliases: string[] }; windowStart: string; today: string; runId?: string | null; vcId?: string | null },
): Promise<GroundedDiscovery> {
  try {
    const r = await gemini.call({
      purpose: "discover_grounded",
      runId: a.runId,
      vcId: a.vcId,
      prompt: buildGroundedDiscoveryPrompt(a.target, a.windowStart, a.today),
      grounded: true,
      thinking: "low",
    });
    const seen = new Set<string>();
    const sources: GroundedSource[] = [];
    for (const c of r.groundingChunks) {
      if (!c.uri || seen.has(c.uri)) continue;
      seen.add(c.uri);
      sources.push({ title: c.title ?? null, uri: c.uri });
    }
    return { ok: true, model: r.model, sources, searchQueries: r.searchQueries, proseForAudit: r.text.slice(0, 2000) };
  } catch (e) {
    if (e instanceof GeminiError) return { ok: false, model: null, sources: [], searchQueries: [], proseForAudit: "", error: `${e.kind}: ${e.detail ?? e.message}` };
    throw e;
  }
}
