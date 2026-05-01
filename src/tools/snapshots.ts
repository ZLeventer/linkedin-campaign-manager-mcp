import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liGet, resolveAdAccount, unwrapURN } from "../client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "../../snapshots");

interface SlimCampaign {
  id: string;
  name: string;
  status: string | undefined;
  objective_type: string | undefined;
  campaign_group: unknown;
  total_budget: unknown;
  daily_budget: unknown;
  unit_cost: unknown;
  targeting_criteria: unknown;
  run_schedule: unknown;
}

interface SlimGroup {
  id: string;
  name: string;
  status: string | undefined;
  total_budget: unknown;
  run_schedule: unknown;
}

interface SlimCreative {
  id: string;
  status: string | undefined;
  campaign: unknown;
  content_type: string | null;
  last_modified_at: unknown;
}

interface Snapshot {
  snapshot_version: 1;
  ad_account_id: string;
  captured_at: string;
  campaigns: SlimCampaign[];
  campaign_groups: SlimGroup[];
  creatives: SlimCreative[];
}

async function ensureSnapshotDir(): Promise<void> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
}

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

async function listSnapshotsFor(accountId: string): Promise<string[]> {
  await ensureSnapshotDir();
  const files = await fs.readdir(SNAPSHOT_DIR);
  return files.filter((f) => f.startsWith(`${accountId}-`) && f.endsWith(".json")).sort();
}

async function buildSnapshot(accountId: string): Promise<Snapshot> {
  const [campaigns, groups, creatives] = await Promise.all([
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/adCampaigns`,
      { q: "search", pageSize: 100 },
    ),
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/adCampaignGroups`,
      { q: "search", pageSize: 100 },
    ),
    liGet<{ elements?: Record<string, unknown>[] }>(
      `/adAccounts/${accountId}/creatives`,
      { q: "criteria", count: 100 },
    ),
  ]);

  const slimCampaigns: SlimCampaign[] = (campaigns.elements ?? []).map((c) => ({
    id: String(c["id"] ?? ""),
    name: String(c["name"] ?? ""),
    status: c["status"] as string | undefined,
    objective_type: c["objectiveType"] as string | undefined,
    campaign_group: c["campaignGroup"] ?? null,
    total_budget: c["totalBudget"] ?? null,
    daily_budget: c["dailyBudget"] ?? null,
    unit_cost: c["unitCost"] ?? null,
    targeting_criteria: c["targetingCriteria"] ?? null,
    run_schedule: c["runSchedule"] ?? null,
  }));
  const slimGroups: SlimGroup[] = (groups.elements ?? []).map((g) => ({
    id: String(g["id"] ?? ""),
    name: String(g["name"] ?? ""),
    status: g["status"] as string | undefined,
    total_budget: g["totalBudget"] ?? null,
    run_schedule: g["runSchedule"] ?? null,
  }));
  const slimCreatives: SlimCreative[] = (creatives.elements ?? []).map((cr) => {
    const content = cr["content"] as Record<string, unknown> | undefined;
    return {
      id: String(cr["id"] ?? ""),
      status: cr["intendedStatus"] as string | undefined,
      campaign: cr["campaign"] ?? null,
      content_type: content ? Object.keys(content)[0] ?? null : null,
      last_modified_at: cr["lastModifiedAt"] ?? null,
    };
  });

  return {
    snapshot_version: 1,
    ad_account_id: accountId,
    captured_at: new Date().toISOString(),
    campaigns: slimCampaigns,
    campaign_groups: slimGroups,
    creatives: slimCreatives,
  };
}

export const saveAccountSnapshotSchema = {
  ad_account_id: z.string().optional(),
};

export async function saveAccountSnapshot(args: { ad_account_id?: string }): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  await ensureSnapshotDir();
  const snap = await buildSnapshot(accountId);
  const filename = `${accountId}-${timestampSlug()}.json`;
  const fullpath = path.join(SNAPSHOT_DIR, filename);
  await fs.writeFile(fullpath, JSON.stringify(snap, null, 2), "utf8");
  return {
    path: fullpath,
    filename,
    ad_account_id: accountId,
    captured_at: snap.captured_at,
    counts: {
      campaigns: snap.campaigns.length,
      campaign_groups: snap.campaign_groups.length,
      creatives: snap.creatives.length,
    },
  };
}

interface IdNamed { id: string; name?: string }

function indexById<T extends IdNamed>(arr: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of arr) m.set(item.id, item);
  return m;
}

function diffField(a: unknown, b: unknown): { from: unknown; to: unknown } | null {
  return JSON.stringify(a) === JSON.stringify(b) ? null : { from: a, to: b };
}

