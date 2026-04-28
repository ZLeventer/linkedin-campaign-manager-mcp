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

const FIELDS = ["impressions", "clicks", "costInUsd", "oneClickLeads", "externalWebsiteConversions"].join(",");

interface DateParts { year: number; month: number; day: number }

function encodeUrn(u: string): string {
  return u.replace(/:/g, "%3A");
}

function buildUrl(campaignUrn: string, start: DateParts, end: DateParts): string {
  const qs = [
    "q=statistics",
    "pivots=List(CAMPAIGN)",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${FIELDS}`,
    `campaigns=${listParam([encodeUrn(campaignUrn)])}`,
  ];
  return `${BASE_URL}/adAnalytics?${qs.join("&")}`;
}

function round2(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

export const underperformerFinderSchema = {
  ad_account_id: z.string().optional(),
  period_days: z.number().int().min(3).max(90).default(14),
  cpl_threshold_usd: z
    .number()
    .min(0)
    .optional()
    .describe("Flag campaigns whose CPL exceeds this. Omit to skip CPL check."),
  ctr_threshold_pct: z
    .number()
    .min(0)
    .max(100)
    .default(0.4)
    .describe("Flag campaigns whose CTR is below this percentage. LinkedIn B2B benchmark ~0.4–0.5%."),
  min_spend_usd: z
    .number()
    .min(0)
    .default(50)
    .describe("Don't flag campaigns that have spent less than this in the window — too little data."),
  min_impressions: z
    .number()
    .int()
    .min(0)
    .default(1000)
    .describe("Don't flag campaigns with fewer impressions than this — CTR not meaningful."),
};

interface CampaignMetrics {
  campaign_id: string;
  name: string;
  objective_type: string | undefined;
  impressions: number;
  clicks: number;
  spend_usd: number;
  leads: number;
  ctr_pct: number | null;
  cpl_usd: number | null;
}

function recommendation(c: CampaignMetrics, args: { cpl_threshold_usd?: number; ctr_threshold_pct?: number }): string[] {
  const recs: string[] = [];
  if (c.ctr_pct !== null && c.ctr_pct < (args.ctr_threshold_pct ?? 0.4)) {
    recs.push("Refresh creative — low CTR suggests audience-message mismatch or fatigue");
  }
  if (args.cpl_threshold_usd && c.cpl_usd !== null && c.cpl_usd > args.cpl_threshold_usd) {
    recs.push(`CPL exceeds $${args.cpl_threshold_usd} — tighten targeting or test new offer`);
  }
  if (c.leads === 0 && c.spend_usd > 100) {
    recs.push("Pause or audit conversion tracking — meaningful spend with zero recorded leads");
  }
  if (c.impressions > 0 && c.clicks === 0) {
    recs.push("Audit landing page / CTA — impressions delivering with no clicks");
  }
  return recs;
}

export async function underperformerFinder(args: {
  ad_account_id?: string;
  period_days?: number;
  cpl_threshold_usd?: number;
  ctr_threshold_pct?: number;
  min_spend_usd?: number;
  min_impressions?: number;
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const periodDays = args.period_days ?? 14;
  const minSpend = args.min_spend_usd ?? 50;
  const minImps = args.min_impressions ?? 1000;
  const ctrThreshold = args.ctr_threshold_pct ?? 0.4;

  const start = resolveDate(`${periodDays}daysAgo`);
  const end = resolveDate("yesterday");

  const campRes = await liGet<{ elements?: Record<string, unknown>[] }>(
    `/adAccounts/${accountId}/adCampaigns`,
    { q: "search", pageSize: 100 },
    { search: "(status:(values:List(ACTIVE)))" },
  );
  const campaigns = campRes.elements ?? [];

  const enriched: CampaignMetrics[] = await Promise.all(
    campaigns.map(async (c): Promise<CampaignMetrics> => {
      const id = String(c["id"] ?? "");
      const u = urn("sponsoredCampaign", id);
      let m = {
        impressions: 0,
        clicks: 0,
        costInUsd: 0,
        oneClickLeads: 0,
        externalWebsiteConversions: 0,
      };
      try {
        const data = await liGetRaw<{ elements?: Record<string, unknown>[] }>(buildUrl(u, start, end));
        const row = data.elements?.[0] ?? {};
        m = {
          impressions: Number(row["impressions"] ?? 0),
          clicks: Number(row["clicks"] ?? 0),
          costInUsd: Number(row["costInUsd"] ?? 0),
          oneClickLeads: Number(row["oneClickLeads"] ?? 0),
          externalWebsiteConversions: Number(row["externalWebsiteConversions"] ?? 0),
        };
      } catch {
        // leave zeroed
      }
      const leads = m.oneClickLeads + m.externalWebsiteConversions;
      const ctr = m.impressions > 0 ? Math.round((m.clicks / m.impressions) * 10000) / 100 : null;
      const cpl = leads > 0 ? m.costInUsd / leads : null;
      return {
        campaign_id: id,
        name: String(c["name"] ?? ""),
        objective_type: c["objectiveType"] as string | undefined,
        impressions: m.impressions,
        clicks: m.clicks,
        spend_usd: round2(m.costInUsd) ?? 0,
        leads,
        ctr_pct: ctr,
        cpl_usd: round2(cpl),
      };
    }),
  );

  const flagged = [];
  for (const c of enriched) {
    if (c.spend_usd < minSpend) continue;
    if (c.impressions < minImps) continue;

    const reasons: string[] = [];
    if (c.ctr_pct !== null && c.ctr_pct < ctrThreshold) {
      reasons.push(`CTR ${c.ctr_pct}% below ${ctrThreshold}% threshold`);
    }
    if (args.cpl_threshold_usd && c.cpl_usd !== null && c.cpl_usd > args.cpl_threshold_usd) {
      reasons.push(`CPL $${c.cpl_usd} exceeds $${args.cpl_threshold_usd} threshold`);
    }
    if (c.leads === 0 && c.spend_usd > 100) {
      reasons.push(`$${c.spend_usd} spent with zero leads`);
    }
    if (reasons.length > 0) {
      flagged.push({
        ...c,
        reasons,
        recommendations: recommendation(c, args),
      });
    }
  }

  flagged.sort((a, b) => b.spend_usd - a.spend_usd);

  return {
    ad_account_id: accountId,
    period_days: periodDays,
    thresholds: {
      ctr_pct: ctrThreshold,
      cpl_usd: args.cpl_threshold_usd ?? null,
      min_spend_usd: minSpend,
      min_impressions: minImps,
    },
    active_campaigns_scanned: enriched.length,
    underperformer_count: flagged.length,
    underperformers: flagged,
  };
}
