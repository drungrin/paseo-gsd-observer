import chokidar from "chokidar";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readAllowedInventory, type AllowedInventory } from "./server/allowed-reader.js";
import { buildBoardSnapshot } from "./server/board-snapshot.js";
import { createSnapshotObserver, type SnapshotBuilder, type SnapshotObserver, type SnapshotWatcher, type WatcherOptions } from "./server/snapshot-observer.js";
import { resolveWorkspaceRoot } from "./server/workspace-root.js";
import { createUsageIndex, type UsageIndex } from "./server/usage-index.js";
import { BoardSnapshotSchema, boardRpc, type BoardRequest, type BoardResponse, type BoardSnapshot } from "./shared/board-rpc.js";
import { ledgerRpc, usageRpc, type BoardUsage, type LedgerPage } from "./shared/usage.js";

const MAX_OBSERVATIONS = 8;
const INACTIVE_TTL_MS = 60_000;
// Host session logs can be large; a request reads for at most this long and reports whether it finished.
const USAGE_BUDGET_MS = 6_000;
type Observation = { workspaceId: string; root: string; observer: SnapshotObserver; lastUsed: number };
export type UsageRequest = { workspaceId: string };
export type LedgerRequest = { workspaceId: string; offset: number; limit: number; anchor?: number };
export type BoardService = {
  handle(input: BoardRequest, paseo?: unknown): Promise<BoardResponse>;
  usage(input: UsageRequest, paseo?: unknown): Promise<BoardUsage>;
  ledger(input: LedgerRequest, paseo?: unknown): Promise<LedgerPage>;
  close(): Promise<void>;
};
export type BoardServiceOptions = {
  resolveWorkspace: (workspaceId: string, paseo?: unknown) => Promise<string | null>;
  readInventory?: (directory: string) => Promise<AllowedInventory>;
  buildSnapshot?: SnapshotBuilder;
  watcherFactory?: (paths: readonly string[], options: WatcherOptions) => SnapshotWatcher;
  clock?: () => Date;
  usageIndex?: UsageIndex;
};
const emptySnapshot = (workspaceId: string, warning: BoardSnapshot["warnings"][number] = "absent"): BoardSnapshot => ({ workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: [warning], limited: false });

