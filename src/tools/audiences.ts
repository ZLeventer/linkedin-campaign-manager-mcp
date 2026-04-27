import { z } from "zod";
import { liGet, resolveAdAccount } from "../client.js";

const SEGMENT_TYPES = ["USER", "COMPANY", "COMBINED"] as const;

// ─── get-audience-insights ──────────────────────────────────────────────────

export const getAudienceInsightsSchema = {
  ad_account_id: z.string().optional(),
  type: z
    .enum(SEGMENT_TYPES)
    .optional()
    .describe(
      "Filter segment type: USER (contact list / matched audience), " +
      "COMPANY (company list for ABM), COMBINED (combined / lookalike segment)."
    ),
  page_size: z.number().int().min(1).max(100).default(50),
};

export async function getAudienceInsights(args: {
  ad_account_id?: string;
  type?: string;
  page_size?: number;
}) {
  const account = resolveAdAccount(args.ad_account_id);
  const params: Record<string, string | number> = {
    q: "account",
    count: args.page_size ?? 50,
  };
  if (args.type) {
    params["type"] = args.type;
  }
  return liGet("/dmpSegments", params, { account });
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

export async function searchTargetingFacets(args: {
  facet: (typeof FACET_NAMES)[number];
  query: string;
  locale?: string;
  count?: number;
}) {
  const facetUrn = `urn:li:adTargetingFacet:${args.facet}`;
  return liGet(
    "/adTargetingFacets",
    {
      q: "typeahead",
      query: args.query,
      locale: args.locale ?? "en_US",
      count: args.count ?? 20,
    },
    { facetUrn }
  );
}
