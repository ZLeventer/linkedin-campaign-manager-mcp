import { z } from "zod";
import {
  BASE_URL,
  dateRangeParam,
  liGet,
  liGetRaw,
  listParam,
  resolveAdAccount,
  resolveDate,
  unwrapURN,
  urn,
} from "../client.js";

const HEALTH_FIELDS = [
  "impressions",
  "clicks",
  "costInUsd",
  "externalWebsiteConversions",
  "oneClickLeads",
].join(",");

interface DateParts { year: number; month: number; day: number }

function encodeUrn(u: string): string {
  return u.replace(/:/g, "%3A");
}

function buildPerCampaignUrl(campaignUrn: string, start: DateParts, end: DateParts): string {
  const qs = [
    "q=statistics",
    "pivots=List(CAMPAIGN)",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${HEALTH_FIELDS}`,
    `campaigns=${listParam([encodeUrn(campaignUrn)])}`,
  ];
  return `${BASE_URL}/adAnalytics?${qs.join("&")}`;
}

function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round((a / b) * 10000) / 100 : null;
}

function round2(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export const accountHealthSnapshotSchema = {
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
  period_days: z
    .number()
    .int()
    .min(1)
    .max(180)
    .default(30)
    .describe("Lookback window for spend and performance. Default 30 days (matches typical monthly budget cycle)."),
  cpl_outlier_sigmas: z
    .number()
    .min(1)
    .max(5)
    .default(2)
    .describe("How many standard deviations above the mean CPL counts as an outlier alert. Default 2."),
  high_utilization_threshold: z
    .number()
    .min(0)
    .max(2)
    .default(0.8)
    .describe("Utilization fraction that triggers a high-pacing alert. Default 0.8 (80%)."),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("How many top/bottom campaigns to surface in rankings. Default 5."),
};

interface CampaignRow {
  campaign_id: string;
  campaign_urn: string;
  name: string;
  status: string | undefined;
  objective_type: string | undefined;
  impressions: number;
  clicks: number;
  spend_usd: number | null;
  leads: number;
  ctr_pct: number | null;
  cpl_usd: number | null;
  effective_budget_usd: number | null;
  utilization_pct: number | null;
}

interface Alert {
  severity: "critical" | "warning";
  type: string;
  campaign_id: string;
  name: string;
  detail: string;
}

export async function accountHealthSnapshot(args: {
  ad_account_id?: string;
  period_days?: number;
  cpl_outlier_sigmas?: number;
  high_utilization_threshold?: number;
  top_n?: number;
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const periodDays = args.period_days ?? 30;
  const cplSigmas = args.cpl_outlier_sigmas ?? 2;
  const highUtil = args.high_utilization_threshold ?? 0.8;
  const topN = args.top_n ?? 5;

  const start = resolveDate(`${periodDays}daysAgo`);
  const end = resolveDate("yesterday");

  const campaignsRes = await liGet<{ elements?: Record<string, unknown>[] }>(
    `/adAccounts/${accountId}/adCampaigns`,
    { q: "search", pageSize: 100 },
    { search: "(status:(values:List(ACTIVE)))" },
  );
  const campaigns = campaignsRes.elements ?? [];

  const enriched: CampaignRow[] = await Promise.all(
    campaigns.map(async (c): Promise<CampaignRow> => {
      const id = String(c["id"] ?? "");
      const campaignUrn = urn("sponsoredCampaign", id);
      let metrics = {
        impressions: 0,
        clicks: 0,
        costInUsd: 0,
        externalWebsiteConversions: 0,
        oneClickLeads: 0,
      };
      try {
        const data = await liGetRaw<{ elements?: Record<string, unknown>[] }>(
          buildPerCampaignUrl(campaignUrn, start, end),
        );
        const row = data.elements?.[0] ?? {};
        metrics = {
          impressions: Number(row["impressions"] ?? 0),
          clicks: Number(row["clicks"] ?? 0),
          costInUsd: Number(row["costInUsd"] ?? 0),
          externalWebsiteConversions: Number(row["externalWebsiteConversions"] ?? 0),
          oneClickLeads: Number(row["oneClickLeads"] ?? 0),
        };
      } catch {
        // leave metrics zeroed; surface as zero-delivery alert if active
      }

      const totalBudget = c["totalBudget"] as { amount?: string } | undefined;
      const dailyBudget = c["dailyBudget"] as { amount?: string } | undefined;
      const totalBudgetAmt = totalBudget?.amount ? Number(totalBudget.amount) : null;
      const dailyBudgetAmt = dailyBudget?.amount ? Number(dailyBudget.amount) : null;
      const estimatedPeriodBudget = dailyBudgetAmt ? dailyBudgetAmt * periodDays : null;
      const effectiveBudget = totalBudgetAmt ?? estimatedPeriodBudget;
      const utilization =
        effectiveBudget && effectiveBudget > 0 ? metrics.costInUsd / effectiveBudget : null;

      const totalLeads = metrics.oneClickLeads + metrics.externalWebsiteConversions;
      const cpl = totalLeads > 0 ? metrics.costInUsd / totalLeads : null;

      return {
        campaign_id: id,
        campaign_urn: campaignUrn,
        name: String(c["name"] ?? ""),
        status: c["status"] as string | undefined,
        objective_type: c["objectiveType"] as string | undefined,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        spend_usd: round2(metrics.costInUsd),
        leads: totalLeads,
        ctr_pct: pct(metrics.clicks, metrics.impressions),
        cpl_usd: round2(cpl),
        effective_budget_usd: effectiveBudget,
        utilization_pct: utilization === null ? null : round2(utilization * 100),
      };
    }),
  );

  const totals = enriched.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      spend_usd: acc.spend_usd + (c.spend_usd ?? 0),
      leads: acc.leads + c.leads,
    }),
    { impressions: 0, clicks: 0, spend_usd: 0, leads: 0 },
  );

  const cpls = enriched
    .map((c) => c.cpl_usd)
    .filter((v): v is number => v !== null && v > 0);
  const cplMean = cpls.length > 0 ? cpls.reduce((s, n) => s + n, 0) / cpls.length : 0;
  const cplStd = stddev(cpls);
  const cplCutoff = cplMean + cplSigmas * cplStd;

  const alerts: Alert[] = [];
  for (const c of enriched) {
    if (c.utilization_pct !== null && c.utilization_pct >= highUtil * 100) {
      alerts.push({
        severity: c.utilization_pct >= 100 ? "critical" : "warning",
        type: "high_utilization",
        campaign_id: c.campaign_id,
        name: c.name,
        detail: `Utilization ${c.utilization_pct}% of period budget`,
      });
    }
    if (c.status === "ACTIVE" && c.impressions === 0) {
      alerts.push({
        severity: "warning",
        type: "zero_delivery",
        campaign_id: c.campaign_id,
        name: c.name,
        detail: `Active campaign delivered 0 impressions in last ${periodDays} days`,
      });
    }
    if (c.cpl_usd !== null && cplStd > 0 && c.cpl_usd > cplCutoff) {
      alerts.push({
        severity: "warning",
        type: "cpl_outlier",
        campaign_id: c.campaign_id,
        name: c.name,
        detail: `CPL $${c.cpl_usd} exceeds account mean by ${cplSigmas}σ (mean $${round2(cplMean)}, cutoff $${round2(cplCutoff)})`,
      });
    }
    if (c.status === "ACTIVE" && c.leads === 0 && (c.spend_usd ?? 0) > 100) {
      alerts.push({
        severity: "warning",
        type: "spend_no_leads",
        campaign_id: c.campaign_id,
        name: c.name,
        detail: `$${c.spend_usd} spent with zero leads/conversions in last ${periodDays} days`,
      });
    }
  }

  const withCpl = enriched.filter((c): c is CampaignRow & { cpl_usd: number } => c.cpl_usd !== null);
  const sortedByCpl = [...withCpl].sort((a, b) => a.cpl_usd - b.cpl_usd);
  const sortedByCtr = [...enriched]
    .filter((c) => c.impressions > 100)
    .sort((a, b) => (b.ctr_pct ?? 0) - (a.ctr_pct ?? 0));

  return {
    ad_account_id: accountId,
    period: {
      days: periodDays,
      start: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`,
      end: `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`,
    },
    totals: {
      active_campaigns: enriched.length,
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend_usd: round2(totals.spend_usd),
      leads: totals.leads,
      account_ctr_pct: pct(totals.clicks, totals.impressions),
      account_cpl_usd: totals.leads > 0 ? round2(totals.spend_usd / totals.leads) : null,
      account_cpc_usd: totals.clicks > 0 ? round2(totals.spend_usd / totals.clicks) : null,
    },
    rankings: {
      best_cpl: sortedByCpl.slice(0, topN),
      worst_cpl: sortedByCpl.slice(-topN).reverse(),
      best_ctr: sortedByCtr.slice(0, topN),
    },
    cpl_distribution: {
      mean_usd: round2(cplMean),
      std_usd: round2(cplStd),
      outlier_cutoff_usd: round2(cplCutoff),
      sample_size: cpls.length,
    },
    alerts: {
      count: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      items: alerts,
    },
    campaigns: enriched,
  };
}
