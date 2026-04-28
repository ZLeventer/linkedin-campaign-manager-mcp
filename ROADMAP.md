# LinkedIn Campaign Manager MCP — Roadmap

**Audience:** Marketing Ops leader review
**Framing:** Two value lanes — (1) things the LinkedIn UI literally can't do, (2) things it can do but painfully slowly. Read-only only in this phase; write tools deferred.
**Current state:** 12 read-only tools (accounts, analytics, audiences, campaigns, compare, conversions, forecast, leadgen, organic, reach, targeting, authstatus). Data transport validated. This roadmap is what comes next.

---

## Why this MCP matters (the elevator pitch)

The LinkedIn UI is built around **one campaign at a time**. Every meaningful MarOps question is **cross-campaign, cross-system, or cross-time** — and the UI either makes you do it manually with CSV exports, or doesn't let you do it at all. The MCP turns those into one prompt.

The leader's question — "what can this do that the UI can't?" — has three honest answers:

1. **Joins.** UI ends at form fill. We can join LI campaigns to Marketo MQL/SQL and SFDC pipeline to show revenue per campaign.
2. **Cross-campaign math.** Audience overlap, creative fatigue, frequency capping across the whole account — UI shows you one campaign in isolation.
3. **Time travel.** Snapshot + diff. UI gives you a live view; we give you "what changed this week and why performance moved."

---

## Easy wins (Tier 1 — ship in days, all UI-slow → instant)

These reuse existing endpoints. No new auth, no new system integrations. They turn 30-min CSV-and-pivot-table tasks into single prompts.

| # | Tool | What it does | UI pain it kills |
|---|------|--------------|------------------|
| 1 | `li_account_health_snapshot` | One-shot dashboard: spend pacing vs. budget, win-rate, top/bottom 5 campaigns, alerts (campaigns >80% budget, CPL spike >2σ, zero-delivery) | UI requires opening 5+ tabs and eyeballing |
| 2 | `li_naming_convention_audit` | Flags campaigns/groups violating a configurable naming standard (regex), missing UTMs, missing conversion tracking | Manual scroll through the campaign list |
| 3 | `li_creative_inventory` | Every creative across the account with: status, impressions, CTR, days live, fatigue score (CTR decay vs. first 7 days) | UI is per-campaign, no fatigue calc |
| 4 | `li_demographic_rollup` | Pull demographic reports across N campaigns and roll up into one view (job title, seniority, function, industry, company size) — weighted by spend | UI demographics are per-campaign, no aggregation |
| 5 | `li_underperformer_finder` | Lists ad groups under your CPL/CTR threshold for >X days with recommended action (pause, refresh creative, expand audience) | UI has no thresholding or suggestion logic |
| 6 | `li_change_log_diff` | "What changed in the account in the last 7/14/30 days" — campaigns paused, budgets shifted, audiences edited, creatives swapped | UI changelog exists but is unfilterable noise |

**Demo line for the leader:** *"Show me everything that's underperforming and what changed last week"* — one prompt, 10 seconds.

---

## Mid-tier (Tier 2 — ship in 1–2 weeks, mostly UI-impossible)

Cross-campaign analysis the UI fundamentally can't do because it doesn't think in account-wide terms.

| # | Tool | What it does | Why UI can't |
|---|------|--------------|--------------|
| 7 | `li_audience_overlap_matrix` | NxN matrix of campaign audiences showing % member overlap; flags campaigns competing for the same people | UI has no overlap calc; you'd have to export each audience and run set math |
| 8 | `li_cross_campaign_frequency` | How many users are hit by 2+, 3+, 5+ active campaigns simultaneously (the "shouting at the same person" problem) | UI shows frequency per campaign only |
| 9 | `li_creative_dna_analysis` | Clusters creatives by theme/format/hook and reports which themes win across the whole account, not per-campaign | UI has no creative tagging or aggregation |
| 10 | `li_targeting_drift_detector` | Compares this week's targeting criteria across campaigns to last week's snapshot — flags accidental edits, audience expansion creep | UI has no targeting history view |
| 11 | `li_account_penetration_report` | For each Demandbase TAL tier: % reached, % engaged, top accounts hit, top accounts missed | UI has no concept of TAL or tiering |
| 12 | `li_pacing_forecast` | Linear + 7-day-trend projection of spend through end of month/quarter; flags overspend/underspend per campaign | UI shows current pacing only, no forward projection |

