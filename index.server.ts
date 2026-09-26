import chokidar from "chokidar";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readAllowedInventory, type AllowedInventory } from "./server/allowed-reader.js";
import { buildBoardSnapshot } from "./server/board-snapshot.js";
import { createSnapshotObserver, type SnapshotBuilder, type SnapshotObserver, type SnapshotWatcher, type WatcherOptions } from "./server/snapshot-observer.js";
import { resolveWorkspaceRoot } from "./server/workspace-root.js";
import { BoardSnapshotSchema, boardRpc, type BoardRequest, type BoardResponse, type BoardSnapshot } from "./shared/board-rpc.js";

const MAX_OBSERVATIONS = 8;
const INACTIVE_TTL_MS = 60_000;
type Observation = { workspaceId: string; root: string; observer: SnapshotObserver; lastUsed: number };
export type BoardService = { handle(input: BoardRequest, paseo?: unknown): Promise<BoardResponse>; close(): Promise<void> };
export type BoardServiceOptions = {
  resolveWorkspace: (workspaceId: string, paseo?: unknown) => Promise<string | null>;
  readInventory?: (directory: string) => Promise<AllowedInventory>;
  buildSnapshot?: SnapshotBuilder;
  watcherFactory?: (paths: readonly string[], options: WatcherOptions) => SnapshotWatcher;
  clock?: () => Date;
};
const emptySnapshot = (workspaceId: string, warning: BoardSnapshot["warnings"][number] = "absent"): BoardSnapshot => ({ workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: [warning], limited: false });

export function createBoardService({ resolveWorkspace, readInventory = (directory) => readAllowedInventory(directory), buildSnapshot = buildBoardSnapshot, watcherFactory = (paths, options) => chokidar.watch([...paths], options) as unknown as SnapshotWatcher, clock = () => new Date() }: BoardServiceOptions): BoardService {
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
  return {
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
  return () => { void service.close(); };
}
