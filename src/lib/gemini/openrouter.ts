import type { Transport, TransportRequest, TransportResponse } from "./client";

/**
 * Transport that reaches the SAME Gemini models through OpenRouter's chat-completions API (https://openrouter.ai/api/v1).
 * Verified live on 2026-10-12 with google/gemini-3.7-flash.
 * - Model ids stay "gemini-*" inside the app (ledger, DB constraint); this maps "gemini-3.7-flash" -> "google/gemini-3.7-flash".
 * - Structured output: response_format json_schema. Reasoning effort maps from our thinking level.
 * - Search grounding is a Google API feature and is NOT available here: `grounded` calls are refused so the pipeline
 *   falls back to its other channels (set GEMINI_ENABLE_GROUNDING=false). It never pretends to have searched.
 */
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function createOpenRouterTransport(apiKey: string, fetchImpl: typeof fetch = fetch): Transport {
  return {
    async generate(req: TransportRequest): Promise<TransportResponse> {
      if (req.grounded) {
        const e = new Error("search grounding is not available through OpenRouter") as Error & { status?: number };
        e.status = 400;
        throw e;
      }
      const messages: Array<{ role: string; content: string }> = [];
      if (req.system) messages.push({ role: "system", content: req.system });
      messages.push({ role: "user", content: req.contents });
      const body: Record<string, unknown> = { model: `google/${req.model}`, messages };
      if (req.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "result", schema: req.jsonSchema } };
      if (req.thinking === "low") body.reasoning = { effort: "low" };
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(90_000),
      });
      const raw = await res.text();
      if (!res.ok) {
        const e = new Error(raw.slice(0, 300)) as Error & { status?: number };
        e.status = res.status;
        throw e;
      }
      let j: { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string; code?: number } };
      try {
        j = JSON.parse(raw);
      } catch {
        throw Object.assign(new Error("OpenRouter returned a non-JSON body"), { status: 502 });
      }
      if (j.error) throw Object.assign(new Error(j.error.message ?? "OpenRouter error"), { status: j.error.code ?? 502 });
      return {
        text: j.choices?.[0]?.message?.content ?? "",
        inputTokens: j.usage?.prompt_tokens,
        outputTokens: j.usage?.completion_tokens,
        groundingChunks: [],
        searchQueries: [],
      };
    },
  };
}
