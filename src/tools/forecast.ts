import { z } from "zod";
import { BASE_URL, liGet, liGetRaw, resolveAdAccount, unwrapURN } from "../client.js";

// Serialize a JS object to LinkedIn Rest.li format.
// Objects become (key:value,...), arrays become List(a,b,c), strings pass through as-is.
function serializeRestLi(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `List(${value.map(serializeRestLi).filter(Boolean).join(",")})`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}:${serializeRestLi(v)}`);
    return `(${entries.join(",")})`;
  }
  return String(value);
}

export const forecastAudienceSchema = {
  campaign_id: z
    .string()
    .describe(
      "Campaign ID or URN whose targetingCriteria to use for the forecast. " +
      "The campaign's existing targeting will be passed to LinkedIn's audienceCounts endpoint to estimate reach."
    ),
  ad_account_id: z.string().optional(),
};

export async function forecastAudience(args: {
  campaign_id: string;
  ad_account_id?: string;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const accountUrn = `urn:li:sponsoredAccount:${accountId}`;

  const campaignId = args.campaign_id.startsWith("urn:li:")
    ? args.campaign_id.split(":").pop()!
    : args.campaign_id;

  const campaign = await liGet<Record<string, unknown>>(
    `/adAccounts/${accountId}/adCampaigns/${campaignId}`
  );

  const targetingCriteria = campaign["targetingCriteria"];
  if (!targetingCriteria) {
    return {
      campaign_id: campaignId,
      campaign_name: campaign["name"],
      audience_count: null,
      message: "No targetingCriteria found on this campaign. LinkedIn requires targeting to be configured before forecasting.",
    };
  }

  const criteriaParam = serializeRestLi(targetingCriteria);
  const url =
    `${BASE_URL}/audienceCounts?q=targetingCriteria` +
    `&account=${accountUrn}` +
    `&targetingCriteria=${criteriaParam}`;

  const result = await liGetRaw<Record<string, unknown>>(url);

  return {
    account_id: accountId,
    campaign_id: campaignId,
    campaign_name: campaign["name"],
    audience_count: result,
    targeting_criteria: targetingCriteria,
    note: "Audience counts are LinkedIn estimates and are rounded for member privacy. The count reflects LinkedIn members matching the criteria, not necessarily reachable impressions — some members may have ad delivery opted out or be inactive.",
  };
}
