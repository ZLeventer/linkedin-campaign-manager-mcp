import { z } from "zod";
import {
  BASE_URL,
  dateRangeParam,
  DEFAULT_END,
  DEFAULT_START,
  liGet,
  liGetRaw,
  resolveAdAccount,
  resolveDate,
  urn,
} from "../client.js";

const FORM_STATES = ["DRAFT", "SUBMITTED", "ACTIVE", "ARCHIVED"] as const;

function parseUtcDateMs(s: string): number | null {
  // Treat bare YYYY-MM-DD as UTC midnight regardless of host locale/Node version.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + "T00:00:00Z");
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ─── get-leadgen-forms ──────────────────────────────────────────────────────

export const getLeadgenFormsSchema = {
  ad_account_id: z.string().optional(),
  state: z
    .enum(FORM_STATES)
    .optional()
    .describe("Filter by form state. ACTIVE forms are live on ads. DRAFT forms are not yet submitted for review."),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function getLeadgenForms(args: {
  ad_account_id?: string;
  state?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const params: Record<string, string | number> = {
    q: "account",
    account,
    pageSize: args.page_size ?? 50,
  };
  if (args.state) {
    params["state"] = args.state;
  }
  return liGet("/leadGenForms", params);
}

// ─── get-leadgen-responses ──────────────────────────────────────────────────

export const getLeadgenResponsesSchema = {
  ad_account_id: z.string().optional(),
  lead_form_id: z
    .string()
    .optional()
    .describe("Filter to a specific Lead Gen Form (numeric ID or URN)."),
  submitted_after: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD). Only include responses submitted on or after this date."),
  submitted_before: z.string().optional().describe("ISO date (YYYY-MM-DD). Upper bound for submission date."),
  page_size: z.number().int().min(1).max(100).default(50),
  redact_pii: z
    .boolean()
    .default(true)
    .describe(
      "If true (default), mask PII in questionResponses (email, phone, name fields) before returning. " +
      "Set false only when the caller has a documented reason to handle raw lead PII."
    ),
};

const PII_QUESTION_PATTERNS = [
  /email/i,
  /phone/i,
  /first[\s_-]*name/i,
  /last[\s_-]*name/i,
  /full[\s_-]*name/i,
  /address/i,
  /zip/i,
  /postal/i,
];

function maskValue(v: string): string {
  if (!v) return v;
  if (v.length <= 4) return "***";
  return v.slice(0, 2) + "***" + v.slice(-2);
}

function redactResponses(elements: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return elements.map((el) => {
    const responses = el["questionResponses"];
    if (!Array.isArray(responses)) return el;
    const masked = responses.map((qr: Record<string, unknown>) => {
      const question = String(qr["question"] ?? qr["questionId"] ?? "");
      const isPII = PII_QUESTION_PATTERNS.some((re) => re.test(question));
      if (!isPII) return qr;
      const out: Record<string, unknown> = { ...qr };
      if (typeof out["answer"] === "string") out["answer"] = maskValue(out["answer"] as string);
      if (out["response"] && typeof out["response"] === "object") {
        const r = out["response"] as Record<string, unknown>;
        if (typeof r["answer"] === "string") {
          out["response"] = { ...r, answer: maskValue(r["answer"] as string) };
        }
      }
      return out;
    });
    return { ...el, questionResponses: masked };
  });
}

export async function getLeadgenResponses(args: {
  ad_account_id?: string;
  lead_form_id?: string;
  submitted_after?: string;
  submitted_before?: string;
  page_size?: number;
  redact_pii?: boolean;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const params: Record<string, string | number> = {
    q: "owner",
    owner: account,
    count: args.page_size ?? 50,
  };
  if (args.lead_form_id) {
    params["leadForm"] = urn("leadGenForm", args.lead_form_id);
  }
  if (args.submitted_after) {
    const t = parseUtcDateMs(args.submitted_after);
    if (t !== null) params["submittedAtTimeRange.start"] = t;
  }
  if (args.submitted_before) {
    const t = parseUtcDateMs(args.submitted_before);
    if (t !== null) params["submittedAtTimeRange.end"] = t;
  }
  const result = await liGet<{ elements?: Array<Record<string, unknown>> }>(
    "/leadFormResponses",
    params
  );
  if (args.redact_pii !== false && Array.isArray(result.elements)) {
    return { ...result, elements: redactResponses(result.elements) };
  }
  return result;
}

// ─── get-leadgen-form-performance ───────────────────────────────────────────

const LGF_FIELDS = [
  "impressions",
  "clicks",
  "oneClickLeads",
  "oneClickLeadFormOpens",
  "costInUsd",
  "costInLocalCurrency",
].join(",");

export const getLeadgenFormPerformanceSchema = {
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Scope to specific campaigns (pass campaign IDs or URNs). Omit to report across all campaigns in the account."
    ),
  ad_account_id: z.string().optional(),
  start_date: z
    .string()
    .default(DEFAULT_START)
    .describe("Start of date range. Default: 28daysAgo."),
  end_date: z.string().default(DEFAULT_END),
};

export async function getLeadgenFormPerformance(args: {
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
}) {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const qs: string[] = [
    "q=statistics",
    "pivot=CREATIVE",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${LGF_FIELDS}`,
  ];
  if (campaignUrns && campaignUrns.length > 0) {
    qs.push(`campaigns=List(${campaignUrns.join(",")})`);
  } else if (accountUrn) {
    qs.push(`accounts=List(${accountUrn})`);
  }

  const url = `${BASE_URL}/adAnalytics?${qs.join("&")}`;
  const raw = await liGetRaw<{ elements?: Array<Record<string, unknown>>; paging?: unknown }>(url);

  // Compute form open rate and lead conversion rate per creative
  const enriched = (raw.elements ?? []).map((row) => {
    const opens = Number(row["oneClickLeadFormOpens"] ?? 0);
    const leads = Number(row["oneClickLeads"] ?? 0);
    const impressions = Number(row["impressions"] ?? 0);
    const clicks = Number(row["clicks"] ?? 0);

    return {
      ...row,
      formOpenRate: clicks > 0 ? Math.round((opens / clicks) * 10000) / 100 : null,
      leadSubmitRate: opens > 0 ? Math.round((leads / opens) * 10000) / 100 : null,
      costPerLead: leads > 0 ? Math.round((Number(row["costInUsd"] ?? 0) / leads) * 100) / 100 : null,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
    };
  });

  // Drop raw.elements to avoid returning every metric twice — `enriched` is a
  // superset (raw fields plus computed rates).
  const { elements: _elements, ...rest } = raw;
  return { ...rest, enriched };
}
