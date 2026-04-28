import { z } from "zod";
import { liGet, resolveAdAccount, unwrapURN } from "../client.js";

export const namingConventionAuditSchema = {
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
  campaign_name_pattern: z
    .string()
    .optional()
    .describe("Optional regex (JS) campaign names must match. Example: '^[A-Z]{2,4}_[0-9]{4}_.+'. Omit to skip pattern check."),
  group_name_pattern: z
    .string()
    .optional()
    .describe("Optional regex campaign group names must match. Omit to skip."),
  require_utm: z
    .boolean()
    .default(true)
    .describe("Flag creatives whose destination URL is missing utm_source/utm_medium/utm_campaign."),
  require_conversion_tracking: z
    .boolean()
    .default(true)
    .describe("Flag campaigns with zero conversion events attached."),
  require_campaign_group: z
    .boolean()
    .default(true)
    .describe("Flag campaigns not assigned to a campaign group."),
  statuses: z
    .array(z.enum(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED", "COMPLETED"]))
    .default(["ACTIVE", "PAUSED", "DRAFT"])
    .describe("Statuses to audit. Default excludes ARCHIVED/COMPLETED."),
};

const REQUIRED_UTMS = ["utm_source", "utm_medium", "utm_campaign"];

function checkUtms(url: string | null | undefined): string[] {
  if (!url || typeof url !== "string") return REQUIRED_UTMS;
  try {
    const u = new URL(url);
    return REQUIRED_UTMS.filter((p) => !u.searchParams.has(p));
  } catch {
    return REQUIRED_UTMS;
  }
}

function compileRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

interface Violation {
  entity: "campaign" | "campaign_group" | "creative";
  id: string;
  name: string;
  rule: string;
  detail: string;
  url?: string;
}

export async function namingConventionAudit(args: {
  ad_account_id?: string;
  campaign_name_pattern?: string;
  group_name_pattern?: string;
  require_utm?: boolean;
  require_conversion_tracking?: boolean;
  require_campaign_group?: boolean;
  statuses?: string[];
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const statuses = args.statuses ?? ["ACTIVE", "PAUSED", "DRAFT"];
  const requireUtm = args.require_utm ?? true;
  const requireConv = args.require_conversion_tracking ?? true;
  const requireGroup = args.require_campaign_group ?? true;

  const campaignRegex = compileRegex(args.campaign_name_pattern);
  const groupRegex = compileRegex(args.group_name_pattern);

  const statusFilter = `(status:(values:List(${statuses.join(",")})))`;

  const [campaignsRes, groupsRes, creativesRes, conversionsRes] = await Promise.all([
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/adCampaigns`,
      { q: "search", pageSize: 100 },
      { search: statusFilter },
    ),
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/adCampaignGroups`,
      { q: "search", pageSize: 100 },
      { search: statusFilter },
    ),
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/creatives`,
      { q: "criteria", count: 100 },
    ),
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/conversions`,
      { q: "account", account, pageSize: 100 },
    ).catch(() => ({ elements: [] as Record<string, unknown>[] })),
  ]);

  const campaigns = campaignsRes.elements ?? [];
  const groups = groupsRes.elements ?? [];
  const creatives = creativesRes.elements ?? [];
  const conversions = conversionsRes.elements ?? [];

  const conversionsByCampaign = new Map<string, unknown[]>();
  for (const conv of conversions) {
    const associated = (conv["associatedCampaigns"] as Record<string, unknown>[] | undefined) ?? [];
    for (const camp of associated) {
      const cId = String(camp["campaign"] ?? "").split(":").pop();
      if (cId) {
        const list = conversionsByCampaign.get(cId) ?? [];
        list.push(conv["id"]);
        conversionsByCampaign.set(cId, list);
      }
    }
  }

  const violations: Violation[] = [];

  for (const g of groups) {
    const id = String(g["id"] ?? "");
    const name = String(g["name"] ?? "");
    if (groupRegex && !groupRegex.test(name)) {
      violations.push({
        entity: "campaign_group",
        id,
        name,
        rule: "name_pattern",
        detail: `Group name does not match pattern ${args.group_name_pattern}`,
      });
    }
  }

  for (const c of campaigns) {
    const id = String(c["id"] ?? "");
    const name = String(c["name"] ?? "");
    if (campaignRegex && !campaignRegex.test(name)) {
      violations.push({
        entity: "campaign",
        id,
        name,
        rule: "name_pattern",
        detail: `Campaign name does not match pattern ${args.campaign_name_pattern}`,
      });
    }
    if (requireGroup && !c["campaignGroup"]) {
      violations.push({
        entity: "campaign",
        id,
        name,
        rule: "missing_campaign_group",
        detail: "Campaign is not assigned to a campaign group",
      });
    }
    if (requireConv && (conversionsByCampaign.get(id) ?? []).length === 0) {
      violations.push({
        entity: "campaign",
        id,
        name,
        rule: "missing_conversion_tracking",
        detail: "No conversion events attached to this campaign",
      });
    }
  }

  if (requireUtm) {
    for (const cr of creatives) {
      const id = String(cr["id"] ?? "");
      const content = (cr["content"] as Record<string, Record<string, unknown>>) ?? {};
      const url =
        (content["reference"]?.["landingPage"] as string | undefined) ??
        (content["textAd"]?.["landingPage"] as string | undefined) ??
        (content["spotlight"]?.["landingPage"] as string | undefined) ??
        (cr["destinationUrl"] as string | undefined) ??
        null;
      const missing = checkUtms(url);
      if (missing.length > 0 && url) {
        violations.push({
          entity: "creative",
          id,
          name: id,
          rule: "missing_utm",
          detail: `Destination URL missing: ${missing.join(", ")}`,
          url,
        });
      }
    }
  }

  const summary: Record<string, number> = {};
  for (const v of violations) {
    summary[v.rule] = (summary[v.rule] ?? 0) + 1;
  }

  return {
    ad_account_id: accountId,
    scanned: {
      campaigns: campaigns.length,
      campaign_groups: groups.length,
      creatives: creatives.length,
      conversion_events: conversions.length,
    },
    violation_count: violations.length,
    violations_by_rule: summary,
    violations,
  };
}
