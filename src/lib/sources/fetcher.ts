import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import type { SourcesConfig } from "@/lib/config";
import { assertPublicAddresses, checkUrlSyntax } from "@/lib/engine/ssrf";
import type { FetchResult } from "./types";

/**
 * SSRF-safe fetcher (docs/05 section 2). On EVERY hop (first request and each redirect):
 *   scheme/credentials/port/name rules -> DNS resolve -> every address must be public -> connect to the validated address
 *   (pinned, so a DNS answer cannot change between check and connect).
 * Plus: timeout, size cap, max redirects, robots.txt, per-domain delay, bot User-Agent, no cookies, never_fetch list.
 */
export interface FetcherDeps {
  /** Resolve a hostname to addresses. Default: dns.lookup(all). Injectable for tests. */
  resolve?: (host: string) => Promise<string[]>;
  /** Perform one HTTP request WITHOUT following redirects. Default: undici with a pinned address. Injectable for tests. */
  request?: (url: URL, init: { headers: Record<string, string>; signal: AbortSignal; pinnedAddress: string }) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultResolve = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

async function defaultRequest(url: URL, init: { headers: Record<string, string>; signal: AbortSignal; pinnedAddress: string }): Promise<Response> {
  const family = init.pinnedAddress.includes(":") ? 6 : 4;
  const agent = new Agent({
    connect: {
      // Connect to the address we already validated, whatever DNS says now.
      lookup: (_host, opts, cb) => {
        const o = opts as { all?: boolean };
        if (o?.all) (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: init.pinnedAddress, family }]);
        else (cb as unknown as (e: null, a: string, f: number) => void)(null, init.pinnedAddress, family);
      },
    },
  });
  try {
    const res = await undiciFetch(url, { method: "GET", redirect: "manual", headers: init.headers, signal: init.signal, dispatcher: agent });
    // Buffer the body before the agent is closed.
    const buf = await readCapped(res.body as ReadableStream<Uint8Array> | null, MAX_READ_HARD_CAP);
    return new Response(buf.bytes as unknown as BodyInit, { status: res.status, headers: res.headers as unknown as HeadersInit });
  } finally {
    void agent.close();
  }
}

const MAX_READ_HARD_CAP = 8_000_000;

