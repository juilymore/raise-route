import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import pLimit from "p-limit";
import { z, type ZodType } from "zod";

/**
 * The ONLY door to a language model in this app (exam rule: Gemini Flash only, no Claude).
 * Verified against @google/genai 2.28.0 type definitions and a live call on 2026-10-12:
 *   - ai.models.generateContent({ model, contents, config })
 *   - config.responseMimeType + config.responseJsonSchema for structured output
 *   - config.thinkingConfig.thinkingLevel (Gemini 3.x, ThinkingLevel.LOW) or thinkingBudget (2.5) - never both
 *   - config.tools = [{ googleSearch: {} }] for grounding; groundingMetadata.groundingChunks[].web.{uri,title}
 *   - usageMetadata.{promptTokenCount, candidatesTokenCount, thoughtsTokenCount}; errors are ApiError with .status
 * Every request (including retries and repairs) writes one llm_calls ledger row. The DB rejects non-gemini-* models.
 */
export type Purpose = "discover_grounded" | "extract" | "disambiguate" | "outreach_draft" | "digest_summary" | "profile_enrich" | "healthcheck";
export type LedgerStatus = "ok" | "retried" | "rate_limited" | "invalid_output" | "error";

export interface LedgerRow {
  run_id: string | null;
  vc_id: string | null;
  purpose: Purpose;
  model: string;
  grounded: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  status: LedgerStatus;
  error: string | null;
}

export interface GeminiConfig {
  /** Tried in order: primary then fallbacks. All must start with "gemini-". */
  models: string[];
  maxCallsPerRun: number;
  concurrency: number;
  /** Max seconds we are willing to wait for a 429 retryDelay before falling back to the next model. */
  maxRetryWaitSeconds?: number;
}

export interface TransportRequest {
  model: string;
  contents: string;
  system?: string;
  jsonSchema?: unknown;
  grounded: boolean;
  thinking: "low" | "none";
  signal?: AbortSignal;
}

export interface TransportResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  groundingChunks: Array<{ uri?: string; title?: string }>;
  searchQueries: string[];
}

export interface Transport {
  generate(req: TransportRequest): Promise<TransportResponse>;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public kind: "CAP_REACHED" | "UNAVAILABLE" | "INVALID_OUTPUT" | "AUTH" | "NO_KEY",
    public detail?: string,
  ) {
    super(message);
  }
}

const is3x = (model: string) => /^gemini-3/.test(model);

export function createSdkTransport(apiKey: string): Transport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(req) {
      const config: Record<string, unknown> = {};
      if (req.system) config.systemInstruction = req.system;
      if (req.jsonSchema) {
        config.responseMimeType = "application/json";
        config.responseJsonSchema = req.jsonSchema;
      }
      if (req.grounded) config.tools = [{ googleSearch: {} }];
      // Gemini 3.x: thinkingLevel (default is HIGH = slower/costlier). 2.5: a small thinkingBudget instead. Never both.
      if (req.thinking === "low") config.thinkingConfig = is3x(req.model) ? { thinkingLevel: ThinkingLevel.LOW } : { thinkingBudget: 256 };
      // A hung request must not stall a whole run: hard 90 s timeout per request unless the caller supplies its own signal.
      config.abortSignal = req.signal ?? AbortSignal.timeout(90_000);
      // temperature is intentionally left at the default (1.0): lower values can loop or degrade Gemini 3.x output.
      const res = await ai.models.generateContent({ model: req.model, contents: req.contents, config });
      const gm = res.candidates?.[0]?.groundingMetadata;
      const u = res.usageMetadata;
      return {
        text: res.text ?? "",
        inputTokens: u?.promptTokenCount,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        groundingChunks: (gm?.groundingChunks ?? []).map((c) => ({ uri: c.web?.uri, title: c.web?.title })),
        searchQueries: gm?.webSearchQueries ?? [],
      };
    },
  };
}

/** Pull "retry in 13s" / "retryDelay":"13s" out of a 429 error message. */
export function parseRetryDelaySeconds(message: string): number | null {
  const m = message.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) ?? message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(parseFloat(m[1]!)) : null;
}

