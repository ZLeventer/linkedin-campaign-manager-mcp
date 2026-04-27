import { getAccessToken } from "./auth.js";

export const BASE_URL = "https://api.linkedin.com/rest";

export class LinkedInError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "LinkedInError";
  }
}

const DEFAULT_API_VERSION = "202604";
let warnedDefaultVersion = false;

function apiVersion(): string {
  const v = process.env.LINKEDIN_API_VERSION;
  if (v) return v;
  if (!warnedDefaultVersion) {
    warnedDefaultVersion = true;
    console.error(
      `[linkedin-mcp] LINKEDIN_API_VERSION not set; defaulting to ${DEFAULT_API_VERSION}. ` +
      `LinkedIn rotates Rest versions ~quarterly — pin a current version in .env to avoid silent breakage.`
    );
  }
  return DEFAULT_API_VERSION;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function liFetch<T>(method: string, url: string): Promise<T> {
  const token = await getAccessToken();
  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": apiVersion(),
          "X-Restli-Protocol-Version": "2.0.0",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        throw new LinkedInError(
          `LinkedIn ${method} ${url} → request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      throw err;
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      const backoff = retryAfter ?? Math.min(30_000, 1000 * 2 ** attempt);
      await sleep(backoff);
      attempt++;
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new LinkedInError(
        `LinkedIn ${method} ${url} → ${res.status}: ${text.slice(0, 500)}`,
        res.status,
        text
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}

/** GET with auto-encoded query params. For simple list/filter endpoints.
 *  Pass `rawParams` for Rest.li values (e.g. `search=(status:(values:List(ACTIVE)))`)
 *  that must NOT be percent-encoded — they're appended to the URL as-is. */
export async function liGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  rawParams?: Record<string, string>
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  let finalUrl = url.toString();
  if (rawParams) {
    const raw = Object.entries(rawParams)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    if (raw) finalUrl += (finalUrl.includes("?") ? "&" : "?") + raw;
  }
  return liFetch<T>("GET", finalUrl);
}

/** GET with a fully-constructed URL. Use for endpoints (adAnalytics) that need
 *  hand-encoded Rest.li params like dateRange=(start:(year:...)) and
 *  campaigns=List(urn:li:...) where URLSearchParams would mangle nested structure. */
export async function liGetRaw<T = unknown>(url: string): Promise<T> {
  return liFetch<T>("GET", url);
}

// ─── URN helpers ─────────────────────────────────────────────────────────────

export type URNType =
  | "sponsoredAccount"
  | "sponsoredCampaign"
  | "sponsoredCampaignGroup"
  | "sponsoredCreative"
  | "leadGenForm"
  | "conversionEvent"
  | "organization"
  | "member";

/** Wrap a bare ID in a LinkedIn URN. Idempotent — already-URN inputs pass through. */
export function urn(type: URNType, id: string | number): string {
  const s = String(id).trim();
  if (s.startsWith("urn:li:")) return s;
  return `urn:li:${type}:${s}`;
}

/** Extract the last segment from a URN. `urn:li:sponsoredAccount:123` → `123`. */
export function unwrapURN(u: string): string {
  const parts = u.split(":");
  return parts[parts.length - 1] ?? u;
}

/** Resolve an ad account from arg override or LINKEDIN_DEFAULT_AD_ACCOUNT env. Returns full URN. */
export function resolveAdAccount(override?: string): string {
  const v = (override ?? process.env.LINKEDIN_DEFAULT_AD_ACCOUNT ?? "").trim();
  if (!v) {
    throw new LinkedInError(
      "No ad account provided. Pass ad_account_id or set LINKEDIN_DEFAULT_AD_ACCOUNT in .env."
    );
  }
  return urn("sponsoredAccount", v);
}

// ─── Date helpers ────────────────────────────────────────────────────────────
//
// LinkedIn's adAnalytics endpoint takes dateRange as nested year/month/day
// objects — NOT ISO strings. Example URL fragment:
//   dateRange=(start:(year:2024,month:10,day:1),end:(year:2024,month:10,day:31))
//
// All date math here runs in UTC. LinkedIn interprets dateRange against the
// account's timezone, so a UTC "yesterday" can be off by one calendar day for
// accounts in non-UTC zones late at night. Pass an explicit YYYY-MM-DD when
// account-timezone alignment matters.

export const DEFAULT_START = "28daysAgo";
export const DEFAULT_END = "yesterday";

export interface LIDate {
  year: number;
  month: number;
  day: number;
}

export function resolveDate(d: string): LIDate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return { year: y!, month: m!, day: day! };
  }
  if (d === "today") return toLIDate(new Date());
  if (d === "yesterday") return toLIDate(offsetDays(new Date(), -1));
  const match = d.match(/^(\d+)daysAgo$/);
  if (match) return toLIDate(offsetDays(new Date(), -parseInt(match[1]!, 10)));
  throw new LinkedInError(`Unrecognized date: ${d}. Use YYYY-MM-DD, today, yesterday, or NdaysAgo.`);
}

function offsetDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function toLIDate(d: Date): LIDate {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Build the `(start:(year:Y,month:M,day:D),end:(...))` fragment. Caller URL-encodes. */
export function dateRangeParam(start: LIDate, end: LIDate): string {
  return `(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))`;
}

/** Build the `List(a,b,c)` fragment. Caller URL-encodes. */
export function listParam(items: string[]): string {
  return `List(${items.join(",")})`;
}