export function createBoardService({ resolveWorkspace, readInventory = (directory) => readAllowedInventory(directory), buildSnapshot = buildBoardSnapshot, watcherFactory = (paths, options) => chokidar.watch([...paths], options) as unknown as SnapshotWatcher, clock = () => new Date(), usageIndex = createUsageIndex() }: BoardServiceOptions): BoardService {
  const observations = new Map<string, Observation>();
  const ids = new Map<string, string>();
  let closed = false;
  const now = () => clock().getTime();
  const remove = async (entry: Observation) => { observations.delete(entry.root); if (ids.get(entry.workspaceId) === entry.root) ids.delete(entry.workspaceId); await entry.observer.close(); };
  const prune = async () => {
    for (const entry of [...observations.values()]) if (now() - entry.lastUsed > INACTIVE_TTL_MS) await remove(entry);
    while (observations.size > MAX_OBSERVATIONS) await remove([...observations.values()].sort((left, right) => left.lastUsed - right.lastUsed)[0]);
  };
  const maintenance = setInterval(() => { void prune(); }, INACTIVE_TTL_MS);
  maintenance.unref?.();
  const find = (workspaceId: string) => { const root = ids.get(workspaceId); return root ? observations.get(root) : undefined; };
  const create = (workspaceId: string, root: string, planningRoot: string) => {
    const entry: Observation = { workspaceId, root, observer: createSnapshotObserver({ workspaceId, root, planningRoot, initialSnapshot: emptySnapshot(workspaceId), readInventory, buildSnapshot, watcherFactory, clock }), lastUsed: now() };
    observations.set(root, entry); ids.set(workspaceId, root); return entry;
  };
  const resolvedEntry = async (workspaceId: string, paseo?: unknown) => {
    const directory = await resolveWorkspace(workspaceId, paseo).catch(() => null);
    if (!directory || closed) return undefined;
    const resolved = await resolveWorkspaceRoot(directory);
    if (!resolved.available) return { unavailable: emptySnapshot(workspaceId, resolved.warning) };
    const prior = find(workspaceId);
    if (prior && prior.root !== resolved.root) await remove(prior);
    const entry = observations.get(resolved.root) ?? create(workspaceId, resolved.root, resolved.planningRoot);
    entry.workspaceId = workspaceId; entry.lastUsed = now(); ids.set(workspaceId, resolved.root); await prune();
    return { entry };
  };
  /**
   * The workspace's roots for host usage, and how its roadmap splits it: the observed snapshot's ship dates and current milestone.
   * Sessions record the directory they ran in, which may be the textual path rather than its real path.
   */
  const usageQuery = async (workspaceId: string, paseo: unknown) => {
    const directory = await resolveWorkspace(workspaceId, paseo).catch(() => null);
    if (!directory || closed) return null;
    const resolved = await resolveWorkspaceRoot(directory);
    // Usage belongs to GSD Path workspaces; any other folder (a home directory) would match unrelated sessions.
    if (!resolved.available || resolved.flavor !== "gsd-path") return null;
    const roots = [...new Set([directory.replace(/[\\/]+$/, ""), resolved.root])];
    const path = find(workspaceId)?.observer.snapshot().path;
    const milestones = path?.roadmap.milestones ?? [];
    const shipped = milestones.flatMap((milestone) => milestone.shipped ? [[milestone.shipped, milestone.id] as const] : []);
    const current = milestones.find((milestone) => milestone.current)?.id ?? /M\d{3,}/.exec(path?.state.branch ?? "")?.[0] ?? null;
    return { workspaceId, roots, shipped, current, budgetMs: USAGE_BUDGET_MS };
  };
  const noUsage = (workspaceId: string): BoardUsage => ({ workspaceId, observedAt: clock().toISOString(), availability: "unavailable", complete: true, limited: false, pricing: "missing", sessions: 0,
    totals: { turns: 0, prompts: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, cost: null, pricedTurns: 0, durationS: 0, timedTurns: 0 }, models: [], milestones: [], unpriced: [], tasks: [], activity: [], activityLimited: false });
  return {
    async usage(input, paseo) {
      const query = await usageQuery(input.workspaceId, paseo);
      return query ? usageIndex.usage(query).catch(() => noUsage(input.workspaceId)) : noUsage(input.workspaceId);
    },
    async ledger(input, paseo) {
      const query = await usageQuery(input.workspaceId, paseo);
      const empty: LedgerPage = { workspaceId: input.workspaceId, availability: "unavailable", complete: true, total: 0, offset: input.offset, records: [] };
      return query ? usageIndex.ledger({ ...query, offset: input.offset, limit: input.limit, anchor: input.anchor ?? null }).catch(() => empty) : empty;
    },
    async handle(input, paseo) {
      if (input.intent === "status") {
        const entry = find(input.workspaceId);
        if (!entry) return { kind: "status", workspaceId: input.workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: ["absent"] };
        entry.lastUsed = now(); return entry.observer.status();
      }
      const known = find(input.workspaceId);
      if (input.intent === "snapshot" && known) {
        known.lastUsed = now();
        return { kind: "snapshot", snapshot: known.observer.snapshot() };
      }
      const resolved = await resolvedEntry(input.workspaceId, paseo);
      if (!resolved || "unavailable" in resolved) return { kind: "snapshot", snapshot: resolved?.unavailable ?? emptySnapshot(input.workspaceId, "unreadable") };
      const snapshot = await resolved.entry.observer.refresh();
      const current = await resolvedEntry(input.workspaceId, paseo);
      if (!current || "unavailable" in current) return { kind: "snapshot", snapshot: current?.unavailable ?? emptySnapshot(input.workspaceId, "unreadable") };
      return { kind: "snapshot", snapshot: current.entry === resolved.entry ? snapshot : await current.entry.observer.refresh() };
    },
    async close() { if (closed) return; closed = true; clearInterval(maintenance); await Promise.all([...observations.values()].map((entry) => entry.observer.close())); observations.clear(); ids.clear(); },
  };
}

export default function contribute(server: PluginServerContext) {
  const service = createBoardService({ async resolveWorkspace(workspaceId, paseo) { const host = paseo as { workspaces?: { ref(id: string): { refresh(): Promise<{ id?: string; workspaceDirectory?: string | null } | null> } } }; const record = await host.workspaces?.ref(workspaceId).refresh(); return record?.id === workspaceId && typeof record.workspaceDirectory === "string" ? record.workspaceDirectory : null; } });
  server.handle(boardRpc, (input, context) => service.handle(input, context.paseo));
  server.handle(usageRpc, (input, context) => service.usage(input, context.paseo));
  server.handle(ledgerRpc, (input, context) => service.ledger(input, context.paseo));
  return () => { void service.close(); };
}