export function stripJsonFences(t: string): string {
  const m = t.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (m ? m[1]! : t).trim();
}

export interface CallOptions<T> {
  purpose: Purpose;
  runId?: string | null;
  vcId?: string | null;
  system?: string;
  prompt: string;
  schema?: ZodType<T>;
  /** JSON Schema sent to Gemini; derive with toGeminiJsonSchema(schema). */
  jsonSchema?: unknown;
  grounded?: boolean;
  thinking?: "low" | "none";
  signal?: AbortSignal;
}

export interface CallResult<T> {
  data: T | null;
  text: string;
  model: string;
  groundingChunks: Array<{ uri?: string; title?: string }>;
  searchQueries: string[];
}

export class GeminiClient {
  private calls = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private searchCalls = 0;
  private limit: ReturnType<typeof pLimit>;

  constructor(
    private cfg: GeminiConfig,
    private transport: Transport,
    private ledger: (row: LedgerRow) => Promise<void>,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (cfg.models.length === 0 || cfg.models.some((m) => !m.startsWith("gemini-"))) throw new Error("GeminiClient: models must be non-empty and all gemini-*");
    this.limit = pLimit(cfg.concurrency);
  }

  stats() {
    return { llm_calls: this.calls, llm_tokens_in: this.tokensIn, llm_tokens_out: this.tokensOut, search_calls: this.searchCalls, cap: this.cfg.maxCallsPerRun };
  }
  /** The cap is per RUN: when a run continues in a new invocation, calls already in the ledger are counted here. */
  setCallsUsed(n: number) {
    this.calls = n;
  }
  get capReached() {
    return this.calls >= this.cfg.maxCallsPerRun;
  }

  /** One logical call: model fallback, 429 backoff, 404 immediate fallback, schema validation + ONE repair retry. */
  call<T = unknown>(opts: CallOptions<T>): Promise<CallResult<T>> {
    return this.limit(() => this.callInner(opts));
  }

  private async record(opts: CallOptions<unknown>, model: string, started: number, status: LedgerStatus, r?: TransportResponse, error?: string) {
    await this.ledger({
      run_id: opts.runId ?? null,
      vc_id: opts.vcId ?? null,
      purpose: opts.purpose,
      model,
      grounded: !!opts.grounded,
      input_tokens: r?.inputTokens ?? null,
      output_tokens: r?.outputTokens ?? null,
      latency_ms: Date.now() - started,
      status,
      error: error ? error.slice(0, 500) : null,
    }).catch((e) => console.error("[llm ledger] write failed:", (e as Error).message));
  }

