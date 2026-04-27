import { z } from "zod";
import {
  BASE_URL,
  dateRangeParam,
  DEFAULT_END,
  DEFAULT_START,
  liGet,
  liGetRaw,
  listParam,
  resolveAdAccount,
  resolveDate,
  unwrapURN,
  urn,
} from "../client.js";

const DEFAULT_FIELDS = [
  "impressions",
  "clicks",
  "costInUsd",
  "costInLocalCurrency",
  "externalWebsiteConversions",
  "oneClickLeads",
  "landingPageClicks",
  "videoViews",
  "follows",
  "reactions",
  "comments",
  "shares",
].join(",");

const VIDEO_FIELDS = [
  "impressions",
  "clicks",
  "costInUsd",
  "videoViews",
  "videoFirstQuartileCompletions",
  "videoMidpointCompletions",
  "videoThirdQuartileCompletions",
  "videoCompletions",
  "videoStarts",
].join(",");

const PERF_PIVOTS = ["CAMPAIGN", "CAMPAIGN_GROUP", "CREATIVE", "ACCOUNT"] as const;
const TIME_GRANULARITIES = ["ALL", "DAILY", "MONTHLY", "YEARLY"] as const;

const DEMO_PIVOTS = [
  "MEMBER_COMPANY",
  "MEMBER_COMPANY_SIZE",
  "MEMBER_COUNTRY_V2",
  "MEMBER_INDUSTRY",
  "MEMBER_JOB_FUNCTION",
  "MEMBER_JOB_TITLE",
  "MEMBER_REGION_V2",
  "MEMBER_SENIORITY",
] as const;

const COMPARISONS = ["wow", "mom", "yoy"] as const;

interface AnalyticsElement extends Record<string, unknown> {
  pivotValues?: string[];
}

interface AnalyticsResponse {
  elements?: AnalyticsElement[];
  paging?: unknown;
}

function buildAnalyticsUrl(opts: {
  pivot: string;
  timeGranularity: string;
  start: ReturnType<typeof resolveDate>;
  end: ReturnType<typeof resolveDate>;
  fields: string;
  campaignUrns?: string[];
  accountUrn?: string;
}): string {
  const qs: string[] = [
    "q=statistics",
    `pivot=${opts.pivot}`,
    `timeGranularity=${opts.timeGranularity}`,
    `dateRange=${dateRangeParam(opts.start, opts.end)}`,
    `fields=${opts.fields}`,
  ];
  if (opts.campaignUrns && opts.campaignUrns.length > 0) {
    qs.push(`campaigns=${listParam(opts.campaignUrns)}`);
  } else if (opts.accountUrn) {
    qs.push(`accounts=${listParam([opts.accountUrn])}`);
  }
  return `${BASE_URL}/adAnalytics?${qs.join("&")}`;
}

// ─── get-campaign-performance ───────────────────────────────────────────────

export const getCampaignPerformanceSchema = {
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Campaign numeric IDs or URNs. Omit to report at account level."),
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account ID/URN. Used when campaign_ids is omitted. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
  start_date: z
    .string()
    .default(DEFAULT_START)
    .describe("Start of date range. Accepts YYYY-MM-DD, today, yesterday, or NdaysAgo. Default: 28daysAgo."),
  end_date: z.string().default(DEFAULT_END).describe("End of date range. Default: yesterday."),
  time_granularity: z.enum(TIME_GRANULARITIES).default("ALL"),
  pivot: z.enum(PERF_PIVOTS).default("CAMPAIGN"),
  fields: z
    .string()
    .optional()
    .describe(`Comma-separated metrics. Default: ${DEFAULT_FIELDS}`),
};

export async function getCampaignPerformance(args: {
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  time_granularity?: (typeof TIME_GRANULARITIES)[number];
  pivot?: (typeof PERF_PIVOTS)[number];
  fields?: string;
}): Promise<AnalyticsResponse> {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);
  const fields = args.fields ?? DEFAULT_FIELDS;
  const pivot = args.pivot ?? "CAMPAIGN";
  const timeGranularity = args.time_granularity ?? "ALL";

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const url = buildAnalyticsUrl({ pivot, timeGranularity, start, end, fields, campaignUrns, accountUrn });
  return liGetRaw<AnalyticsResponse>(url);
}

