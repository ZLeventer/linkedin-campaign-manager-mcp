# LinkedIn Campaign Manager MCP

[![npm version](https://img.shields.io/npm/v/linkedin-campaign-manager-mcp.svg)](https://www.npmjs.com/package/linkedin-campaign-manager-mcp)
[![npm downloads](https://img.shields.io/npm/dm/linkedin-campaign-manager-mcp.svg)](https://www.npmjs.com/package/linkedin-campaign-manager-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**MCP server for the LinkedIn Marketing API — query campaigns, performance, and Lead Gen Forms from Claude in plain English.**

19 read-only tools covering ad accounts, campaigns, creatives, performance analytics, demographics, video analytics, budget pacing, period comparisons, conversions, Lead Gen Forms, audiences, and targeting facets. Built for B2B paid social teams running Sponsored Content, Lead Gen Forms, and account-based campaigns on LinkedIn.

---

## Why this exists

The LinkedIn Marketing API is notoriously painful to work with: monthly Rosetta versioning, undocumented field mappings, Rest.li-style nested query params for analytics, and 60-day access tokens that silently expire. This server handles all of that under the hood so you can ask questions in plain English instead of hand-writing `dateRange=(start:(year:...))`.

No other open-source MCP server for LinkedIn Ads ships this depth. Most stop at "list campaigns." This one includes demographics, video completion funnel, budget pacing, period comparisons, and Lead Gen Form responses with PII so you can reconcile leads against Marketo or Salesforce.

---

## Example prompts

Once installed, ask Claude things like:

- *"What's our LinkedIn Ads spend trend the last 28 days, broken down by campaign group?"*
- *"Compare CPL on the competitor-conquest campaigns this month vs. last — which creatives moved the number?"*
- *"Pull demographics for our top-spending campaign — what seniority and industry are converting?"*
- *"Which Lead Gen Forms had the highest submit rate last month, and what did each cost per lead?"*
- *"Show the video completion funnel for our awareness campaign — where are people dropping off?"*
- *"Are any campaigns at risk of overspending? Show budget pacing across all active ones."*
- *"Pull yesterday's Lead Gen Form responses so I can spot-check them against Marketo."*

---

## Demo

> 🎥 *Walkthrough video coming soon — querying LinkedIn campaign performance from Claude Code in under 60 seconds.*

---

## Tools

| Tool | What it does |
|---|---|
| `li_list_ad_accounts` | All ad accounts the user can access, with status + currency. |
| `li_get_account` | Single account detail: currency, status, type, billing info. |
| `li_list_campaigns` | Campaigns in an account; filter by status or campaign group. |
| `li_get_campaign` | Full campaign detail: targeting criteria, bid, budget, objective. |
| `li_list_campaign_groups` | Campaign groups (shared budget/objective containers). |
| `li_list_creatives` | Ad creatives; filter by campaign or status. |
| `li_get_creative` | Full creative detail: headline, copy, URL, image/video URNs. |
| `li_get_campaign_performance` | Impressions/clicks/spend/conversions/leads over a date range. DAILY/MONTHLY/YEARLY/ALL granularity. |
| `li_get_demographics_report` | Performance by company / company size / industry / job function / job title / seniority / region / country. |
| `li_compare_periods` | WoW/MoM/YoY with per-entity _current/_prior/_delta/_pct_change columns computed server-side. |
| `li_get_video_analytics` | Video completion funnel per creative: starts → 25% → 50% → 75% → completions + completion rate. |
| `li_get_budget_pacing` | Spend vs. budget utilization % for active campaigns over a configurable period. |
| `li_get_conversion_events` | Insight Tag conversion event definitions: type, attribution windows, enabled status. |
| `li_get_conversion_performance` | Performance by conversion event (CONVERSION pivot): post-click vs. view-through breakdown. |
| `li_get_audience_insights` | DMP segments: matched audiences, company lists, combined/lookalike segments + sizes. |
| `li_search_targeting_facets` | Typeahead search for targeting values (job titles, skills, companies, industries, locations, seniorities). |
| `li_get_leadgen_forms` | Lead Gen Forms + question config + state. |
| `li_get_leadgen_responses` | Actual form submissions with PII (name, email, company, job title). |
| `li_get_leadgen_form_performance` | LGF metrics per creative: form open rate, submit rate, cost per lead. |

---

## Setup

### 1. Install

```bash
npm install -g linkedin-campaign-manager-mcp
```

Or clone + build locally:

```bash
git clone https://github.com/ZLeventer/linkedin-campaign-manager-mcp
cd linkedin-campaign-manager-mcp
npm install
npm run build
```

### 2. Create a LinkedIn Developer App

The Marketing API is gated. You need a LinkedIn Developer App with specific product approvals:

1. Go to [developer.linkedin.com](https://developer.linkedin.com) → **Create App** (associate with your company page).
2. **Products tab** — request access to:
   - `Marketing Developer Platform` (covers `r_ads`, `r_ads_reporting`)
   - `Lead Gen Forms` or `Community Management API` (covers `r_ads_leadgen_automation`)
3. LinkedIn reviews app access manually — typically 2–6 weeks.
4. **Auth tab** → **Authorized Redirect URLs** — add: `http://127.0.0.1:53123`
   (change `53123` if you set a different `LINKEDIN_OAUTH_PORT`).
5. Copy **Client ID** and **Client Secret** from the Auth tab.

> Without product approval every API call returns 403. The server compiles and starts cleanly — the 403 is an app-level permission issue, not a code issue.

### 3. Configure environment

```bash
cp .env.example .env
# edit .env with your LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
# LINKEDIN_DEFAULT_AD_ACCOUNT (numeric ID from Campaign Manager URL)
```

### 4. Authorize (one-time OAuth flow)

```bash
npm run auth
```

This opens a local HTTP server on port 53123 (or `LINKEDIN_OAUTH_PORT`), prints an auth URL to your terminal, and waits for the OAuth callback. After you approve in the browser, it exchanges the code for an access token + 365-day refresh token and saves them to `token.json` (mode 0600).

You only need to re-run `npm run auth` if the refresh token expires (after 365 days).

### 5. Wire into Claude Code (or any MCP client)

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "linkedin-campaign-manager-mcp",
      "env": {
        "LINKEDIN_CLIENT_ID": "your_client_id",
        "LINKEDIN_CLIENT_SECRET": "your_client_secret",
        "LINKEDIN_TOKEN_PATH": "/absolute/path/to/token.json",
        "LINKEDIN_DEFAULT_AD_ACCOUNT": "123456789",
        "LINKEDIN_API_VERSION": "202504"
      }
    }
  }
}
```

Or if running from source:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/path/to/linkedin-campaign-manager-mcp/dist/index.js"],
      "env": {
        "LINKEDIN_CLIENT_ID": "...",
        "LINKEDIN_CLIENT_SECRET": "...",
        "LINKEDIN_TOKEN_PATH": "/path/to/token.json",
        "LINKEDIN_DEFAULT_AD_ACCOUNT": "123456789"
      }
    }
  }
}
```

Restart Claude Code. The 19 tools appear under the `linkedin` server.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LINKEDIN_CLIENT_ID` | Yes | — | OAuth app client ID |
| `LINKEDIN_CLIENT_SECRET` | Yes | — | OAuth app client secret |
| `LINKEDIN_TOKEN_PATH` | No | `./token.json` | Path to read/write the token file |
| `LINKEDIN_DEFAULT_AD_ACCOUNT` | Recommended | — | Numeric account ID; tools fall back to this when `ad_account_id` is not passed |
| `LINKEDIN_OAUTH_PORT` | No | `53123` | Loopback port for OAuth redirect |
| `LINKEDIN_API_VERSION` | No | `202504` | LinkedIn Rosetta API version (YYYYMM) |

---

## URN handling

LinkedIn resources are identified by URNs: `urn:li:sponsoredAccount:123`, `urn:li:sponsoredCampaign:456`, etc.

All tool inputs accept either the bare numeric ID or the full URN — the client wraps bare IDs automatically. Numeric IDs appear in Campaign Manager URLs (`/accounts/<id>/`, `/campaigns/<id>/`).

---

## Date inputs

All date parameters accept:

| Input | Meaning |
|---|---|
| `2024-10-01` | Literal ISO date |
| `today` / `yesterday` | Self-explanatory |
| `7daysAgo`, `28daysAgo`, `90daysAgo` | N calendar days before today |

Default range: `28daysAgo` → `yesterday`.

---

## LinkedIn-specific gotchas

### API version churn

LinkedIn Rosetta uses monthly versions (`202504` = April 2025). Versions deprecate ~12 months after release — you'll get `410 Gone` errors when that happens. Bump `LINKEDIN_API_VERSION` quarterly. See the [versioning docs](https://learn.microsoft.com/en-us/linkedin/marketing/versioning).

### Analytics query shape

`/adAnalytics` uses Rest.li-style nested params, **not** plain ISO strings:

```
dateRange=(start:(year:2024,month:10,day:1),end:(year:2024,month:10,day:31))
campaigns=List(urn:li:sponsoredCampaign:123,urn:li:sponsoredCampaign:456)
```

This is handled internally by `dateRangeParam()` and `liGetRaw()`. If you extend the server, route analytics calls through `liGetRaw()` with a manually-built URL — do not use `liGet()` for analytics endpoints as `URLSearchParams` will mangle the nested parens.

### Analytics data lag

LinkedIn analytics typically lag 2–6 hours for most metrics, and up to 24 hours for conversion data. Yesterday's numbers are usually complete; today's are partial.

### 60-day access tokens, 365-day refresh tokens

Access tokens expire in 60 days; refresh tokens in 365 days. The client auto-refreshes the access token on every request when needed. If the refresh token expires, run `npm run auth` again.

### Lead Gen response PII

`li_get_leadgen_responses` returns actual lead PII — name, email, company, job title. Treat output as sensitive: do not write to shared logs, unencrypted storage, or public channels. LinkedIn's data-use policy requires deleting lead responses within 90 days of receipt unless the lead is actively consented. This tool is intended for authorized CRM reconciliation (Marketo/SFDC).

### Rate limits

LinkedIn does not publish hard rate-limit numbers. In practice, expect throttling around 100 analytics calls/minute per app. No retry-on-429 is built in — if you hit limits, reduce call frequency or cache results client-side.

---

## When NOT to use this server

- **Creating or editing campaigns, budgets, or creatives** — read-only by design. Campaign creation has too many failure modes to automate safely; use the Campaign Manager UI.
- **Real-time impression data** — use the LinkedIn Insight Tag + GA4 for near-realtime.
- **Audience size estimation for arbitrary targeting criteria** — use the Campaign Manager audience builder UI for ad-hoc sizing. `li_get_audience_insights` only returns sizes of saved/uploaded segments.

---

## License

MIT © 2026 [Zach Leventer](https://github.com/ZLeventer)
