# GitHub Feedback — Bugs Found During Local Testing

Issues discovered while running the server against a live LinkedIn ad account (account ID 502746652, API version 202601).

---

## Bug 1: Status filter returns 400 on `li_list_campaigns`, `li_list_campaign_groups`, `li_list_ad_accounts`

**Affected tools:** `li_list_campaigns`, `li_list_campaign_groups`, `li_list_ad_accounts`

**Symptom:**
Calling any of these tools with a `status` filter returns a LinkedIn 400 error:
```
LinkedIn GET https://api.linkedin.com/rest/adAccounts/.../adCampaigns?q=search&pageSize=50&search=%28status%3A%28values%3AList%28ACTIVE%29%29%29 → 400:
{"errorDetailType":"com.linkedin.common.error.BadRequest","message":"Invalid param. Please see errorDetails for more information.","errorDetails":{"inputErrors":[{"description":"Invalid value for param; wrong type or other syntax error","input":{"inputPath":{"fieldPath":"search"}},"code":"PARAM_INVALID"}]}}
```

**Root cause:**
`liGet` builds the URL using `URLSearchParams.set`, which percent-encodes special characters: `(` → `%28`, `)` → `%29`, `:` → `%3A`. LinkedIn's Rest.li query language treats `(`, `)`, and `:` as **structural syntax characters** in the `search` parameter value. When they arrive percent-encoded, LinkedIn's parser rejects the value as invalid.

The analytics tools (`getCampaignPerformance`, etc.) already work around this correctly by using `liGetRaw` to construct raw URLs without encoding those characters.

**Fix:**
When a `search` filter is present, bypass `liGet` and use `liGetRaw` with a manually constructed URL, leaving the Rest.li syntax characters unencoded. Plain scalar params (`q`, `pageSize`) are safe to include as-is since they contain no special characters.

**Files changed:**
- `src/tools/accounts.ts` — `listAdAccounts`
- `src/tools/campaigns.ts` — `listCampaigns`, `listCampaignGroups`

**Pattern (same fix applied to all three):**
```typescript
// Before (broken):
params["search"] = `(status:(values:List(${args.status})))`;
return liGet("/adAccounts", params);  // URLSearchParams percent-encodes the value → 400

// After (fixed):
const search = `(status:(values:List(${args.status})))`;
const url = `${BASE_URL}/adAccounts?q=search&pageSize=${args.page_size ?? 50}&search=${search}`;
return liGetRaw(url);  // structural chars pass through unencoded → 200
```

**Recommendation for the repo:**
Either update the three affected functions as above, or add a `liGetWithRawParam` helper to `client.ts` that accepts a map of pre-encoded params alongside normal params, so the pattern is reusable without duplicating URL construction logic.

---

*Discovered: 2026-04-27 | Tested against LinkedIn Marketing API version 202601*