// ─── get-demographics-report ────────────────────────────────────────────────

export const getDemographicsReportSchema = {
  pivot: z
    .enum(DEMO_PIVOTS)
    .describe(
      "Demographic dimension to break down by. MEMBER_JOB_TITLE / MEMBER_JOB_FUNCTION / MEMBER_SENIORITY " +
      "are useful for persona fit; MEMBER_COMPANY / MEMBER_COMPANY_SIZE for ABM audience analysis; " +
      "MEMBER_INDUSTRY for vertical benchmarking; MEMBER_COUNTRY_V2 / MEMBER_REGION_V2 for geo reporting."
    ),
  campaign_ids: z.array(z.string()).optional(),
  ad_account_id: z.string().optional(),
  start_date: z.string().default(DEFAULT_START),
  end_date: z.string().default(DEFAULT_END),
  fields: z.string().optional(),
};

export async function getDemographicsReport(args: {
  pivot: (typeof DEMO_PIVOTS)[number];
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  fields?: string;
}): Promise<AnalyticsResponse> {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);
  const fields =
    args.fields ??
    "impressions,clicks,costInUsd,costInLocalCurrency,oneClickLeads,externalWebsiteConversions";

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const url = buildAnalyticsUrl({
    pivot: args.pivot,
    timeGranularity: "ALL",
    start,
    end,
    fields,
    campaignUrns,
    accountUrn,
  });
  return liGetRaw<AnalyticsResponse>(url);
}

// ─── compare-periods ────────────────────────────────────────────────────────

export const comparePeriodsSchema = {
  comparison: z
    .enum(COMPARISONS)
    .default("wow")
    .describe("wow: last 7d vs prior 7d. mom: last 30d vs prior 30d. yoy: last 30d vs same 30d last year."),
  campaign_ids: z.array(z.string()).optional(),
  ad_account_id: z.string().optional(),
  pivot: z.enum(PERF_PIVOTS).default("CAMPAIGN"),
  fields: z.string().optional(),
};

function periodDates(c: (typeof COMPARISONS)[number]): {
  currentStart: string; currentEnd: string; priorStart: string; priorEnd: string;
} {
  if (c === "wow") {
    return { currentStart: "7daysAgo", currentEnd: "yesterday", priorStart: "14daysAgo", priorEnd: "8daysAgo" };
  }
  if (c === "mom") {
    return { currentStart: "30daysAgo", currentEnd: "yesterday", priorStart: "60daysAgo", priorEnd: "31daysAgo" };
  }
  return { currentStart: "30daysAgo", currentEnd: "yesterday", priorStart: "395daysAgo", priorEnd: "366daysAgo" };
}

function keyOf(row: AnalyticsElement): string {
  if (Array.isArray(row.pivotValues) && row.pivotValues.length > 0) {
    return row.pivotValues.join("|");
  }
  return JSON.stringify(row);
}

function diffRows(
  current: AnalyticsResponse,
  prior: AnalyticsResponse,
  fields: string[]
): Array<Record<string, unknown>> {
  const cEl = current.elements ?? [];
  const pEl = prior.elements ?? [];
  const priorMap = new Map<string, AnalyticsElement>();
  for (const r of pEl) priorMap.set(keyOf(r), r);

  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];

  for (const c of cEl) {
    const k = keyOf(c);
    seen.add(k);
    const p = priorMap.get(k);
    const row: Record<string, unknown> = { entity: k, pivotValues: c.pivotValues };
    for (const f of fields) {
      const cv = Number(c[f] ?? 0);
      const pv = Number(p?.[f] ?? 0);
      row[`${f}_current`] = cv;
      row[`${f}_prior`] = pv;
      row[`${f}_delta`] = cv - pv;
      row[`${f}_pct_change`] = pv === 0 ? null : ((cv - pv) / pv) * 100;
    }
    out.push(row);
  }
  for (const [k, p] of priorMap.entries()) {
    if (seen.has(k)) continue;
    const row: Record<string, unknown> = { entity: k, pivotValues: p.pivotValues };
    for (const f of fields) {
      const pv = Number(p[f] ?? 0);
      row[`${f}_current`] = 0;
      row[`${f}_prior`] = pv;
      row[`${f}_delta`] = -pv;
      row[`${f}_pct_change`] = pv === 0 ? null : -100;
    }
    out.push(row);
  }
  return out;
}

