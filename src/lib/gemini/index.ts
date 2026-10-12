import { getEnv, requireEnv } from "@/lib/env";
import { GeminiClient, createSdkTransport, type LedgerRow, type Transport } from "./client";

export * from "./client";
export * from "./prompts";
export * from "./tasks";

/** Build the per-run client from env. `ledger` defaults to the llm_calls table through pipelineDb (the only DB surface pipeline code may use). */
export async function createGeminiFromEnv(opts: { transport?: Transport; ledger?: (row: LedgerRow) => Promise<void>; models?: string[] } = {}): Promise<GeminiClient> {
  const env = getEnv();
  const transport = opts.transport ?? createSdkTransport(requireEnv("GEMINI_API_KEY"));
  let ledger = opts.ledger;
  if (!ledger) {
    const { pipelineDb } = await import("@/lib/db/pipelineDb");
    ledger = async (row) => {
      await pipelineDb.insert("llm_calls", row as unknown as Record<string, unknown>);
    };
  }
  return new GeminiClient(
    { models: opts.models ?? [env.GEMINI_MODEL_PRIMARY, ...env.GEMINI_MODEL_FALLBACKS], maxCallsPerRun: env.LLM_MAX_CALLS_PER_RUN, concurrency: env.LLM_MAX_CONCURRENCY },
    transport,
    ledger,
  );
}
