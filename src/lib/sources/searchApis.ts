import { toCandidate } from "./candidates";
import type { Candidate } from "./types";

/**
 * Channel E (optional): Tavily / Exa raw search results. EXAM RULE: all AI is Gemini, so we use ONLY the raw result list
 * (url, title, date). Never the providers' answer/LLM features: Tavily include_answer is always false, Exa's answer endpoint is never called.
 * Skipped (returns []) when no API key is configured. Verified request shapes from the providers' public docs; not live-tested (no keys).
 */
type Post = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultPost: Post = (url, init) => fetch(url, { method: "POST", headers: init.headers, body: init.body, signal: AbortSignal.timeout(15000) });

export function tavilyRequestBody(query: string, maxResults = 8) {
  return { query, topic: "news", days: 30, include_answer: false, include_raw_content: false, max_results: maxResults };
}

export function exaRequestBody(query: string, startPublishedDate: string, numResults = 8) {
  return { query, type: "auto", numResults, startPublishedDate };
}

export async function searchTavily(query: string, apiKey: string | undefined, post: Post = defaultPost): Promise<Candidate[]> {
  if (!apiKey) return [];
  const r = await post("https://api.tavily.com/search", {
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(tavilyRequestBody(query)),
  });
  if (!r.ok) throw new Error(`tavily HTTP ${r.status}`);
  const j = (await r.json()) as { results?: Array<{ url?: string; title?: string; published_date?: string; content?: string }> };
  return (j.results ?? [])
    .map((x) => (x.url ? toCandidate({ url: x.url, channel: "search_api", title: x.title, publishedHint: x.published_date ?? null, sourceName: "tavily", snippet: x.content?.slice(0, 300) }) : null))
    .filter((c): c is Candidate => c !== null);
}

export async function searchExa(query: string, windowStart: string, apiKey: string | undefined, post: Post = defaultPost): Promise<Candidate[]> {
  if (!apiKey) return [];
  const r = await post("https://api.exa.ai/search", {
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(exaRequestBody(query, `${windowStart}T00:00:00.000Z`)),
  });
  if (!r.ok) throw new Error(`exa HTTP ${r.status}`);
  const j = (await r.json()) as { results?: Array<{ url?: string; title?: string; publishedDate?: string }> };
  return (j.results ?? [])
    .map((x) => (x.url ? toCandidate({ url: x.url, channel: "search_api", title: x.title, publishedHint: x.publishedDate ?? null, sourceName: "exa" }) : null))
    .filter((c): c is Candidate => c !== null);
}
