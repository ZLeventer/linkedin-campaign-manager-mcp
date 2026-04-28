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

// Abramowitz & Stegun approximation for normal CDF (error < 7.5e-8)
function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * y);
}

// Two-proportion z-test. Returns two-tailed p-value and 95%/99% significance.
function zTestProportions(
  events1: number,
  trials1: number,
  events2: number,
  trials2: number
): { z_score: number | null; p_value: number | null; significant_95: boolean; significant_99: boolean } {
  if (trials1 < 1 || trials2 < 1 || events1 + events2 === 0) {
    return { z_score: null, p_value: null, significant_95: false, significant_99: false };
  }
  const p1 = events1 / trials1;
  const p2 = events2 / trials2;
  const pooled = (events1 + events2) / (trials1 + trials2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trials1 + 1 / trials2));
  if (se === 0) {
    return { z_score: 0, p_value: 1, significant_95: false, significant_99: false };
  }
  const zScore = (p1 - p2) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  return {
    z_score: Math.round(zScore * 1000) / 1000,
    p_value: Math.round(pValue * 10000) / 10000,
    significant_95: pValue < 0.05,
    significant_99: pValue < 0.01,
  };
}

interface AnalyticsRow extends Record<string, unknown> {
  pivotValues?: string[];
}

export const compareCreativesSchema = {
  creative_ids: z
    .array(z.string())
    .min(2)
    .max(10)
    .describe("2–10 creative IDs or URNs to compare."),
  campaign_ids: z
    .array(z.string())
    .optional()
    .describe("Scope analytics to these campaigns. Recommended when creatives appear in multiple campaigns."),
  ad_account_id: z.string().optional(),
  start_date: z.string().default(DEFAULT_START),
  end_date: z.string().default(DEFAULT_END),
};

export async function compareCreatives(args: {
  creative_ids: string[];
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

  const fields =
    "impressions,clicks,costInUsd,oneClickLeads,externalWebsiteConversions,landingPageClicks";

  const qs: string[] = [
    "q=statistics",
    "pivot=CREATIVE",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${fields}`,
  ];
  if (campaignUrns && campaignUrns.length > 0) {
    qs.push(`campaigns=${listParam(campaignUrns)}`);
  } else if (accountUrn) {
    qs.push(`accounts=${listParam([accountUrn])}`);
  }
  const url = `${BASE_URL}/adAnalytics?${qs.join("&")}`;

  const raw = await liGetRaw<{ elements?: AnalyticsRow[] }>(url);

  // Index analytics by creative URN and bare ID
  const dataMap = new Map<string, AnalyticsRow>();
  for (const row of raw.elements ?? []) {
    const pv = row.pivotValues?.[0] ?? "";
    if (pv) {
      dataMap.set(pv, row);
      dataMap.set(pv.split(":").pop() ?? "", row);
    }
  }

  const creativeUrns = args.creative_ids.map((id) => urn("sponsoredCreative", id));

  const stats = creativeUrns.map((creativeUrn, i) => {
    const bareId = creativeUrn.split(":").pop() ?? "";
    const row = dataMap.get(creativeUrn) ?? dataMap.get(bareId) ?? {};
    const impressions = Number(row["impressions"] ?? 0);
    const clicks = Number(row["clicks"] ?? 0);
    const spend = Number(row["costInUsd"] ?? 0);
    const leads = Number(row["oneClickLeads"] ?? 0);
    const conversions = Number(row["externalWebsiteConversions"] ?? 0);
    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 100000) / 1000 : 0;
    const cpl = leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;
    const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null;
    const convRate = clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0;
    return {
      creative_id: args.creative_ids[i]!,
      creative_urn: creativeUrn,
      impressions,
      clicks,
      spend_usd: spend,
      leads,
      conversions,
      ctr_pct: ctr,
      cpc_usd: cpc,
      cpl_usd: cpl,
      conversion_rate_pct: convRate,
    };
  });

  // Pairwise z-tests for CTR and lead rate
  const comparisons = [];
  for (let i = 0; i < stats.length; i++) {
    for (let j = i + 1; j < stats.length; j++) {
      const a = stats[i]!;
      const b = stats[j]!;
      const ctrTest = zTestProportions(a.clicks, a.impressions, b.clicks, b.impressions);
      const leadTest = zTestProportions(a.leads, a.clicks, b.leads, b.clicks);
      const ctrWinner =
        ctrTest.significant_95
          ? a.ctr_pct > b.ctr_pct
            ? a.creative_id
            : b.creative_id
          : "no significant winner";
      const leadWinner =
        leadTest.significant_95
          ? a.leads / Math.max(a.clicks, 1) > b.leads / Math.max(b.clicks, 1)
            ? a.creative_id
            : b.creative_id
          : "no significant winner";
      comparisons.push({
        creative_a: a.creative_id,
        creative_b: b.creative_id,
        ctr_winner: ctrWinner,
        ctr_z_test: ctrTest,
        lead_rate_winner: leadWinner,
        lead_rate_z_test: leadTest,
      });
    }
  }

  const rankedByCtr = [...stats]
    .sort((a, b) => b.ctr_pct - a.ctr_pct)
    .map((c, i) => ({
      rank: i + 1,
      creative_id: c.creative_id,
      ctr_pct: c.ctr_pct,
      cpl_usd: c.cpl_usd,
      impressions: c.impressions,
    }));

  return {
    date_range: { start: args.start_date ?? DEFAULT_START, end: args.end_date ?? DEFAULT_END },
    creatives: stats,
    ranked_by_ctr: rankedByCtr,
    statistical_comparisons: comparisons,
    note: "Z-tests use a two-tailed test (95% confidence = p<0.05, 99% = p<0.01). Reliable results require ~1,000+ impressions per creative. Lower CTR does not always indicate worse performance — narrow ABM targeting routinely yields higher CTR than broad awareness campaigns.",
  };
}
