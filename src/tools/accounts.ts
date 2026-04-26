import { z } from "zod";
import { liGet, resolveAdAccount, unwrapURN, urn } from "../client.js";

// ─── list-ad-accounts ───────────────────────────────────────────────────────

export const listAdAccountsSchema = {
  status: z
    .enum(["ACTIVE", "CANCELED", "DRAFT", "PENDING_DELETION", "REMOVED"])
    .optional()
    .describe("Filter by ad account status. Omit to return accounts in all statuses."),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Number of results per page (max 100)."),
};

export async function listAdAccounts(args: {
  status?: string;
  page_size?: number;
}) {
  const params: Record<string, string | number> = {
    q: "search",
    pageSize: args.page_size ?? 50,
  };
  if (args.status) {
    params["search"] = `(status:(values:List(${args.status})))`;
  }
  return liGet("/adAccounts", params);
}

// ─── get-account ─────────────────────────────────────────────────────────────

export const getAccountSchema = {
  ad_account_id: z
    .string()
    .optional()
    .describe(
      "Ad account numeric ID or URN (urn:li:sponsoredAccount:123). Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT. " +
      "The numeric ID is visible in Campaign Manager URLs: /accounts/<id>/."
    ),
};

export async function getAccount(args: { ad_account_id?: string }) {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  return liGet(`/adAccounts/${accountId}`);
}
