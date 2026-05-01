import { z } from "zod";
import {
  BASE_URL,
  dateRangeParam,
  liGetRaw,
  listParam,
  resolveAdAccount,
  resolveDate,
  unwrapURN,
  urn,
} from "../client.js";

const FIELDS = [
  "impressions",
  "clicks",
  "costInUsd",
  "oneClickLeads",
  "externalWebsiteConversions",
  "pivotValues",
].join(",");

const PIVOTS = [
  "MEMBER_JOB_TITLE",
  "MEMBER_JOB_FUNCTION",
  "MEMBER_SENIORITY",
  "MEMBER_COMPANY",
  "MEMBER_COMPANY_SIZE",
  "MEMBER_INDUSTRY",
  "MEMBER_COUNTRY_V2",
  "MEMBER_REGION_V2",
] as const;

interface DateParts { year: number; month: number; day: number }

function encodeUrn(u: string): string {
  return u.replace(/:/g, "%3A");
}

function buildUrl(opts: {
  pivot: string;
  start: DateParts;
  end: DateParts;
  campaignUrns?: string[];
  accountUrn?: string;
}): string {
  const qs = [
    "q=analytics",
    `pivot=${opts.pivot}`,
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(opts.start, opts.end)}`,
    `fields=${FIELDS}`,
  ];
  if (opts.campaignUrns?.length) {
    qs.push(`campaigns=${listParam(opts.campaignUrns.map(encodeUrn))}`);
  } else if (opts.accountUrn) {
    qs.push(`accounts=${listParam([encodeUrn(opts.accountUrn)])}`);
  }
  return `${BASE_URL}/adAnalytics?${qs.join("&")}`;
}

function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round((a / b) * 10000) / 100 : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const demographicRollupSchema = {
  pivot: z.enum(PIVOTS).describe("Demographic dimension to roll up across campaigns."),
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Campaign IDs/URNs to include. Omit for account-wide rollup."),
  ad_account_id: z.string().optional(),
  start_date: z.string().default("28daysAgo"),
  end_date: z.string().default("yesterday"),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("How many top dimension values to surface (sorted by spend)."),
};

interface AggBucket {
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  conversions: number;
}

export async function demographicRollup(args: {
  pivot: (typeof PIVOTS)[number];
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  top_n?: number;
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const start = resolveDate(args.start_date ?? "28daysAgo");
  const end = resolveDate(args.end_date ?? "yesterday");
  const topN = args.top_n ?? 20;
  const pivot = args.pivot;

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));

  const url = campaignUrns?.length
    ? buildUrl({ pivot, start, end, campaignUrns })
    : buildUrl({ pivot, start, end, accountUrn: account });

  const data = await liGetRaw<{ elements?: Record<string, unknown>[] }>(url);
  const rows = data.elements ?? [];

  const aggregated = new Map<string, AggBucket>();
  for (const row of rows) {
    const pivotValues = row["pivotValues"] as string[] | undefined;
    const dimUrn = pivotValues?.[0];
    if (!dimUrn) continue;
    const cur = aggregated.get(dimUrn) ?? {
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      conversions: 0,
    };
    cur.impressions += Number(row["impressions"] ?? 0);
    cur.clicks += Number(row["clicks"] ?? 0);
    cur.spend += Number(row["costInUsd"] ?? 0);
    cur.leads += Number(row["oneClickLeads"] ?? 0);
    cur.conversions += Number(row["externalWebsiteConversions"] ?? 0);
    aggregated.set(dimUrn, cur);
  }

  const totalSpend = Array.from(aggregated.values()).reduce((s, v) => s + v.spend, 0);
  const totalImps = Array.from(aggregated.values()).reduce((s, v) => s + v.impressions, 0);

  const ranked = Array.from(aggregated.entries())
    .map(([dim, v]) => {
      const totalLeads = v.leads + v.conversions;
      return {
        dimension_urn: dim,
        impressions: v.impressions,
        clicks: v.clicks,
        spend_usd: round2(v.spend),
        leads: totalLeads,
        ctr_pct: pct(v.clicks, v.impressions),
        cpl_usd: totalLeads > 0 ? round2(v.spend / totalLeads) : null,
        share_of_spend_pct: totalSpend > 0 ? round2((v.spend / totalSpend) * 100) : null,
        share_of_impressions_pct: totalImps > 0 ? round2((v.impressions / totalImps) * 100) : null,
      };
    })
    .sort((a, b) => b.spend_usd - a.spend_usd)
    .slice(0, topN);

  return {
    ad_account_id: unwrapURN(account),
    pivot,
    period: {
      start: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`,
      end: `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`,
    },
    scope: campaignUrns?.length ? `${campaignUrns.length} campaigns` : "account-wide",
    totals: {
      unique_dimension_values: aggregated.size,
      total_spend_usd: round2(totalSpend),
      total_impressions: totalImps,
    },
    rows: ranked,
  };
}