interface DiffResult {
  entity: string;
  added: { id: string; name: string | null }[];
  removed: { id: string; name: string | null }[];
  changed: { id: string; name: string | null; changes: Record<string, { from: unknown; to: unknown }> }[];
}

function diffCollection<T extends Record<string, unknown> & { id: string; name?: string }>(
  prev: T[],
  curr: T[],
  fieldsToCompare: (keyof T & string)[],
  label: string,
): DiffResult {
  const pIdx = indexById(prev);
  const cIdx = indexById(curr);
  const added: DiffResult["added"] = [];
  const removed: DiffResult["removed"] = [];
  const changed: DiffResult["changed"] = [];

  for (const [id, c] of cIdx) {
    const p = pIdx.get(id);
    if (!p) {
      added.push({ id, name: c.name ?? null });
      continue;
    }
    const fieldChanges: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fieldsToCompare) {
      const d = diffField(p[f], c[f]);
      if (d) fieldChanges[f] = d;
    }
    if (Object.keys(fieldChanges).length > 0) {
      changed.push({ id, name: c.name ?? null, changes: fieldChanges });
    }
  }
  for (const [id, p] of pIdx) {
    if (!cIdx.has(id)) {
      removed.push({ id, name: p.name ?? null });
    }
  }
  return { entity: label, added, removed, changed };
}

export const accountSnapshotDiffSchema = {
  ad_account_id: z.string().optional(),
  snapshot_a: z
    .string()
    .optional()
    .describe("Filename of older snapshot (within snapshots/). Defaults to second-most-recent."),
  snapshot_b: z
    .string()
    .optional()
    .describe("Filename of newer snapshot. Defaults to most recent saved snapshot."),
  take_live_snapshot: z
    .boolean()
    .default(false)
    .describe("If true, captures current state as snapshot_b instead of reading from disk."),
};

export async function accountSnapshotDiff(args: {
  ad_account_id?: string;
  snapshot_a?: string;
  snapshot_b?: string;
  take_live_snapshot?: boolean;
}): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const files = await listSnapshotsFor(accountId);

  if (files.length === 0 && !args.take_live_snapshot) {
    return {
      error: "No snapshots found for this account. Run li_save_account_snapshot first.",
      snapshot_dir: SNAPSHOT_DIR,
    };
  }

  let aFile = args.snapshot_a;
  let bFile = args.snapshot_b;
  if (!bFile && !args.take_live_snapshot) bFile = files[files.length - 1];
  if (!aFile) {
    aFile = files.length >= 2 ? files[files.length - 2] : files[0];
  }

  if (!aFile) {
    return { error: "Could not resolve snapshot_a filename." };
  }

  const prev = JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, aFile), "utf8")) as Snapshot;
  const curr = args.take_live_snapshot
    ? await buildSnapshot(accountId)
    : (JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, bFile!), "utf8")) as Snapshot);

  const campaignDiff = diffCollection(
    prev.campaigns as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    curr.campaigns as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    ["status", "campaign_group", "total_budget", "daily_budget", "unit_cost", "targeting_criteria", "run_schedule", "objective_type", "name"],
    "campaign",
  );
  const groupDiff = diffCollection(
    prev.campaign_groups as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    curr.campaign_groups as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    ["status", "total_budget", "run_schedule", "name"],
    "campaign_group",
  );
  const creativeDiff = diffCollection(
    prev.creatives as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    curr.creatives as unknown as (Record<string, unknown> & { id: string; name?: string })[],
    ["status", "campaign", "content_type"],
    "creative",
  );

  return {
    ad_account_id: accountId,
    snapshot_a: { source: aFile, captured_at: prev.captured_at },
    snapshot_b: args.take_live_snapshot
      ? { source: "live", captured_at: curr.captured_at }
      : { source: bFile, captured_at: curr.captured_at },
    summary: {
      campaigns: { added: campaignDiff.added.length, removed: campaignDiff.removed.length, changed: campaignDiff.changed.length },
      campaign_groups: { added: groupDiff.added.length, removed: groupDiff.removed.length, changed: groupDiff.changed.length },
      creatives: { added: creativeDiff.added.length, removed: creativeDiff.removed.length, changed: creativeDiff.changed.length },
    },
    campaigns: campaignDiff,
    campaign_groups: groupDiff,
    creatives: creativeDiff,
  };
}

export const listSnapshotsSchema = {
  ad_account_id: z.string().optional(),
};

export async function listSnapshots(args: { ad_account_id?: string }): Promise<unknown> {
  const account = resolveAdAccount(args.ad_account_id);
  const accountId = unwrapURN(account);
  const files = await listSnapshotsFor(accountId);
  return {
    snapshot_dir: SNAPSHOT_DIR,
    ad_account_id: accountId,
    snapshot_count: files.length,
    files,
  };
}
