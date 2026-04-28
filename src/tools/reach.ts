import { z } from "zod";
import {
  BASE_URL,
  DEFAULT_END,
  DEFAULT_START,
  dateRangeParam,
  liGetRaw,
  listParam,
  resolveAdAccount,
  resolveDate,
  urn,
} from "../client.js";

const PERF_PIVOTS = ["CAMPAIGN", "CAMPAIGN_GROUP", "CREATIVE", "ACCOUNT"] as const;
const TIME_GRANULARITIES = ["ALL", "DAILY", "MONTHLY"] as const;

interface AnalyticsResponse {
  elements?: Array<Record<string, unknown>>;
  paging?: unknown;
}

export const getReachFrequencySchema = {
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Campaign IDs or URNs. Omit to report at account level."),
  ad_account_id: z.string().optional(),
  start_date: z.string().default(DEFAULT_START),
  end_date: z.string().default(DEFAULT_END),
  time_granularity: z.enum(TIME_GRANULARITIES).default("ALL"),
  pivot: z.enum(PERF_PIVOTS).default("CAMPAIGN"),
};

export async function getReachFrequency(args: {
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  time_granularity?: (typeof TIME_GRANULARITIES)[number];
  pivot?: (typeof PERF_PIVOTS)[number];
}) {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);
  const pivot = args.pivot ?? "CAMPAIGN";
  const timeGranularity = args.time_granularity ?? "ALL";
  // approximateUniqueImpressions = estimated unique members reached (LinkedIn rounds for privacy)
  const fields = "impressions,approximateUniqueImpressions,clicks,costInUsd,oneClickLeads";

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const encUrn = (u: string) => u.replace(/:/g, "%3A");
  const qs: string[] = [
    "q=statistics",
    `pivots=List(${pivot})`,
    `timeGranularity=${timeGranularity}`,
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${fields}`,
  ];
  if (campaignUrns && campaignUrns.length > 0) {
    qs.push(`campaigns=${listParam(campaignUrns.map(encUrn))}`);
  } else if (accountUrn) {
    qs.push(`accounts=${listParam([encUrn(accountUrn)])}`);
  }
  const url = `${BASE_URL}/adAnalytics?${qs.join("&")}`;

  const raw = await liGetRaw<AnalyticsResponse>(url);

  const enriched = (raw.elements ?? []).map((row) => {
    const impressions = Number(row["impressions"] ?? 0);
    const uniqueImpressions = Number(row["approximateUniqueImpressions"] ?? 0);
    const spend = Number(row["costInUsd"] ?? 0);
    // Frequency = average times each reached member saw an ad
    const frequency =
      uniqueImpressions > 0
        ? Math.round((impressions / uniqueImpressions) * 100) / 100
        : null;
    // Cost per reach = spend / unique members reached
    const costPerReach =
      uniqueImpressions > 0 && spend > 0
        ? Math.round((spend / uniqueImpressions) * 10000) / 10000
        : null;
    return {
      ...row,
      approximate_unique_impressions: uniqueImpressions || null,
      computed_frequency: frequency,
      computed_cost_per_reach_usd: costPerReach,
    };
  });

  return {
    ...raw,
    enriched,
    note: "approximateUniqueImpressions is rounded by LinkedIn for member privacy. Frequency and cost-per-reach are derived from this rounded value.",
  };
}