export async function comparePeriods(args: {
  comparison?: (typeof COMPARISONS)[number];
  campaign_ids?: string[];
  ad_account_id?: string;
  pivot?: (typeof PERF_PIVOTS)[number];
  fields?: string;
}) {
  const cmp = args.comparison ?? "wow";
  const { currentStart, currentEnd, priorStart, priorEnd } = periodDates(cmp);
  const fields = args.fields ?? DEFAULT_FIELDS;

  const [current, prior] = await Promise.all([
    getCampaignPerformance({
      campaign_ids: args.campaign_ids,
      ad_account_id: args.ad_account_id,
      start_date: currentStart,
      end_date: currentEnd,
      time_granularity: "ALL",
      pivot: args.pivot,
      fields,
    }),
    getCampaignPerformance({
      campaign_ids: args.campaign_ids,
      ad_account_id: args.ad_account_id,
      start_date: priorStart,
      end_date: priorEnd,
      time_granularity: "ALL",
      pivot: args.pivot,
      fields,
    }),
  ]);

  const rows = diffRows(current, prior, fields.split(","));
  return {
    comparison: cmp,
    pivot: args.pivot ?? "CAMPAIGN",
    current_period: { start: currentStart, end: currentEnd },
    prior_period: { start: priorStart, end: priorEnd },
    rows,
    _raw: { current, prior },
  };
}

// ─── get-video-analytics ────────────────────────────────────────────────────

export const getVideoAnalyticsSchema = {
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Campaign numeric IDs or URNs to scope the report. Omit to report at account level."),
  ad_account_id: z.string().optional(),
  start_date: z.string().default(DEFAULT_START),
  end_date: z.string().default(DEFAULT_END),
  time_granularity: z.enum(TIME_GRANULARITIES).default("ALL"),
};

export async function getVideoAnalytics(args: {
  campaign_ids?: string[];
  ad_account_id?: string;
  start_date?: string;
  end_date?: string;
  time_granularity?: (typeof TIME_GRANULARITIES)[number];
}): Promise<AnalyticsResponse & { enriched?: unknown[] }> {
  const start = resolveDate(args.start_date ?? DEFAULT_START);
  const end = resolveDate(args.end_date ?? DEFAULT_END);

  const campaignUrns = args.campaign_ids?.map((id) => urn("sponsoredCampaign", id));
  const accountUrn =
    campaignUrns && campaignUrns.length > 0
      ? undefined
      : resolveAdAccount(args.ad_account_id);

  const url = buildAnalyticsUrl({
    pivot: "CREATIVE",
    timeGranularity: args.time_granularity ?? "ALL",
    start,
    end,
    fields: VIDEO_FIELDS,
    campaignUrns,
    accountUrn,
  });

  const raw = await liGetRaw<AnalyticsResponse>(url);

  // Compute completion rate per creative
  const enriched = (raw.elements ?? []).map((row) => {
    const starts = Number(row["videoStarts"] ?? row["videoViews"] ?? 0);
    const completions = Number(row["videoCompletions"] ?? 0);
    return {
      ...row,
      videoCompletionRate: starts > 0 ? Math.round((completions / starts) * 10000) / 100 : null,
    };
  });

  return { ...raw, enriched };
}

// ─── get-budget-pacing ──────────────────────────────────────────────────────

export const getBudgetPacingSchema = {
  ad_account_id: z.string().optional(),
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Limit pacing report to these campaigns. Omit to report all active campaigns in the account."),
  period_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe("Number of days to look back for spend. Should match your budget period (e.g., 30 for monthly)."),
};

