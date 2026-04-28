import { z } from "zod";
import { liGet, liGetRaw, BASE_URL, resolveAdAccount } from "../client.js";

// ─── get-audience-insights ──────────────────────────────────────────────────

export const getAudienceInsightsSchema = {
  ad_account_id: z.string().optional(),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function getAudienceInsights(args: {
  ad_account_id?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  // dmpSegments requires the r_dmp_profile scope beyond r_ads.
  // Fall back to listing matched audiences via adAudienceMatchingEntities if available.
  const params: Record<string, string | number> = {
    q: "account",
    account: account,
    count: args.page_size ?? 50,
  };
  return liGet("/dmpSegments", params);
}

// ─── search-targeting-facets ─────────────────────────────────────────────────

const FACET_NAMES = [
  "jobTitles",
  "skills",
  "companies",
  "degrees",
  "fieldsOfStudy",
  "schools",
  "industries",
  "seniorities",
  "memberGroups",
  "locations",
  "countriesAndTerritories",
  "interfaceLocales",
  "employmentStatus",
  "companySize",
] as const;

export const searchTargetingFacetsSchema = {
  facet: z
    .enum(FACET_NAMES)
    .describe(
      "Targeting facet to search. Use jobTitles for job title targeting, skills for skill-based " +
      "targeting, companies to find specific company targets, industries for vertical targeting, " +
      "seniorities for seniority-level targeting, locations for geo targeting."
    ),
  query: z
    .string()
    .describe("Search string to filter facet values. Example: 'supply chain' for jobTitles."),
  locale: z
    .string()
    .default("en_US")
    .describe("Locale for facet label localization. Default: en_US."),
  count: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of matching facet values to return (max 50)."),
};

function toRestLiLocale(locale: string): string {
  // Convert "en_US" → "(language:en,country:US)" for the Rest.li adTargetingEntities endpoint.
  const parts = (locale ?? "en_US").split("_");
  return parts.length === 2 ? `(language:${parts[0]},country:${parts[1]})` : `(language:${parts[0]})`;
}

export async function searchTargetingFacets(args: {
  facet: (typeof FACET_NAMES)[number];
  query: string;
  locale?: string;
  count?: number;
}) {
  const facetUrn = encodeURIComponent(`urn:li:adTargetingFacet:${args.facet}`);
  const locale = toRestLiLocale(args.locale ?? "en_US");
  const query = encodeURIComponent(args.query);
  const count = args.count ?? 20;
  const url = `${BASE_URL}/adTargetingEntities?q=typeahead&query=${query}&facet=${facetUrn}&locale=${locale}&count=${count}`;
  return liGetRaw(url);
}