  private async callInner<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
    let lastError = "no attempt made";
    let attemptsMade = 0;
    for (const model of this.cfg.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (this.calls >= this.cfg.maxCallsPerRun) throw new GeminiError(`LLM call cap reached (${this.cfg.maxCallsPerRun} per run)`, "CAP_REACHED");
        this.calls++;
        attemptsMade++;
        const started = Date.now();
        let resp: TransportResponse;
        try {
          resp = await this.transport.generate({
            model,
            contents: opts.prompt,
            system: opts.system,
            jsonSchema: opts.jsonSchema,
            grounded: !!opts.grounded,
            thinking: opts.thinking ?? "low",
            signal: opts.signal,
          });
        } catch (e) {
          const err = e as Error & { status?: number };
          const status = err.status ?? 0;
          lastError = `${model}: HTTP ${status || "?"} ${err.message}`.slice(0, 400);
          if (status === 401) {
            await this.record(opts, model, started, "error", undefined, lastError);
            throw new GeminiError("Gemini rejected the API key", "AUTH", lastError);
          }
          if (status === 429) {
            await this.record(opts, model, started, "rate_limited", undefined, lastError);
            const wait = parseRetryDelaySeconds(err.message);
            const max = this.cfg.maxRetryWaitSeconds ?? 20;
            if (attempt === 1 && (wait === null || wait <= max)) {
              await this.sleep((wait ?? 5) * 1000);
              continue;
            }
            break; // persistent 429 -> next model
          }
          await this.record(opts, model, started, "error", undefined, lastError);
          if (status === 404 || status === 400 || status === 403) break; // retired id / unsupported feature / not allowed -> next model immediately
          if (attempt === 1) {
            await this.sleep(1000);
            continue;
          }
          break;
        }
        this.tokensIn += resp.inputTokens ?? 0;
        this.tokensOut += resp.outputTokens ?? 0;
        if (opts.grounded) this.searchCalls += Math.max(1, resp.searchQueries.length);
        const retried = attemptsMade > 1;

        if (!opts.schema) {
          await this.record(opts, model, started, retried ? "retried" : "ok", resp);
          return { data: null, text: resp.text, model, groundingChunks: resp.groundingChunks, searchQueries: resp.searchQueries };
        }
        const parsed = this.parse(opts.schema, resp.text);
        if (parsed.ok) {
          await this.record(opts, model, started, retried ? "retried" : "ok", resp);
          return { data: parsed.data, text: resp.text, model, groundingChunks: resp.groundingChunks, searchQueries: resp.searchQueries };
        }
        // invalid output: ONE repair retry on the same model
        await this.record(opts, model, started, "invalid_output", resp, parsed.error);
        return this.repair(opts, model, resp.text, parsed.error);
      }
    }
    throw new GeminiError(`Gemini unavailable on every configured model: ${lastError}`, "UNAVAILABLE", lastError);
  }

  private parse<T>(schema: ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(stripJsonFences(text));
    } catch (e) {
      return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
    }
    const r = schema.safeParse(raw);
    return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  }

  private async repair<T>(opts: CallOptions<T>, model: string, badText: string, issues: string): Promise<CallResult<T>> {
    if (this.calls >= this.cfg.maxCallsPerRun) throw new GeminiError("LLM call cap reached before the repair retry", "CAP_REACHED");
    this.calls++;
    const started = Date.now();
    const prompt = `${opts.prompt}\n\nYour previous answer was rejected by a validator.\nPrevious answer:\n${badText.slice(0, 3000)}\nProblems: ${issues}\nReturn corrected JSON only, matching the required schema.`;
    let resp: TransportResponse;
    try {
      resp = await this.transport.generate({ model, contents: prompt, system: opts.system, jsonSchema: opts.jsonSchema, grounded: !!opts.grounded, thinking: opts.thinking ?? "low", signal: opts.signal });
    } catch (e) {
      await this.record(opts, model, started, "error", undefined, (e as Error).message);
      throw new GeminiError("repair call failed", "UNAVAILABLE", (e as Error).message);
    }
    this.tokensIn += resp.inputTokens ?? 0;
    this.tokensOut += resp.outputTokens ?? 0;
    const parsed = this.parse(opts.schema!, resp.text);
    if (parsed.ok) {
      await this.record(opts, model, started, "retried", resp);
      return { data: parsed.data, text: resp.text, model, groundingChunks: resp.groundingChunks, searchQueries: resp.searchQueries };
    }
    await this.record(opts, model, started, "invalid_output", resp, parsed.error);
    throw new GeminiError("Gemini output failed validation after one repair retry", "INVALID_OUTPUT", parsed.error);
  }
}

/**
 * Keywords the Gemini structured-output endpoint rejects with HTTP 400 INVALID_ARGUMENT (found by bisecting live on 2026-10-12).
 * Our zod schema still enforces every one of them on the response (V11), so stripping them only loosens what the model is TOLD.
 */
const GEMINI_UNSUPPORTED = new Set(["pattern", "additionalProperties", "maxItems", "minItems", "maxLength", "minLength", "minimum", "maximum", "format", "$schema"]);

export function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([k]) => !GEMINI_UNSUPPORTED.has(k))
        .map(([k, v]) => [k, stripUnsupported(v)]),
    );
  }
  return node;
}

/** zod -> JSON Schema for responseJsonSchema. */
export function toGeminiJsonSchema(schema: ZodType): unknown {
  return stripUnsupported(z.toJSONSchema(schema, { target: "draft-7" }));
}