**Demo line:** *"Which campaigns are competing for the same audience, and which TAL tier-1 accounts haven't been hit yet?"* — answers in one prompt that would be a full afternoon of work otherwise.

---

## High-value (Tier 3 — ship in 3–4 weeks, the headline wins)

These require joining LinkedIn data to Marketo, SFDC, or Demandbase via the other MCPs already in the stack. **This is where the leader's eyes should light up** — it's the closed-loop attribution every B2B MarOps leader wants but rarely gets.

| # | Tool | What it does | Stack |
|---|------|--------------|-------|
| 13 | `li_lead_quality_by_campaign` | Joins LI form leads → Marketo lead score → MQL rate → SFDC SQL/Opp/Closed-Won. Shows true lead quality and pipeline $ per campaign, not just CPL | LI MCP × Marketo MCP × SFDC MCP |
| 14 | `li_pipeline_attribution_report` | Revenue and pipeline $ sourced/influenced by each LI campaign using SFDC Campaign Influence (since Bizible isn't configured) | LI MCP × SFDC MCP |
| 15 | `li_intent_to_engagement_funnel` | Joins Demandbase intent surge → LI campaign exposure → form fill → MQL — shows whether intent-targeted accounts actually convert better | LI MCP × Demandbase MCP × Marketo MCP |
| 16 | `li_lead_dedup_and_routing_check` | For LI form leads: are they already in SFDC? Already MQL? Routed to right owner? Catches leaks in the LI→Marketo→SFDC handoff | LI MCP × Marketo MCP × SFDC MCP |
| 17 | `li_creative_to_revenue` | Which specific creatives drove leads that became Closed-Won? Closes the loop from headline → revenue | LI MCP × Marketo MCP × SFDC MCP |
| 18 | `li_competitor_conquest_efficacy` | For campaigns targeting competitor audiences (SAP, Blue Yonder, etc.), measures lead quality and pipeline yield vs. non-conquest campaigns | LI MCP × SFDC MCP |

**Demo line:** *"Show me pipeline dollars per LinkedIn campaign and which creatives produced the highest-quality leads"* — this is the answer Scott (Head of Marketing) actually wants, and no LinkedIn-only tool can give it.

---

## Suggested sequencing

1. **Week 1:** Ship Tier 1 #1, #3, #5 (the three with strongest live-demo punch).
2. **Week 2:** Tier 1 #2, #4, #6 + Tier 2 #7 (audience overlap is the showcase Tier-2 win).
3. **Week 3:** Tier 2 #11 + #12 (TAL penetration + pacing forecast — these speak directly to a MarOps leader).
4. **Week 4:** Tier 3 #13 + #14 (lead quality + pipeline attribution). These are the headline.
5. **Later:** Remaining Tier 2/3, then write tools (pause/budget/launch).

## Live-demo script (10 minutes)

1. *"Run the account health snapshot"* → Tier 1 #1
2. *"Find me underperforming ad groups and tell me what changed last week"* → #5 + #6
3. *"Show me audience overlap across campaigns"* → #7 (the "UI can't do this" moment)
4. *"What % of our TAL tier-1 accounts have we reached this quarter?"* → #11
5. *"Pipeline dollars by LinkedIn campaign"* → #13 or #14 (the closer)

## Build decisions (locked 2026-04-28)

- **Snapshotting:** Approved. Mirror the GTM nightly-snapshot pattern — write JSON snapshots into a tracked dir under this repo. Tier 1 #6 (change-log diff) and Tier 2 #10 (targeting drift) read from those snapshots.
- **Tier 3 #15 (Demandbase intent funnel):** Parked. Demandbase MCP isn't built yet.
- **Tier 2 #11 (TAL penetration):** Will use a static TAL list in the repo until the Demandbase MCP exists.
- **Cost surface:** Tier 3 tools can be heavy (multi-system joins). Cache per session.