async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!body) return { bytes: new Uint8Array(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= cap) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, cap));
  let off = 0;
  for (const c of chunks) {
    const room = out.length - off;
    if (room <= 0) break;
    out.set(c.subarray(0, room), off);
    off += Math.min(c.byteLength, room);
  }
  return { bytes: out, truncated };
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const m = contentType.match(/charset=["']?([\w-]+)/i);
  try {
    return new TextDecoder(m?.[1] ?? "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Minimal robots.txt: the group for our UA token (or *), longest matching Allow/Disallow wins, Allow wins ties. */
export function robotsAllows(robotsTxt: string, path: string, uaToken: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i < 0) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    const v = l.slice(i + 1).trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if ((k === "allow" || k === "disallow") && cur) {
      cur.rules.push({ allow: k === "allow", path: v });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const token = uaToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.path === "") continue; // empty Disallow = allow everything
      const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
  }
  return best ? best.allow : true;
}

export class SafeFetcher {
  private lastHit = new Map<string, number>();
  private robotsCache = new Map<string, { at: number; txt: string | null }>();
  private cache = new Map<string, FetchResult>();

  constructor(
    private cfg: SourcesConfig,
    private deps: FetcherDeps = {},
  ) {}

  private get uaToken() {
    return this.cfg.fetch.user_agent.split("/")[0] ?? "bot";
  }

  private async politeDelay(host: string) {
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const wait = (this.lastHit.get(host) ?? 0) + this.cfg.fetch.per_domain_delay_ms - now();
    if (wait > 0) await sleep(wait);
    this.lastHit.set(host, now());
  }

  /** One validated hop. Returns the raw response or a blocked/failed marker. */
  private async hop(url: URL): Promise<{ res: Response } | { err: { code: string; msg: string } }> {
    const syn = checkUrlSyntax(url.toString(), {
      allowedSchemes: this.cfg.fetch.allowed_schemes,
      neverFetch: this.cfg.domain_classes.never_fetch,
    });
    if (!syn.ok) return { err: { code: "SSRF_BLOCKED", msg: syn.detail } };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addrs: string[];
    try {
      addrs = /^[\d.]+$|:/.test(host) ? [host] : await (this.deps.resolve ?? defaultResolve)(host);
    } catch (e) {
      return { err: { code: "NETWORK", msg: `DNS failure: ${(e as Error).message}` } };
    }
    const pub = assertPublicAddresses(addrs);
    if (!pub.ok) return { err: { code: "SSRF_BLOCKED", msg: pub.detail } };
    await this.politeDelay(url.hostname);
    const signal = AbortSignal.timeout(this.cfg.fetch.timeout_ms);
    try {
      const res = await (this.deps.request ?? defaultRequest)(url, {
        headers: { "user-agent": this.cfg.fetch.user_agent, accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5", "accept-language": "en" },
        signal,
        pinnedAddress: addrs[0]!,
      });
      return { res };
    } catch (e) {
      const name = (e as Error).name;
      return { err: { code: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK", msg: (e as Error).message } };
    }
  }

  private async robotsOk(url: URL): Promise<boolean> {
    if (!this.cfg.fetch.respect_robots_txt) return true;
    const origin = url.origin;
    let entry = this.robotsCache.get(origin);
    if (!entry || (this.deps.now ?? Date.now)() - entry.at > 3_600_000) {
      let txt: string | null = null;
      let robotsUrl = new URL("/robots.txt", origin);
      // RFC 9309: follow up to 5 redirects for robots.txt; every hop is SSRF-validated by hop().
      for (let i = 0; i <= 5; i++) {
        const r = await this.hop(robotsUrl);
        if (!("res" in r)) break;
        if ([301, 302, 303, 307, 308].includes(r.res.status)) {
          const loc = r.res.headers.get("location");
          if (!loc) break;
          try {
            robotsUrl = new URL(loc, robotsUrl);
          } catch {
            break;
          }
          continue;
        }
        if (r.res.status === 200) {
          const buf = await readCapped(r.res.body, 200_000);
          txt = decodeBody(buf.bytes, r.res.headers.get("content-type") ?? "");
        }
        break;
      } // 404 / errors => no robots rules known => allowed (RFC 9309: unavailable means allow)
      entry = { at: (this.deps.now ?? Date.now)(), txt };
      this.robotsCache.set(origin, entry);
    }
    return entry.txt === null ? true : robotsAllows(entry.txt, url.pathname + url.search, this.uaToken);
  }

  async fetch(rawUrl: string, opts: { useCache?: boolean; skipRobots?: boolean } = {}): Promise<FetchResult> {
    const useCache = opts.useCache ?? true;
    const skipRobots = opts.skipRobots ?? false;
    // Cache key includes skipRobots: a result fetched while ignoring robots.txt must never be served to a caller that must honour it.
    const key = `${skipRobots ? "norobots" : "robots"}|${rawUrl}`;
    if (useCache && this.cache.has(key)) return this.cache.get(key)!;
    const result = await this.fetchUncached(rawUrl, skipRobots);
    // Transient failures (network, timeout, 5xx) are not cached so a later call in the same run can retry.
    const transient = result.errorCode === "NETWORK" || result.errorCode === "TIMEOUT" || result.status >= 500;
    if (useCache && !transient) this.cache.set(key, result);
    return result;
  }

  private async fetchUncached(rawUrl: string, skipRobots: boolean): Promise<FetchResult> {
    const base: FetchResult = { ok: false, status: 0, url: rawUrl, finalUrl: rawUrl, contentType: "", body: "", truncated: false, redirects: [] };
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ...base, errorCode: "SSRF_BLOCKED", error: "not a valid URL" };
    }
    for (let i = 0; i <= this.cfg.fetch.max_redirects; i++) {
      if (!skipRobots && !(await this.robotsOk(url).catch(() => true))) {
        return { ...base, finalUrl: url.toString(), errorCode: "ROBOTS_DISALLOWED", error: "disallowed by robots.txt" };
      }
      const h = await this.hop(url);
      if ("err" in h) return { ...base, finalUrl: url.toString(), errorCode: h.err.code, error: h.err.msg };
      const res = h.res;
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { ...base, status: res.status, finalUrl: url.toString(), errorCode: "HTTP", error: "redirect without Location" };
        try {
          url = new URL(loc, url);
        } catch {
          return { ...base, status: res.status, errorCode: "HTTP", error: "bad redirect Location" };
        }
        base.redirects.push(url.toString());
        continue; // the next loop iteration re-validates the new target (SSRF re-check after each redirect)
      }
      const ct = res.headers.get("content-type") ?? "";
      const buf = await readCapped(res.body, this.cfg.fetch.max_bytes);
      const body = decodeBody(buf.bytes, ct);
      const ok = res.status >= 200 && res.status < 300;
      return {
        ...base,
        ok,
        status: res.status,
        finalUrl: url.toString(),
        contentType: ct,
        body,
        truncated: buf.truncated,
        errorCode: ok ? undefined : "HTTP",
        error: ok ? undefined : `HTTP ${res.status}`,
      };
    }
    return { ...base, finalUrl: url.toString(), errorCode: "REDIRECT_LOOP", error: `more than ${this.cfg.fetch.max_redirects} redirects` };
  }
}
