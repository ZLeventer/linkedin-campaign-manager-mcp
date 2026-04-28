#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  listAdAccounts, listAdAccountsSchema,
  getAccount, getAccountSchema,
} from "./tools/accounts.js";
import {
  listCampaigns, listCampaignsSchema,
  getCampaign, getCampaignSchema,
  listCampaignGroups, listCampaignGroupsSchema,
  listCreatives, listCreativesSchema,
  getCreative, getCreativeSchema,
} from "./tools/campaigns.js";
import {
  getCampaignPerformance, getCampaignPerformanceSchema,
  getDemographicsReport, getDemographicsReportSchema,
  comparePeriods, comparePeriodsSchema,
  getVideoAnalytics, getVideoAnalyticsSchema,
  getBudgetPacing, getBudgetPacingSchema,
} from "./tools/analytics.js";
import {
  getConversionEvents, getConversionEventsSchema,
  getConversionPerformance, getConversionPerformanceSchema,
} from "./tools/conversions.js";
import {
  getAudienceInsights, getAudienceInsightsSchema,
  searchTargetingFacets, searchTargetingFacetsSchema,
} from "./tools/audiences.js";
import {
  getLeadgenForms, getLeadgenFormsSchema,
  getLeadgenResponses, getLeadgenResponsesSchema,
  getLeadgenFormPerformance, getLeadgenFormPerformanceSchema,
} from "./tools/leadgen.js";
import { getReachFrequency, getReachFrequencySchema } from "./tools/reach.js";
import { getTargetingCriteria, getTargetingCriteriaSchema } from "./tools/targeting.js";
import { getOrganicPostPerformance, getOrganicPostPerformanceSchema } from "./tools/organic.js";
import { forecastAudience, forecastAudienceSchema } from "./tools/forecast.js";
import { compareCreatives, compareCreativesSchema } from "./tools/compare.js";
import { checkAuthStatus, checkAuthStatusSchema } from "./tools/authstatus.js";

const server = new McpServer({
  name: "linkedin-campaign-manager-mcp",
  version: "1.2.0",
});

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
  };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

