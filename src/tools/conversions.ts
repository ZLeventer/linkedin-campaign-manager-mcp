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

// ─── get-conversion-events ──────────────────────────────────────────────────

export const getConversionEventsSchema = {
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
  enabled_only: z
    .boolean()
    .default(true)
    .describe("If true, only return enabled conversion events. Set false to include disabled/archived events."),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function getConversionEvents(args: {
  ad_account_id?: string;
  enabled_only?: boolean;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const params: Record<string, string | number> = {
    q: "account",
    account,
    pageSize: args.page_size ?? 50,
  };
  if (args.enabled_only !== false) {
    params["enabled"] = "true";
  }
  return liGet("/conversionEvents", params);
}

// ─── get-conversion-performance ─────────────────────────────────────────────

const CONVERSION_FIELDS = [
  "externalWebsiteConversions",
  "externalWebsitePostClickConversions",
  "externalWebsitePostViewConversions",
  "impressions",
  "clicks",
  "costInUsd",
  "costInLocalCurrency",
].join(",");

export const getConversionPerformanceSchema = {
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Campaign numeric IDs or URNs to scope the conversion report. Omit for account-level."),
  ad_account_id: z.string().optional(),
  start_date: z
    .string()
    .default(DEFAULT_START)
    .describe("Start of date range. Accepts YYYY-MM-DD, today, yesterday, or NdaysAgo. Default: 28daysAgo."),
  end_date: z.string().default(DEFAULT_END),
  fields: z
    .string()
    .optional()
    .describe(`Comma-separated metrics. Default: ${CONVERSION_FIELDS}`),
};

export async function getConversionPerformance(args: {
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  fields?: string;
}) {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);
  const fields = args.fields ?? CONVERSION_FIELDS;

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const encUrn = (u: string) => u.replace(/:/g, "%3A");
  const qs: string[] = [
    "q=statistics",
    "pivots=List(CONVERSION)",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${fields}`,
  ];
  if (campaignUrns && campaignUrns.length > 0) {
    qs.push(`campaigns=List(${campaignUrns.map(encUrn).join(",")})`);
  } else if (accountUrn) {
    qs.push(`accounts=List(${encUrn(accountUrn)})`);
  }

  const url = `${BASE_URL}/adAnalytics?${qs.join("&")}`;
  return liGetRaw(url);
}
