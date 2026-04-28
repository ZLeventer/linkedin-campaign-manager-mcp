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
} from "../client.js";

const CR_FIELDS = ["impressions", "clicks", "costInUsd", "oneClickLeads", "pivotValues"].join(",");

interface DateParts { year: number; month: number; day: number }

interface WindowStats {
  impressions: number;
  clicks: number;
  costInUsd: number;
  oneClickLeads: number;
}

function encodeUrn(u: string): string {
  return u.replace(/:/g, "%3A");
}

function buildAccountCreativeUrl(accountUrn: string, start: DateParts, end: DateParts): string {
  const qs = [
    "q=statistics",
    "pivots=List(CREATIVE)",
    "timeGranularity=ALL",
    `dateRange=${dateRangeParam(start, end)}`,
    `fields=${CR_FIELDS}`,
    `accounts=${listParam([encodeUrn(accountUrn)])}`,
  ];
  return `${BASE_URL}/adAnalytics?${qs.join("&")}`;
}

function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round((a / b) * 10000) / 100 : null;
}

function round2(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

export const creativeInventorySchema = {
  ad_account_id: z.string().optional(),
  fatigue_window_days: z
    .number()
    .int()
    .min(3)
    .max(30)
    .default(7)
    .describe("Window size for fatigue calc. Compares last N days CTR vs prior N days. Default 7."),
  fatigue_threshold_pct: z
    .number()
    .min(0)
    .max(100)
    .default(25)
    .describe("Relative CTR drop (in percent) that flags a creative as fatigued. Default 25 — recent CTR is ≥25% below prior CTR."),
  min_prior_impressions: z
    .number()
    .int()
    .min(0)
    .default(500)
    .describe("Don't compute fatigue for creatives below this prior-window impression floor — too noisy."),
  lifetime_lookback_days: z
    .number()
    .int()
    .min(30)
    .max(730)
    .default(365),
};

async function fetchWindow(accountUrn: string, start: DateParts, end: DateParts): Promise<Map<string, WindowStats>> {
  const data = await liGetRaw<{ elements?: Record<string, unknown>[] }>(
    buildAccountCreativeUrl(accountUrn, start, end),
  );
  const map = new Map<string, WindowStats>();
  for (const row of data.elements ?? []) {
    const pivotValues = row["pivotValues"] as string[] | undefined;
    const u = pivotValues?.[0];
    if (!u) continue;
    map.set(u, {
      impressions: Number(row["impressions"] ?? 0),
      clicks: Number(row["clicks"] ?? 0),
      costInUsd: Number(row["costInUsd"] ?? 0),
      oneClickLeads: Number(row["oneClickLeads"] ?? 0),
    });
  }
  return map;
}

export async function creativeInventory(args: {
  ad_account_id?: string;
  fatigue_window_days?: number;
  fatigue_threshold_pct?: number;
  min_prior_impressions?: number;
  lifetime_lookback_days?: number;
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const win = args.fatigue_window_days ?? 7;
  const threshold = args.fatigue_threshold_pct ?? 25;
  const minPrior = args.min_prior_impressions ?? 500;
  const lifetimeDays = args.lifetime_lookback_days ?? 365;

  const lifetimeStart = resolveDate(`${lifetimeDays}daysAgo`);
  const recentStart = resolveDate(`${win}daysAgo`);
  const priorStart = resolveDate(`${win * 2}daysAgo`);
  const priorEnd = resolveDate(`${win + 1}daysAgo`);
  const end = resolveDate("yesterday");

  const [lifetime, recent, prior] = await Promise.all([
    fetchWindow(account, lifetimeStart, end),
    fetchWindow(account, recentStart, end),
    fetchWindow(account, priorStart, priorEnd),
  ]);

  const allUrns = new Set<string>([...lifetime.keys(), ...recent.keys(), ...prior.keys()]);

  const creativeListRes = await liGet<{ elements?: Record<string, unknown>[] }>(
    `/adAccounts/${accountId}/creatives`,
    { q: "criteria", count: 100 },
  );
  const metaByUrn = new Map<string, { status: string | null; campaign: string | null; content_type: string | null }>();
  for (const cr of creativeListRes.elements ?? []) {
    const id = String(cr["id"] ?? "");
    const u = `urn:li:sponsoredCreative:${id}`;
    const content = cr["content"] as Record<string, unknown> | undefined;
    metaByUrn.set(u, {
      status: (cr["intendedStatus"] as string | undefined) ?? null,
      campaign: (cr["campaign"] as string | undefined) ?? null,
      content_type: content ? Object.keys(content)[0] ?? null : null,
    });
  }

  const enriched = [];
  for (const u of allUrns) {
    const lt = lifetime.get(u) ?? { impressions: 0, clicks: 0, costInUsd: 0, oneClickLeads: 0 };
    const r = recent.get(u) ?? { impressions: 0, clicks: 0, costInUsd: 0, oneClickLeads: 0 };
    const p = prior.get(u) ?? { impressions: 0, clicks: 0, costInUsd: 0, oneClickLeads: 0 };

    const ltCtr = pct(lt.clicks, lt.impressions);
    const rCtr = pct(r.clicks, r.impressions);
    const pCtr = pct(p.clicks, p.impressions);

    let fatigueScore: number | null = null;
    let fatigued = false;
    if (pCtr !== null && pCtr > 0 && rCtr !== null && p.impressions >= minPrior) {
      fatigueScore = Math.round(((pCtr - rCtr) / pCtr) * 10000) / 100;
      fatigued = fatigueScore >= threshold;
    }

    const meta = metaByUrn.get(u);
    enriched.push({
      creative_urn: u,
      creative_id: u.split(":").pop(),
      status: meta?.status ?? null,
      campaign_urn: meta?.campaign ?? null,
      content_type: meta?.content_type ?? null,
      lifetime_impressions: lt.impressions,
      lifetime_clicks: lt.clicks,
      lifetime_spend_usd: round2(lt.costInUsd),
      lifetime_leads: lt.oneClickLeads,
      lifetime_ctr_pct: ltCtr,
      recent_impressions: r.impressions,
      recent_ctr_pct: rCtr,
      prior_impressions: p.impressions,
      prior_ctr_pct: pCtr,
      ctr_drop_pct: fatigueScore,
      fatigued,
    });
  }

  enriched.sort((a, b) => b.lifetime_impressions - a.lifetime_impressions);

  const fatigued = enriched.filter((c) => c.fatigued);
  fatigued.sort((a, b) => (b.ctr_drop_pct ?? 0) - (a.ctr_drop_pct ?? 0));

  return {
    ad_account_id: accountId,
    fatigue_window_days: win,
    fatigue_threshold_pct: threshold,
    min_prior_impressions: minPrior,
    lookback_days: lifetimeDays,
    creative_count: enriched.length,
    fatigued_count: fatigued.length,
    fatigued,
    creatives: enriched,
  };
}
