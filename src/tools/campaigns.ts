import { z } from "zod";
import { liGet, resolveAdAccount, unwrapURN, urn } from "../client.js";

const CAMPAIGN_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "COMPLETED",
  "CANCELED",
  "DRAFT",
  "PENDING_DELETION",
  "REMOVED",
] as const;

const CREATIVE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "DRAFT",
  "PENDING_DELETION",
  "REMOVED",
] as const;

// ─── list-campaigns ─────────────────────────────────────────────────────────

export const listCampaignsSchema = {
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
  status: z
    .enum(CAMPAIGN_STATUSES)
    .optional()
    .describe("Filter by campaign status. Omit to return campaigns in all statuses."),
  campaign_group_id: z
    .string()
    .optional()
    .describe("Filter to campaigns belonging to a specific campaign group (numeric ID or URN)."),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function listCampaigns(args: {
  ad_account_id?: string;
  status?: string;
  campaign_group_id?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const params: Record<string, string | number> = {
    q: "search",
    pageSize: args.page_size ?? 50,
  };
  const criteria: string[] = [];
  if (args.status) {
    criteria.push(`status:(values:List(${args.status}))`);
  }
  if (args.campaign_group_id) {
    const groupUrn = urn("sponsoredCampaignGroup", args.campaign_group_id);
    criteria.push(`campaignGroup:(values:List(${groupUrn}))`);
  }
  const rawParams =
    criteria.length > 0 ? { search: `(${criteria.join(",")})` } : undefined;
  return liGet(`/adAccounts/${accountId}/adCampaigns`, params, rawParams);
}

// ─── get-campaign ────────────────────────────────────────────────────────────

export const getCampaignSchema = {
  campaign_id: z
    .string()
    .describe("Campaign numeric ID or URN (urn:li:sponsoredCampaign:123). Required."),
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
};

export async function getCampaign(args: { campaign_id: string; ad_account_id?: string }) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const campaignId = unwrapURN(urn("sponsoredCampaign", args.campaign_id));
  return liGet(`/adAccounts/${accountId}/adCampaigns/${campaignId}`);
}

// ─── list-campaign-groups ───────────────────────────────────────────────────

export const listCampaignGroupsSchema = {
  ad_account_id: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function listCampaignGroups(args: {
  ad_account_id?: string;
  status?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const params: Record<string, string | number> = {
    q: "search",
    pageSize: args.page_size ?? 50,
  };
  const rawParams = args.status
    ? { search: `(status:(values:List(${args.status})))` }
    : undefined;
  return liGet(`/adAccounts/${accountId}/adCampaignGroups`, params, rawParams);
}

// ─── list-creatives ─────────────────────────────────────────────────────────

export const listCreativesSchema = {
  ad_account_id: z.string().optional(),
  campaign_id: z
    .string()
    .optional()
    .describe("Filter to creatives in a specific campaign (numeric ID or URN)."),
  status: z.enum(CREATIVE_STATUSES).optional().describe("Filter by intendedStatus."),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function listCreatives(args: {
  ad_account_id?: string;
  campaign_id?: string;
  status?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  // 202604 API: q=criteria with count (not q=search with pageSize)
  const params: Record<string, string | number> = {
    q: "criteria",
    count: args.page_size ?? 50,
  };
  const criteria: string[] = [];
  if (args.campaign_id) {
    const camp = urn("sponsoredCampaign", args.campaign_id);
    criteria.push(`campaigns:(values:List(${camp}))`);
  }
  if (args.status) {
    criteria.push(`intendedStatus:(values:List(${args.status}))`);
  }
  const rawParams =
    criteria.length > 0 ? { search: `(${criteria.join(",")})` } : undefined;
  return liGet(`/adAccounts/${accountId}/creatives`, params, rawParams);
}

// ─── get-creative ─────────────────────────────────────────────────────────────

export const getCreativeSchema = {
  creative_id: z
    .string()
    .describe("Creative numeric ID or URN (urn:li:sponsoredCreative:123). Required."),
  ad_account_id: z
    .string()
    .optional()
    .describe("Ad account numeric ID or URN. Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT."),
};

export async function getCreative(args: { creative_id: string; ad_account_id?: string }) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const creativeId = unwrapURN(urn("sponsoredCreative", args.creative_id));
  return liGet(`/adAccounts/${accountId}/creatives/${creativeId}`);
}
