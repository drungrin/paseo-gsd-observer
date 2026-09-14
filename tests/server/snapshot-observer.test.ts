import chokidar from "chokidar";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { createSnapshotObserver, type SnapshotWatcher } from "../../server/snapshot-observer";
import type { AllowedInventory } from "../../server/allowed-reader";
import type { BoardSnapshot } from "../../shared/board-rpc";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

const inventory: AllowedInventory = {
  available: true,
  root: "/workspace",
  planningRoot: "/workspace/.planning",
  artifacts: [],
  problems: [],
  warnings: [],
  limited: false,
};

const snapshot: BoardSnapshot = {
  workspaceId: "selected",
  observedAt: "2026-09-13T12:00:00.000Z",
  freshness: "current",
  availability: "available",
  revision: 4,
  milestones: [],
  warnings: [],
  limited: false,
};

class EventWatcher implements SnapshotWatcher {
  private readonly listeners = new Map<string, Set<(value?: string | Error) => void>>();
  closed = false;
  on(event: "add" | "change" | "unlink" | "error", listener: (value?: string | Error) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  emit(event: "add" | "change" | "unlink" | "error") { for (const listener of this.listeners.get(event) ?? []) listener(); }
  async close() { this.closed = true; }
}

describe("snapshot observer", () => {
  it("invalidates only cached evidence without reading artifacts", () => {
    let reads = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: "/workspace",
      planningRoot: "/workspace/.planning",
      initialSnapshot: snapshot,
      readInventory: async () => { reads += 1; return inventory; },
      buildSnapshot: () => snapshot,
    });

    observer.invalidate();

    expect(observer.status()).toEqual({
      kind: "status",
      workspaceId: "selected",
      observedAt: snapshot.observedAt,
      freshness: "stale",
      availability: "available",
      revision: snapshot.revision + 1,
      warnings: [],
    });
    expect(reads).toBe(0);
  });

  it("reads only on manual refresh and limits watcher paths to the validated inventory", async () => {
    const paths: string[] = [];
    let options: Parameters<NonNullable<Parameters<typeof createSnapshotObserver>[0]["watcherFactory"]>>[1] | undefined;
    let reads = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: "/workspace",
      planningRoot: "/workspace/.planning",
      initialSnapshot: snapshot,
      readInventory: async () => {
        reads += 1;
        return {
          ...inventory,
          artifacts: [{ key: "phases/01-safe/01-08-PLAN.md", kind: "plan", phaseId: "1", bytes: new Uint8Array(), size: 0 }],
        };
      },
      buildSnapshot: () => snapshot,
      watcherFactory: (nextPaths, nextOptions) => {
        paths.push(...nextPaths);
        options = nextOptions;
        return { on() { return this; }, async close() {} } as SnapshotWatcher;
      },
    });

    expect(reads).toBe(0);
    await observer.refresh();

    expect(reads).toBe(1);
    expect(paths).toEqual([
      "/workspace/.planning",
      "/workspace/.planning/phases",
      "/workspace/.planning/phases/01-safe",
    ]);
    expect(options).toMatchObject({ followSymlinks: false, ignoreInitial: true, depth: 0 });
    expect(options?.ignored("/workspace/.planning/phases/01-safe/secret.log")).toBe(true);
    expect(options?.ignored("/workspace/.planning/phases/01-safe/01-08-PLAN.md")).toBe(false);
  });

  it("keeps the last safe evidence when refresh output is not a valid board DTO", async () => {
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: "/workspace",
      planningRoot: "/workspace/.planning",
      initialSnapshot: snapshot,
      readInventory: async () => inventory,
      buildSnapshot: () => ({ ...snapshot, workspaceId: "" }) as BoardSnapshot,
    });

    await observer.refresh();

    expect(observer.snapshot()).toMatchObject({
      workspaceId: snapshot.workspaceId,
      observedAt: snapshot.observedAt,
      freshness: "refresh-failed",
      availability: snapshot.availability,
      milestones: snapshot.milestones,
    });
    expect(observer.status().warnings).toContain("unreadable");
  });

  it("keeps a refresh stale after an event races with its bounded read", async () => {
    const watcher = new EventWatcher();
    let releases: ((value: AllowedInventory) => void) | undefined;
    let calls = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: "/workspace",
      planningRoot: "/workspace/.planning",
      initialSnapshot: snapshot,
      readInventory: async () => {
        calls += 1;
        if (calls === 1) return inventory;
        return new Promise<AllowedInventory>((resolve) => { releases = resolve; });
      },
      buildSnapshot: ({ observedAt }) => ({ ...snapshot, observedAt }),
      watcherFactory: () => watcher,
      clock: () => new Date("2026-09-13T12:01:00.000Z"),
    });
    await observer.refresh();
    const refresh = observer.refresh();
    watcher.emit("change");
    releases?.(inventory);
    await refresh;

    expect(observer.snapshot()).toMatchObject({ observedAt: "2026-09-13T12:01:00.000Z", freshness: "stale" });
  });

  it("aborts pending reads and prevents their late result from publishing after close", async () => {
    let release: ((value: AllowedInventory) => void) | undefined;
    let signal: AbortSignal | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: "/workspace",
      planningRoot: "/workspace/.planning",
      initialSnapshot: snapshot,
      readInventory: async (_directory, nextSignal) => {
        signal = nextSignal;
        return new Promise<AllowedInventory>((resolve) => { release = resolve; });
      },
      buildSnapshot: ({ observedAt }) => ({ ...snapshot, observedAt }),
    });
    const pending = observer.refresh();
    await Promise.resolve();
    await observer.close();
    release?.(inventory);
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(observer.snapshot()).toEqual(snapshot);
    await expect(observer.close()).resolves.toBeUndefined();
  });

  it("uses a real shallow watcher for add, change, and unlink without rereading", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phase 1: Observed\n" },
      { path: ".planning/phases/01-safe/01-01-PLAN.md", content: "---\nphase: 1\nplan: 01\n---\n" },
    ]);
    const planningRoot = join(workspace.root, ".planning");
    const plan = join(planningRoot, "phases", "01-safe", "01-01-PLAN.md");
    const added = join(planningRoot, "phases", "01-safe", "01-02-PLAN.md");
    let reads = 0;
    let watcher: ReturnType<typeof chokidar.watch> | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected",
      root: workspace.root,
      planningRoot,
      initialSnapshot: snapshot,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
      buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => (watcher = chokidar.watch([...paths], options)) as unknown as SnapshotWatcher,
    });
    try {
      await observer.refresh();
      await new Promise<void>((resolve) => watcher?.once("ready", resolve));
      await writeFile(plan, "---\nphase: 1\nplan: 01\n---\n# changed\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(1);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(added, "---\nphase: 1\nplan: 02\n---\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await rm(added);
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(3);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });
});
