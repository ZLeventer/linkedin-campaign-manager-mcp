import { z } from "zod";
import { liGet, resolveAdAccount, unwrapURN } from "../client.js";

export const getTargetingCriteriaSchema = {
  campaign_id: z
    .string()
    .describe("Campaign numeric ID or URN whose targeting criteria to inspect."),
  ad_account_id: z.string().optional(),
  resolve_labels: z
    .boolean()
    .default(true)
    .describe(
      "Attempt to resolve URNs to human-readable labels (functions, industries, seniorities, geo). " +
      "Set false to return raw URNs only — faster, no extra API calls."
    ),
};

// Industry IDs absent from /industries/{id} (newer or deprecated taxonomy entries).
// Populated via adTargetingEntities reverse-search — add new entries as encountered.
const INDUSTRY_FALLBACK = new Map<string, string>([
  ["332", "Oil, Gas, and Mining"],
  ["598", "Apparel Manufacturing"],
  ["1339", "Food and Beverage Retail"],
  ["1757", "Real Estate and Equipment Rental Services"],
  ["1759", "Leasing Residential Real Estate"],
  ["1770", "Real Estate Agents and Brokers"],
  ["1810", "Professional Services"],
  ["1862", "Marketing Services"],
  ["1999", "Education"],
  ["2074", "Home Health Care Services"],
  ["2115", "Community Services"],
  ["2130", "Performing Arts and Spectator Sports"],
  ["2391", "Military and International Affairs"],
  ["3133", "Media and Telecommunications"],
]);

function localizedName(data: { name?: { localized?: { en_US?: string }; value?: string } } | null): string | null {
  return data?.name?.localized?.en_US ?? data?.name?.value ?? null;
}

function decodeStaffCountRange(urn: string): string | null {
  const m = urn.match(/\((\d+),(\d+)\)/);
  if (!m) return null;
  const [, lo, hi] = m;
  return lo === hi ? `${lo} employee` : `${lo}–${hi} employees`;
}

function decodeLocale(urn: string): string {
  const tag = urn.replace("urn:li:locale:", "");
  const [lang, country] = tag.split("_");
  return country ? `${lang.toUpperCase()} (${country})` : lang.toUpperCase();
}

async function resolveUrn(u: string): Promise<string> {
  // Static decodes — no API call needed
  if (u.startsWith("urn:li:staffCountRange:")) {
    return decodeStaffCountRange(u) ?? u;
  }
  if (u.startsWith("urn:li:locale:")) {
    return decodeLocale(u);
  }
  try {
    let m = u.match(/^urn:li:title:(\d+)$/);
    if (m) {
      const data = await liGet<{ name?: { localized?: { en_US?: string }; value?: string } }>(`/titles/${m[1]}`);
      return localizedName(data) ?? u;
    }
    m = u.match(/^urn:li:function:(\d+)$/);
    if (m) {
      const data = await liGet<{ name?: { localized?: { en_US?: string }; value?: string } }>(`/functions/${m[1]}`);
      return localizedName(data) ?? u;
    }
    m = u.match(/^urn:li:seniority[:/](\d+)$/);
    if (m) {
      const data = await liGet<{ name?: { localized?: { en_US?: string }; value?: string } }>(`/seniorities/${m[1]}`);
      return localizedName(data) ?? u;
    }
    m = u.match(/^urn:li:industry:(\d+)$/);
    if (m) {
      const fallback = INDUSTRY_FALLBACK.get(m[1]);
      if (fallback) return fallback;
      const data = await liGet<{ name?: { localized?: { en_US?: string }; value?: string } }>(`/industries/${m[1]}`);
      return localizedName(data) ?? u;
    }
    m = u.match(/^urn:li:geo:(\d+)$/);
    if (m) {
      const data = await liGet<{ defaultLocalizedName?: { value?: string }; name?: { localized?: { en_US?: string }; value?: string } }>(`/geo/${m[1]}`);
      return data?.defaultLocalizedName?.value ?? localizedName(data) ?? u;
    }
    m = u.match(/^urn:li:adSegment:(\d+)$/);
    if (m) {
      const data = await liGet<{ name?: string }>(`/adSegments/${m[1]}`);
      return data?.name ? `Audience: ${data.name}` : u;
    }
    m = u.match(/^urn:li:organization:(\d+)$/);
    if (m) {
      // r_organization_social scope required — label with ID so it's not fully opaque
      return `Company (org:${m[1]})`;
    }
  } catch {
    // Return raw URN if resolution fails (scope issue, 404, etc.)
  }
  return u;
}

function extractUrns(obj: unknown): string[] {
  if (typeof obj === "string" && obj.startsWith("urn:li:")) return [obj];
  if (Array.isArray(obj)) return obj.flatMap(extractUrns);
  if (obj && typeof obj === "object") {
    return Object.values(obj as Record<string, unknown>).flatMap(extractUrns);
  }
  return [];
}

function substituteLabels(obj: unknown, urnMap: Map<string, string>): unknown {
  if (typeof obj === "string") {
    if (!obj.startsWith("urn:li:")) return obj;
    const label = urnMap.get(obj);
    return label && label !== obj ? `${label} (${obj})` : obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => substituteLabels(v, urnMap));
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteLabels(v, urnMap),
      ])
    );
  }
  return obj;
}

export async function getTargetingCriteria(args: {
  campaign_id: string;
  ad_account_id?: string;
  resolve_labels?: boolean;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const campaignId = args.campaign_id.startsWith("urn:li:")
    ? args.campaign_id.split(":").pop()!
    : args.campaign_id;

  const campaign = await liGet<Record<string, unknown>>(
    `/adAccounts/${accountId}/adCampaigns/${campaignId}`
  );

  const criteria = campaign["targetingCriteria"] as Record<string, unknown> | undefined;

  if (!criteria) {
    return {
      campaign_id: campaignId,
      campaign_name: campaign["name"],
      targeting_criteria: null,
      message: "No targetingCriteria found on this campaign.",
    };
  }

  if (args.resolve_labels === false) {
    return {
      campaign_id: campaignId,
      campaign_name: campaign["name"],
      objective_type: campaign["objectiveType"],
      status: campaign["status"],
      targeting_criteria: criteria,
    };
  }

  const allUrns = [...new Set(extractUrns(criteria))];
  const resolved = await Promise.all(
    allUrns.map(async (u) => ({ urn: u, label: await resolveUrn(u) }))
  );
  const urnMap = new Map(resolved.map((r) => [r.urn, r.label]));

  return {
    campaign_id: campaignId,
    campaign_name: campaign["name"],
    objective_type: campaign["objectiveType"],
    status: campaign["status"],
    targeting_criteria_resolved: substituteLabels(criteria, urnMap),
    targeting_criteria_raw: criteria,
    resolved_urns: resolved.filter((r) => r.label !== r.urn),
    unresolved_urns: resolved.filter((r) => r.label === r.urn).map((r) => r.urn),
  };
}
