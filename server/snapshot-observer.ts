import { relative, resolve, sep } from "node:path";
import { BoardSnapshotSchema, type BoardSnapshot, type BoardStatus } from "../shared/board-rpc.js";
import type { AllowedInventory } from "./allowed-reader.js";

const DEBOUNCE_MS = 150;
const phaseDirectory = /^\d+(?:\.\d+)*-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;
const phaseArtifact = /^(?:(?:\d+(?:\.\d+)*(?:-\d+)?)-)?(?:CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT|REVIEW|REVIEWS)\.md$/i;
const archiveArtifact = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*-ROADMAP\.md$/i;
const archiveDirectory = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*-phases$/;

export type SnapshotBuilder = (input: { workspaceId: string; inventory: AllowedInventory; observedAt: string }) => BoardSnapshot;
export type SnapshotWatcher = { on(event: "add" | "change" | "unlink" | "error", listener: (value?: string | Error) => void): SnapshotWatcher; close(): Promise<void> };
export type WatcherOptions = { followSymlinks: false; ignoreInitial: true; depth: 0; ignored: (path: string) => boolean };
export type SnapshotObserverOptions = {
  workspaceId: string;
  root: string;
  planningRoot: string;
  initialSnapshot: BoardSnapshot;
  readInventory: (directory: string, signal?: AbortSignal) => Promise<AllowedInventory>;
  buildSnapshot: SnapshotBuilder;
  watcherFactory?: (paths: readonly string[], options: WatcherOptions) => SnapshotWatcher;
  clock?: () => Date;
};
export type SnapshotObserver = { invalidate(): void; status(): BoardStatus; snapshot(): BoardSnapshot; refresh(): Promise<BoardSnapshot>; close(): Promise<void> };

const warningList = (warnings: readonly BoardSnapshot["warnings"][number][]) => [...new Set(warnings)].slice(0, 16);
const asStatus = (snapshot: BoardSnapshot): BoardStatus => ({ kind: "status", workspaceId: snapshot.workspaceId, observedAt: snapshot.observedAt, freshness: snapshot.freshness, availability: snapshot.availability, revision: snapshot.revision, warnings: snapshot.warnings });
const refreshFailure = (snapshot: BoardSnapshot, warning: BoardSnapshot["warnings"][number]) => snapshot.observedAt
  ? { ...snapshot, freshness: "refresh-failed" as const, warnings: warningList([...snapshot.warnings, warning]) }
  : { ...snapshot, freshness: "refresh-failed" as const, availability: "unavailable" as const, warnings: [warning] };

function observerPaths(planningRoot: string, inventory: AllowedInventory): string[] {
  const values = new Set<string>([planningRoot]);
  for (const artifact of inventory.artifacts) {
    const segments = artifact.key.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) continue;
    for (let index = 1; index < segments.length; index += 1) values.add(resolve(planningRoot, ...segments.slice(0, index)));
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isIgnored(planningRoot: string, candidate: string): boolean {
  const rel = relative(planningRoot, candidate).split(sep).join("/");
  if (!rel) return false;
  if (rel === ".." || rel.startsWith("../") || resolve(planningRoot, rel) !== resolve(candidate)) return true;
  const parts = rel.split("/");
  if (parts.length === 1) return parts[0] !== "phases" && parts[0] !== "milestones" && !/^(?:ROADMAP|STATE|MILESTONES)\.md$/i.test(parts[0]);
  if (parts[0] === "phases") return !phaseDirectory.test(parts[1] ?? "") || (parts.length > 2 && !phaseArtifact.test(parts[2] ?? ""));
  if (parts[0] !== "milestones") return true;
  if (parts.length === 2) return !archiveArtifact.test(parts[1] ?? "") && !archiveDirectory.test(parts[1] ?? "");
  return !archiveDirectory.test(parts[1] ?? "") || !phaseDirectory.test(parts[2] ?? "") || (parts.length > 3 && !phaseArtifact.test(parts[3] ?? ""));
}

export function createSnapshotObserver(options: SnapshotObserverOptions): SnapshotObserver {
  const clock = options.clock ?? (() => new Date());
  let snapshot = options.initialSnapshot;
  let invalidations = 0;
  let closed = false;
  let watcher: SnapshotWatcher | undefined;
  let refresh: Promise<BoardSnapshot> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const invalidate = () => {
    if (closed) return;
    invalidations += 1;
    snapshot = { ...snapshot, freshness: "stale", revision: snapshot.revision + 1 };
  };
  const delayedInvalidate = () => {
    if (closed || debounce) return;
    invalidate();
    debounce = setTimeout(() => { debounce = undefined; }, DEBOUNCE_MS);
  };
  const stopWatcher = async () => {
    const current = watcher;
    watcher = undefined;
    await current?.close().catch(() => undefined);
  };
  const watcherFailure = () => {
    invalidate();
    snapshot = { ...snapshot, warnings: warningList([...snapshot.warnings, "observation-limited"]) };
    void stopWatcher();
  };
  const installWatcher = (inventory: AllowedInventory) => {
    if (watcher || !options.watcherFactory || !inventory.available || closed) return;
    watcher = options.watcherFactory(observerPaths(options.planningRoot, inventory), { followSymlinks: false, ignoreInitial: true, depth: 0, ignored: (path) => isIgnored(options.planningRoot, path) });
    watcher.on("add", delayedInvalidate).on("change", delayedInvalidate).on("unlink", delayedInvalidate).on("error", watcherFailure);
  };
  return {
    invalidate,
    status: () => asStatus(snapshot),
    snapshot: () => snapshot,
    async refresh() {
      if (refresh) return refresh;
      const startedAt = invalidations;
      refresh = options.readInventory(options.root, abort.signal).then((inventory) => {
        if (closed) return snapshot;
        if (!inventory.available || inventory.warnings.includes("containment-refused")) {
          snapshot = refreshFailure(snapshot, inventory.warnings[0] ?? "unreadable");
          return snapshot;
        }
        const next = options.buildSnapshot({ workspaceId: options.workspaceId, inventory, observedAt: clock().toISOString() });
        const validated = BoardSnapshotSchema.safeParse(next);
        if (!validated.success) {
          snapshot = refreshFailure(snapshot, "unreadable");
          return snapshot;
        }
        snapshot = { ...validated.data, freshness: invalidations === startedAt ? validated.data.freshness : "stale", revision: snapshot.revision + 1 };
        installWatcher(inventory);
        return snapshot;
      }).catch(() => {
        if (!closed) snapshot = refreshFailure(snapshot, "unreadable");
        return snapshot;
      }).finally(() => { refresh = undefined; });
      return refresh;
    },
    async close() {
      if (closed) return;
      closed = true;
      abort.abort();
      if (debounce) clearTimeout(debounce);
      debounce = undefined;
      await stopWatcher();
    },
  };
}