server.tool(
  "li_list_ad_accounts",
  "List all LinkedIn ad accounts the authenticated user has access to. Returns account ID, name, status, currency, type (BUSINESS/ENTERPRISE), and reference organization URN. Use this first to discover the ad_account_id needed by other tools. Filter by status (ACTIVE/CANCELED/DRAFT/PENDING_DELETION/REMOVED) or omit to see all accounts.",
  listAdAccountsSchema,
  async (args) => { try { return ok(await listAdAccounts(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_account",
  "Get full details for a single LinkedIn ad account, including currency code, status, account type (BUSINESS/ENTERPRISE), total budget, billing info, and the associated organization URN. Useful for confirming account currency before interpreting spend data, or checking billing status before troubleshooting ad delivery issues.",
  getAccountSchema,
  async (args) => { try { return ok(await getAccount(args)); } catch (e) { return err(e); } }
);

// ─── Campaigns ───────────────────────────────────────────────────────────────

server.tool(
  "li_list_campaigns",
  "List campaigns in a LinkedIn ad account. Returns campaign name, status, objectiveType (WEBSITE_VISITS/LEAD_GENERATION/BRAND_AWARENESS/etc.), optimizationTargetType, bid amount, daily/total budget, run schedule, and targeting criteria summary. Filter by status or campaign_group_id. Use li_get_campaign for full targeting detail on a specific campaign.",
  listCampaignsSchema,
  async (args) => { try { return ok(await listCampaigns(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_campaign",
  "Get complete detail for a single LinkedIn campaign, including the full targetingCriteria object (all included/excluded facets), bid strategy, unit cost, daily/total budget, run schedule, objective, optimization target, format, and locale. Use this when you need to audit targeting setup, diagnose budget configuration, or confirm campaign structure before pulling performance data.",
  getCampaignSchema,
  async (args) => { try { return ok(await getCampaign(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_list_campaign_groups",
  "List campaign groups in a LinkedIn ad account. Campaign groups are containers that group related campaigns under a shared name and optional total budget cap. Returns group name, status, total budget, run schedule, and the campaigns count. Use to understand account structure before pulling campaign-level data.",
  listCampaignGroupsSchema,
  async (args) => { try { return ok(await listCampaignGroups(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_list_creatives",
  "List ad creatives in a LinkedIn ad account. Returns creative content type (SPONSORED_STATUS_UPDATE/MESSAGE/etc.), intendedStatus, associated campaigns, and content URNs. Filter by campaign_id to see all creatives on a specific campaign, or by status to find paused/archived ads. Use li_get_creative for full content detail on a specific creative.",
  listCreativesSchema,
  async (args) => { try { return ok(await listCreatives(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_creative",
  "Get full detail for a single LinkedIn ad creative, including the creative content (headline, body copy, destination URL, image/video URNs, call-to-action label), intendedStatus, associated campaign URNs, and creative type. Use when auditing ad copy and creative assets, debugging a rejected creative, or pulling the landing page URL to cross-reference with GA4 UTM data.",
  getCreativeSchema,
  async (args) => { try { return ok(await getCreative(args)); } catch (e) { return err(e); } }
);

// ─── Analytics ───────────────────────────────────────────────────────────────

server.tool(
  "li_get_campaign_performance",
  "Fetch performance metrics for LinkedIn campaigns over a date range. Returns impressions, clicks, spend (USD and local currency), website conversions, one-click lead form submissions, landing-page clicks, video views, follows, reactions, comments, and shares. Pass campaign_ids for specific campaigns or use ad_account_id for account-level totals. Supports DAILY/MONTHLY/YEARLY/ALL time granularity and CAMPAIGN/CAMPAIGN_GROUP/CREATIVE/ACCOUNT pivots. Default range: last 28 days.",
  getCampaignPerformanceSchema,
  async (args) => { try { return ok(await getCampaignPerformance(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_demographics_report",
  "Break down LinkedIn campaign performance by a demographic dimension of the people who saw or clicked your ads. Pivot options: MEMBER_JOB_TITLE (which titles engage most), MEMBER_JOB_FUNCTION, MEMBER_SENIORITY (director vs. manager vs. C-suite), MEMBER_COMPANY (which accounts clicked), MEMBER_COMPANY_SIZE, MEMBER_INDUSTRY, MEMBER_COUNTRY_V2, MEMBER_REGION_V2. Returns impressions, clicks, spend, leads, and conversions per dimension value. Useful for buyer-persona fit analysis and ABM account-list validation.",
  getDemographicsReportSchema,
  async (args) => { try { return ok(await getDemographicsReport(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_compare_periods",
  "Compare LinkedIn campaign performance across two time periods. wow (week-over-week): last 7d vs prior 7d. mom (month-over-month): last 30d vs prior 30d. yoy (year-over-year): last 30d vs same 30d last year. Returns per-entity rows (keyed by campaign/creative URN) with _current, _prior, _delta, and _pct_change columns for every requested metric. Deltas are computed server-side so you do not need to post-process. Useful for weekly/monthly performance reports and anomaly detection.",
  comparePeriodsSchema,
  async (args) => { try { return ok(await comparePeriods(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_video_analytics",
  "Fetch video-specific performance metrics for LinkedIn campaigns, broken down by creative. Returns videoStarts, videoViews, videoFirstQuartileCompletions, videoMidpointCompletions, videoThirdQuartileCompletions, videoCompletions, plus a computed videoCompletionRate (completions / starts × 100). Use to evaluate video ad quality — high completion rates indicate compelling content; low rates signal drop-off. Scope to specific campaigns via campaign_ids or report at account level.",
  getVideoAnalyticsSchema,
  async (args) => { try { return ok(await getVideoAnalytics(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_budget_pacing",
  "Calculate budget utilization for active LinkedIn campaigns. Compares spend over the specified period_days window against total or estimated period budget, and returns a utilization_pct for each campaign. Useful for mid-flight pacing checks: if utilization is below 80% near the end of a month, the campaign may be under-delivering; above 100% means it is over-pacing. Accepts optional campaign_ids to limit scope; defaults to all ACTIVE campaigns in the account.",
  getBudgetPacingSchema,
  async (args) => { try { return ok(await getBudgetPacing(args)); } catch (e) { return err(e); } }
);

// ─── Conversions ─────────────────────────────────────────────────────────────

server.tool(
  "li_get_conversion_events",
  "List LinkedIn conversion event definitions on an ad account. Returns each event's name, type (URL/FILE_DOWNLOAD/SIGN_UP/etc.), enabled status, attributionType, post-click and view-through attribution window sizes, and associated Insight Tag. These are the events tracked by the LinkedIn Insight Tag on your website. Use to audit conversion event setup, confirm event names before pulling conversion performance, or verify attribution window configuration.",
  getConversionEventsSchema,
  async (args) => { try { return ok(await getConversionEvents(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_conversion_performance",
  "Fetch conversion performance broken down by conversion event (CONVERSION pivot). Returns externalWebsiteConversions, externalWebsitePostClickConversions, externalWebsitePostViewConversions, impressions, clicks, and spend per conversion event. Use to compare cost-per-conversion across event types, diagnose which Insight Tag events are driving value, or build a funnel from impression → click → conversion. Scope to specific campaigns or report at account level.",
  getConversionPerformanceSchema,
  async (args) => { try { return ok(await getConversionPerformance(args)); } catch (e) { return err(e); } }
);

// ─── Audiences ───────────────────────────────────────────────────────────────

server.tool(
  "li_get_audience_insights",
  "List DMP (Data Management Platform) segments attached to a LinkedIn ad account. Segments represent matched audiences (USER type: contact list uploads, website retargeting, lookalike audiences) and company lists (COMPANY type: for account-based marketing). Returns segment name, type, source, estimated size (where LinkedIn reports it), and status. Use to audit available audiences before building campaigns, or to confirm a matched audience uploaded successfully and has enough members to serve ads.",
  getAudienceInsightsSchema,
  async (args) => { try { return ok(await getAudienceInsights(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_search_targeting_facets",
  "Search LinkedIn targeting facet values to find the correct URNs for audience targeting. Facets include: jobTitles (e.g., 'Supply Chain Director'), skills (e.g., 'S&OP'), companies, industries, seniorities, locations, and more. Returns matching facet values with their LinkedIn URNs, which can then be used to configure campaign targeting via the Campaign Manager UI. Useful for researching targeting options, confirming exact category names, or building audience documentation.",
  searchTargetingFacetsSchema,
  async (args) => { try { return ok(await searchTargetingFacets(args)); } catch (e) { return err(e); } }
);

// ─── Lead Gen ─────────────────────────────────────────────────────────────────

server.tool(
  "li_get_leadgen_forms",
  "List LinkedIn Lead Gen Forms on an ad account. Returns form name, state (ACTIVE/DRAFT/ARCHIVED), the list of questions asked (field type, label, pre-fill source), the thank-you page URL and message, and the associated landing page (if any). Use to audit form question setup, confirm form state before troubleshooting lead delivery, or verify which forms are attached to active campaigns.",
  getLeadgenFormsSchema,
  async (args) => { try { return ok(await getLeadgenForms(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_leadgen_responses",
  "Retrieve actual Lead Gen Form submission data from LinkedIn. Each response includes questionResponses with field-by-field values (first name, last name, email, company, job title, phone, etc.) and submission timestamp. Filter by lead_form_id and/or submitted_after/before date range. Use for lead-to-CRM reconciliation against SFDC or Marketo, for auditing lead quality, or for confirming that a form integration is capturing the right fields. NOTE: This endpoint returns PII — handle output as sensitive data.",
  getLeadgenResponsesSchema,
  async (args) => { try { return ok(await getLeadgenResponses(args)); } catch (e) { return err(e); } }
);

server.tool(
  "li_get_leadgen_form_performance",
  "Fetch LinkedIn Lead Gen Form performance analytics broken down by creative. Returns impressions, clicks, Lead Gen Form opens (oneClickLeadFormOpens), lead submissions (oneClickLeads), spend, and computed metrics: formOpenRate (opens / clicks), leadSubmitRate (submissions / opens), costPerLead (spend / submissions), and CTR. Use to identify high-performing LGF creatives, diagnose drop-off between form open and submission, or compare cost-per-lead across campaigns.",
  getLeadgenFormPerformanceSchema,
  async (args) => { try { return ok(await getLeadgenFormPerformance(args)); } catch (e) { return err(e); } }
);

// ─── Reach & Frequency ───────────────────────────────────────────────────────

server.tool(
  "li_get_reach_frequency",
  "Fetch reach and frequency metrics for LinkedIn campaigns. Returns approximateUniqueImpressions (unique members reached), impressions, and computed frequency (avg times each member saw your ad) and cost-per-reach per campaign or creative. Useful for diagnosing ad fatigue (frequency > 5–7 in 30 days typically hurts CTR), planning brand awareness budgets, and comparing reach efficiency across campaigns. LinkedIn rounds uniqueImpressions for member privacy.",
  getReachFrequencySchema,
  async (args) => { try { return ok(await getReachFrequency(args)); } catch (e) { return err(e); } }
);

// ─── Targeting Criteria ──────────────────────────────────────────────────────

server.tool(
  "li_get_targeting_criteria",
  "Read a campaign's full targeting configuration and resolve URN-based facets to human-readable labels. Decodes job functions (urn:li:function:18 → Operations), seniorities, industries, and geo URNs by calling the LinkedIn reference data endpoints. Returns both a resolved (human-readable) view and the raw targetingCriteria object. Useful for targeting audits, documentation, and verifying that a campaign is hitting the intended personas before launch.",
  getTargetingCriteriaSchema,
  async (args) => { try { return ok(await getTargetingCriteria(args)); } catch (e) { return err(e); } }
);

// ─── Organic Post Performance ────────────────────────────────────────────────

server.tool(
  "li_get_organic_post_performance",
  "Fetch organic LinkedIn Company Page post performance. Returns recent UGC posts with per-post engagement statistics: impressions, clicks, reactions, shares, comments. Resolves the organization from the ad account's referenceOrganization if not passed explicitly. NOTE: Requires the r_organization_social OAuth scope — if your LinkedIn app was approved only for Marketing Developer Platform, re-authorize after adding this scope in the LinkedIn App portal.",
  getOrganicPostPerformanceSchema,
  async (args) => { try { return ok(await getOrganicPostPerformance(args)); } catch (e) { return err(e); } }
);

// ─── Audience Forecast ───────────────────────────────────────────────────────

server.tool(
  "li_forecast_audience",
  "Estimate the reachable audience size for a campaign's targeting criteria using LinkedIn's audienceCounts endpoint. Pass a campaign_id to use its existing targetingCriteria as the input. Returns LinkedIn's estimated member count matching those criteria. Useful for validating that a targeting configuration will reach enough members before launch, or for comparing audience size before and after tightening/broadening targeting. Counts are rounded by LinkedIn for privacy.",
  forecastAudienceSchema,
  async (args) => { try { return ok(await forecastAudience(args)); } catch (e) { return err(e); } }
);

// ─── Creative Comparison ─────────────────────────────────────────────────────

server.tool(
  "li_compare_creatives",
  "Compare 2–10 LinkedIn ad creatives on CTR, CPL, CPC, and conversion rate over a date range. Runs two-proportion z-tests to determine whether performance differences are statistically significant (95% and 99% confidence levels). Returns a ranked table, per-creative metrics, and pairwise comparison results with a winner declaration. Use when deciding which creative to pause, scale, or iterate on. Requires ~1,000+ impressions per creative for reliable significance.",
  compareCreativesSchema,
  async (args) => { try { return ok(await compareCreatives(args)); } catch (e) { return err(e); } }
);

// ─── Auth Status ─────────────────────────────────────────────────────────────

server.tool(
  "li_check_auth_status",
  "Check the status of your LinkedIn OAuth tokens without making an API call. Returns whether the access token and refresh token are valid, their exact expiry timestamps, days remaining, the granted OAuth scopes, and which environment variables (LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_DEFAULT_AD_ACCOUNT, LINKEDIN_API_VERSION) are configured. Run this first when troubleshooting 401/403 errors or when setting up the server on a new machine.",
  checkAuthStatusSchema,
  async (args) => { try { return ok(await checkAuthStatus(args as Record<string, never>)); } catch (e) { return err(e); } }
);

const transport = new StdioServerTransport();
await server.connect(transport);
