import { getAccessToken } from "./auth.js";

export const BASE_URL = "https://api.linkedin.com/rest";

export class LinkedInError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "LinkedInError";
  }
}

function apiVersion(): string {
  return process.env.LINKEDIN_API_VERSION ?? "202504";
}

async function liFetch<T>(method: string, url: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": apiVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      Accept: "application/json",
    },
  });
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

/** GET with auto-encoded query params. For simple list/filter endpoints. */
export async function liGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return liFetch<T>("GET", url.toString());
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
