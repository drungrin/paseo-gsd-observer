import { relative, resolve, sep } from "node:path";
import { BoardSnapshotSchema, type BoardSnapshot, type BoardStatus } from "../shared/board-rpc.js";
import { DEBUG_DIRECTORIES, isAllowedDebugFile, isAllowedTodoFile, TODO_DIRECTORIES, type AllowedInventory } from "./allowed-reader.js";

const DEBOUNCE_MS = 150;
const phaseDirectory = /^\d+(?:\.\d+)*-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;
const phaseArtifact = /^(?:(?:\d+(?:\.\d+)*(?:-\d+)?)-)?(?:CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT|REVIEW|REVIEWS)\.md$/i;
const optionalPhaseArtifact = /^(?:(\d+(?:\.\d+)*)-)?(?:RESEARCH|SPEC|SKELETON|SECURITY|PATTERNS|UI-SPEC|AI-SPEC|PLAN-CHECK|UI-CHECK|VALIDATION|WINDOWS|deferred-items|UI-REVIEW|EVAL-REVIEW|COVERAGE)\.md$/;
const samePhase = (left: string, right: string) => left.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".") === right.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".");
const currentPhaseArtifact = (directory: string, file: string) => phaseArtifact.test(file) || (() => {
  const match = optionalPhaseArtifact.exec(file);
  return Boolean(match && (!match[1] || samePhase(match[1], directory.split("-")[0])));
})();

export type SnapshotBuilder = (input: { workspaceId: string; inventory: AllowedInventory; observedAt: string }) => BoardSnapshot;
export type SnapshotWatcher = { on(event: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "error" | "ready", listener: (value?: string | Error) => void): SnapshotWatcher; close(): Promise<void> };
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
  for (const directory of inventory.watchDirectories ?? []) {
    const segments = directory.split("/");
    const phase = segments[0] === "phases" && segments.length <= 2 && (segments.length === 1 || phaseDirectory.test(segments[1]));
    const todo = segments[0] === "todos" && (segments.length === 1 || (segments.length === 2 && TODO_DIRECTORIES.some((name) => name === segments[1])));
    const debug = segments[0] === "debug" && (segments.length === 1 || (segments.length === 2 && DEBUG_DIRECTORIES.some((name) => name === segments[1])));
    if (!phase && !todo && !debug) continue;
    values.add(resolve(planningRoot, ...segments));
  }
  for (const artifact of inventory.artifacts) {
    if (artifact.kind === "todo") continue; // TODO directories are watched from validated inventory, including empty ones.
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
  if (parts.length === 1) return parts[0] !== "phases" && parts[0] !== "todos" && parts[0] !== "debug" && !/^(?:ROADMAP|STATE|REQUIREMENTS)\.md$/i.test(parts[0]);
  if (parts[0] === "todos") {
    if (parts.length === 2) return !isAllowedTodoFile(parts[1]) && !TODO_DIRECTORIES.some((name) => name === parts[1]);
    return parts.length !== 3 || !TODO_DIRECTORIES.some((name) => name === parts[1]) || !isAllowedTodoFile(parts[2]);
  }
  if (parts[0] === "debug") {
    if (parts.length === 2) return !isAllowedDebugFile(parts[1]) && !DEBUG_DIRECTORIES.some((name) => name === parts[1]);
    return parts.length !== 3 || !DEBUG_DIRECTORIES.some((name) => name === parts[1]) || !isAllowedDebugFile(parts[2]);
  }
  if (parts[0] === "phases") return !phaseDirectory.test(parts[1] ?? "") || parts.length > 3 || (parts.length > 2 && !currentPhaseArtifact(parts[1], parts[2] ?? ""));
  return true;
}

export function createSnapshotObserver(options: SnapshotObserverOptions): SnapshotObserver {
  const clock = options.clock ?? (() => new Date());
  let snapshot = options.initialSnapshot;
  let invalidations = 0;
  let closed = false;
  let watcher: SnapshotWatcher | undefined;
  let watchedPaths: string[] = [];
  const retiredWatchers: SnapshotWatcher[] = [];
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
    watchedPaths = [];
    await Promise.all([...(current ? [current] : []), ...retiredWatchers.splice(0)].map((owned) => owned.close().catch(() => undefined)));
  };
  const watcherFailure = () => {
    invalidate();
    snapshot = { ...snapshot, warnings: warningList([...snapshot.warnings, "observation-limited"]) };
    void stopWatcher();
  };
  const installWatcher = async (inventory: AllowedInventory) => {
    if (!options.watcherFactory || !inventory.available || closed) return;
    const paths = observerPaths(options.planningRoot, inventory);
    if (watcher && watchedPaths.length === paths.length && watchedPaths.every((path, index) => path === paths[index])) return;
    const previous = watcher;
    const addedPaths = Boolean(previous && paths.some((path) => !watchedPaths.includes(path)));
    const next = options.watcherFactory(paths, { followSymlinks: false, ignoreInitial: true, depth: 0, ignored: (path) => isIgnored(options.planningRoot, path) });
    const onChange = () => { if (watcher === next) delayedInvalidate(); };
    next.on("add", onChange).on("change", onChange).on("unlink", onChange)
      .on("addDir", onChange).on("unlinkDir", onChange)
      .on("ready", () => { if (addedPaths && watcher === next) invalidate(); })
      .on("error", () => { if (watcher === next) watcherFailure(); });
    watcher = next;
    watchedPaths = paths;
    await previous?.close().catch(() => {
      retiredWatchers.push(previous);
      invalidate();
      snapshot = { ...snapshot, warnings: warningList([...snapshot.warnings, "observation-limited"]) };
    });
  };
  return {
    invalidate,
    status: () => asStatus(snapshot),
    snapshot: () => snapshot,
    async refresh() {
      if (refresh) return refresh;
      const startedAt = invalidations;
      refresh = options.readInventory(options.root, abort.signal).then(async (inventory) => {
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
        await installWatcher(inventory);
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
