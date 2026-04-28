import { z } from "zod";
import { liGet, resolveAdAccount, unwrapURN } from "../client.js";

export const getOrganicPostPerformanceSchema = {
  organization_id: z
    .string()
    .optional()
    .describe(
      "LinkedIn organization ID or URN (urn:li:organization:123). " +
      "If omitted, the organization is resolved from the ad account's referenceOrganization field."
    ),
  ad_account_id: z.string().optional(),
  count: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Number of recent posts to fetch (max 50)."),
};

export async function getOrganicPostPerformance(args: {
  organization_id?: string;
  ad_account_id?: string;
  count?: number;
}) {
  let orgId: string;

  if (args.organization_id) {
    orgId = args.organization_id.startsWith("urn:li:organization:")
      ? args.organization_id.split(":").pop()!
      : args.organization_id;
  } else {
    const account = resolveAdAccount(args.ad_account_id);
    const accountId = unwrapURN(account);
    const accountData = await liGet<{ referenceOrganization?: string }>(
      `/adAccounts/${accountId}`
    );
    const refOrg = accountData.referenceOrganization;
    if (!refOrg) {
      throw new Error(
        "Could not determine organization URN from the ad account. Pass organization_id explicitly."
      );
    }
    orgId = unwrapURN(refOrg);
  }

  const orgUrn = `urn:li:organization:${orgId}`;
  const count = args.count ?? 10;

  // Fetch recent organic posts (UGC posts authored by the organization)
  const postsResponse = await liGet<{ elements?: Array<Record<string, unknown>> }>(
    "/ugcPosts",
    { count, sortBy: "LAST_MODIFIED" },
    { q: "authors", authors: `List(${orgUrn})` }
  );

  const posts = postsResponse.elements ?? [];

  if (posts.length === 0) {
    return {
      organization_id: orgId,
      organization_urn: orgUrn,
      posts: [],
      note: "No posts found. Requires r_organization_social OAuth scope — if missing, request it in your LinkedIn Developer App.",
    };
  }

  // Fetch share statistics for the returned posts
  const postUrns = posts.map((p) => p["id"] as string).filter(Boolean);

  let statsMap = new Map<string, Record<string, unknown>>();
  try {
    const statsResponse = await liGet<{ elements?: Array<Record<string, unknown>> }>(
      "/organizationalEntityShareStatistics",
      {},
      {
        q: "organizationalEntityAndShareUrns",
        organizationalEntity: orgUrn,
        shareUrns: `List(${postUrns.join(",")})`,
      }
    );
    for (const stat of statsResponse.elements ?? []) {
      const key = (stat["ugcPost"] ?? stat["share"]) as string;
      if (key) statsMap.set(key, stat);
    }
  } catch {
    // Stats call may fail if r_organization_social scope is missing; return posts without stats
  }

  const enriched = posts.map((post) => {
    const postId = post["id"] as string;
    const stats = statsMap.get(postId);
    return {
      id: postId,
      created: post["created"],
      last_modified: post["lastModified"],
      lifecycle_state: post["lifecycleState"],
      content: post["specificContent"],
      statistics: stats?.["totalShareStatistics"] ?? null,
    };
  });

  return {
    organization_id: orgId,
    organization_urn: orgUrn,
    post_count: enriched.length,
    posts: enriched,
    note: "Requires r_organization_social OAuth scope. If statistics are null, add this scope to your LinkedIn app and re-run `npm run auth`.",
  };
}
