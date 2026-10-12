import { describe, expect, it } from "vitest";
import { createOpenRouterTransport } from "@/lib/gemini/openrouter";

const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("OpenRouter transport (same Gemini models)", () => {
  it("maps the model id, sends the schema and reads text + usage", async () => {
    let sent: Record<string, unknown> = {};
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"a\":1}" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    }) as unknown as typeof fetch;
    const r = await createOpenRouterTransport("k", f).generate({ model: "gemini-3.7-flash", contents: "hi", system: "sys", jsonSchema: { type: "object" }, grounded: false, thinking: "low" });
    expect(sent.model).toBe("google/gemini-3.7-flash");
    expect(sent.response_format).toBeTruthy();
    expect(r).toMatchObject({ text: "{\"a\":1}", inputTokens: 5, outputTokens: 2, groundingChunks: [] });
  });
  it("refuses grounded calls (never pretends to have searched) and surfaces HTTP status", async () => {
    const t = createOpenRouterTransport("k", ok({}));
    await expect(t.generate({ model: "gemini-3.7-flash", contents: "x", grounded: true, thinking: "low" })).rejects.toMatchObject({ status: 400 });
    const bad = createOpenRouterTransport("k", ok({ error: { message: "no" } }, 401));
    await expect(bad.generate({ model: "gemini-3.7-flash", contents: "x", grounded: false, thinking: "low" })).rejects.toMatchObject({ status: 401 });
  });
});