export async function getBudgetPacing(args: {
  ad_account_id?: string;
  campaign_ids?: string[];
  period_days?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const periodDays = args.period_days ?? 30;

  let campaigns: Array<Record<string, unknown>> = [];
  if (args.campaign_ids && args.campaign_ids.length > 0) {
    // Fetch each specified campaign
    campaigns = await Promise.all(
      args.campaign_ids.map((id) => {
        const campaignId = id.startsWith("urn:li:") ? id.split(":").pop()! : id;
        return liGet<Record<string, unknown>>(`/adAccounts/${accountId}/adCampaigns/${campaignId}`);
      })
    );
  } else {
    // Page through all active campaigns — accounts can have well over 100.
    let pageStart = 0;
    const pageSize = 100;
    while (true) {
      const res = await liGet<{ elements?: Array<Record<string, unknown>> }>(
        `/adAccounts/${accountId}/adCampaigns`,
        { q: "search", pageSize, start: pageStart },
        { search: "(status:(values:List(ACTIVE)))" }
      );
      const batch = res.elements ?? [];
      campaigns.push(...batch);
      if (batch.length < pageSize) break;
      pageStart += pageSize;
      // Safety stop — LinkedIn offset finders cap around 1k.
      if (pageStart >= 5000) break;
    }
  }

  // Fetch spend for the period
  const spendStart = `${periodDays}daysAgo`;
  const campaignUrns = campaigns.map((c) => {
    const id = c["id"] as string | undefined ?? "";
    return urn("sponsoredCampaign", id);
  });

  const start = resolveDate(spendStart);
  const end = resolveDate(DEFAULT_END);
  const spendUrl = buildAnalyticsUrl({
    pivot: "CAMPAIGN",
    timeGranularity: "ALL",
    start,
    end,
    fields: "costInUsd,costInLocalCurrency",
    campaignUrns: campaignUrns.filter(Boolean),
    accountUrn: undefined,
  });

  const spendData = await liGetRaw<AnalyticsResponse>(spendUrl);
  const spendMap = new Map<string, { usd: number; local: number }>();
  for (const row of spendData.elements ?? []) {
    const key = (row.pivotValues?.[0] ?? "") as string;
    spendMap.set(key, {
      usd: Number(row["costInUsd"] ?? 0),
      local: Number(row["costInLocalCurrency"] ?? 0),
    });
  }

  const pacing = campaigns.map((c) => {
    const id = c["id"] as string ?? "";
    const campaignUrn = urn("sponsoredCampaign", id);
    const spend = spendMap.get(campaignUrn) ?? { usd: 0, local: 0 };

    // totalBudget / dailyBudget are {amount, currencyCode} objects in the
    // account's local currency — NOT USD. Pace against costInLocalCurrency
    // so the ratio is denominated correctly for non-USD accounts.
    const totalBudget = c["totalBudget"] as { amount?: string; currencyCode?: string } | undefined;
    const dailyBudget = c["dailyBudget"] as { amount?: string; currencyCode?: string } | undefined;

    const budgetAmount = totalBudget?.amount ? Number(totalBudget.amount) : null;
    const dailyBudgetAmount = dailyBudget?.amount ? Number(dailyBudget.amount) : null;
    const estimatedPeriodBudget = dailyBudgetAmount ? dailyBudgetAmount * periodDays : null;
    const effectiveBudget = budgetAmount ?? estimatedPeriodBudget;
    const currencyCode = totalBudget?.currencyCode ?? dailyBudget?.currencyCode ?? null;

    const utilizationPct =
      effectiveBudget && effectiveBudget > 0
        ? Math.round((spend.local / effectiveBudget) * 10000) / 100
        : null;

    return {
      campaign_id: id,
      campaign_urn: campaignUrn,
      name: c["name"],
      status: c["status"],
      currency_code: currencyCode,
      total_budget: budgetAmount,
      daily_budget: dailyBudgetAmount,
      estimated_period_budget: estimatedPeriodBudget,
      spend_local: spend.local,
      spend_usd: spend.usd,
      utilization_pct: utilizationPct,
      period_days: periodDays,
    };
  });

  return {
    period_days: periodDays,
    ad_account_id: accountId,
    campaigns: pacing,
  };
}
