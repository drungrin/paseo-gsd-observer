import chokidar from "chokidar";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
  warnings: [],
  limited: false,
};

class EventWatcher implements SnapshotWatcher {
  private readonly listeners = new Map<string, Set<(value?: string | Error) => void>>();
  closed = false;
  on(event: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "error" | "ready", listener: (value?: string | Error) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  emit(event: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "error" | "ready") { for (const listener of this.listeners.get(event) ?? []) listener(); }
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
    expect(options?.ignored("/workspace/.planning/phases/01-safe/01-VALIDATION.md")).toBe(false);
    expect(options?.ignored("/workspace/.planning/phases/01-safe/PATTERNS.md")).toBe(false);
    expect(options?.ignored("/workspace/.planning/phases/01-safe/01-deferred-items.md")).toBe(false);
    expect(options?.ignored("/workspace/.planning/phases/01-safe/02-VALIDATION.md")).toBe(true);
    expect(options?.ignored("/workspace/.planning/phases/01-safe/01-02-VALIDATION.md")).toBe(true);
    expect(options?.ignored("/workspace/.planning/WINDOWS.md")).toBe(true);
    expect(options?.ignored("/workspace/.planning/REQUIREMENTS.md")).toBe(false);
    expect(options?.ignored("/workspace/.planning/private-requirements.md")).toBe(true);
  });

  it("watches only validated TODO buckets and filters paths with the reader's filename policy", async () => {
    let paths: readonly string[] = [];
    let ignored: ((path: string) => boolean) | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: "/workspace", planningRoot: "/workspace/.planning", initialSnapshot: snapshot,
      readInventory: async () => ({ ...inventory, watchDirectories: ["todos", "todos/pending", "todos/deferred", "todos/private", "todos/pending/nested"] }),
      buildSnapshot: () => snapshot,
      watcherFactory: (nextPaths, options) => {
        paths = nextPaths;
        ignored = options.ignored;
        return new EventWatcher();
      },
    });
    try {
      await observer.refresh();
      expect(paths).toEqual([
        "/workspace/.planning", "/workspace/.planning/todos", "/workspace/.planning/todos/deferred", "/workspace/.planning/todos/pending",
      ]);
      for (const accepted of [
        "todos", "todos/pending", "todos/deferred", "todos/ci-validacao-pr.md",
        "todos/pending/2026-07-21-select-de-modo-da-capa-dispara-onvaluechange-espurio-ao-carregar-acrescimo.md",
        "todos/deferred/note.md",
      ]) expect(ignored?.(`/workspace/.planning/${accepted}`)).toBe(false);
      for (const rejected of [
        "todos/private", "todos/private/note.md", "todos/pending/nested/note.md", "todos/pending/.hidden.md",
        "todos/pending/notes.txt", "todos/pending/space name.md", "todos/pending/notes.md.bak", "todos/pending/notes.MD",
        "todos/pending/underscored__name.md", "other/note.md",
      ]) expect(ignored?.(`/workspace/.planning/${rejected}`)).toBe(true);
      expect(ignored?.("/workspace/.planning/todos/pending/../../private.md")).toBe(true);
    } finally { await observer.close(); }
  });

  it("marks a newly armed bucket stale at ready and ignores late events from the retired watcher", async () => {
    const watchers: EventWatcher[] = [];
    let observed = { ...inventory, watchDirectories: ["todos"] };
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: "/workspace", planningRoot: "/workspace/.planning", initialSnapshot: snapshot,
      readInventory: async () => observed,
      buildSnapshot: () => snapshot,
      watcherFactory: () => {
        const watcher = new EventWatcher();
        watchers.push(watcher);
        return watcher;
      },
    });
    try {
      await observer.refresh();
      expect(observer.status().freshness).toBe("current");
      observed = { ...inventory, watchDirectories: ["todos", "todos/pending"] };
      await observer.refresh();
      expect(watchers).toHaveLength(2);
      expect(watchers[0].closed).toBe(true);
      expect(observer.status().freshness).toBe("current");
      watchers[1].emit("ready"); // ignoreInitial suppresses files created after the read but before this event.
      expect(observer.status().freshness).toBe("stale");
      await observer.refresh();
      const revision = observer.snapshot().revision;
      watchers[0].emit("change");
      watchers[0].emit("error");
      watchers[0].emit("ready");
      expect(observer.snapshot()).toMatchObject({ freshness: "current", revision, warnings: [] });
      watchers[1].emit("change");
      expect(observer.status().freshness).toBe("stale");
    } finally { await observer.close(); }
  });

  it("watches a validated phase directory even when it has no readable check artifacts", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n" },
      { path: ".planning/phases/01-safe/README.txt", content: "not a check" },
    ]);
    const planningRoot = join(workspace.root, ".planning");
    let watcher: ReturnType<typeof chokidar.watch> | undefined;
    let ready = false;
    let reads = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot, initialSnapshot: snapshot,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
      buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => {
        expect(paths).toContain(join(planningRoot, "phases", "01-safe"));
        watcher = chokidar.watch([...paths], options);
        watcher.on("ready", () => { ready = true; });
        return watcher as unknown as SnapshotWatcher;
      },
    });
    try {
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      await writeFile(join(planningRoot, "phases", "01-safe", "01-PATTERNS.md"), "# Patterns\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(1);
      await observer.refresh();
      expect(observer.snapshot().overview?.plans.phases[0].checks.plan.patterns.observation).toBe("observed");
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });

  it("re-arms watcher paths after an explicit refresh discovers a new phase directory", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n- [ ] Phase 2: New\n" },
      { path: ".planning/phases/01-safe/README.txt", content: "not a check" },
    ]);
    const planningRoot = join(workspace.root, ".planning");
    const watched: string[][] = [];
    let ready = false;
    let reads = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot, initialSnapshot: snapshot,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
      buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => {
        watched.push([...paths]);
        ready = false;
        const watcher = chokidar.watch([...paths], options);
        watcher.on("ready", () => { ready = true; });
        return watcher as unknown as SnapshotWatcher;
      },
    });
    try {
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched).toHaveLength(1);
      await mkdir(join(planningRoot, "phases", "02-new"));
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      expect(watched).toHaveLength(2);
      expect(watched[1]).toContain(join(planningRoot, "phases", "02-new"));
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(join(planningRoot, "phases", "02-new", "02-SECURITY.md"), "---\nstatus: draft\n---\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(2);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
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
      { path: ".planning/REQUIREMENTS.md", content: "## Requirements for v1.0\n- [ ] **REQ-01**: Pending.\n" },
      { path: ".planning/phases/01-safe/01-01-PLAN.md", content: "---\nphase: 1\nplan: 01\n---\n" }
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
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(join(planningRoot, "REQUIREMENTS.md"), "## Requirements for v1.0\n- [x] **REQ-01**: Marked complete.\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(4);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(join(planningRoot, "phases", "01-safe", "01-VALIDATION.md"), "---\nstatus: draft\nnyquist_compliant: false\n---\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(5); // File events invalidate only; they never trigger an inventory read.
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });

  it("invalidates on TODO add, change, move, and new bucket events without reading until refresh", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    const planningRoot = join(workspace.root, ".planning");
    const todos = join(planningRoot, "todos");
    let reads = 0;
    let ready = false;
    const watched: string[][] = [];
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot, initialSnapshot: snapshot,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
      buildSnapshot: ({ observedAt }) => ({ ...snapshot, observedAt }),
      watcherFactory: (paths, options) => {
        watched.push([...paths]);
        ready = false;
        const watcher = chokidar.watch([...paths], options);
        watcher.on("ready", () => { ready = true; });
        return watcher as unknown as SnapshotWatcher;
      },
    });
    try {
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched[0]).toEqual([planningRoot]);
      await mkdir(todos);
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(1);
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched[1]).toContain(todos);
      await new Promise((resolve) => setTimeout(resolve, 175));
      await mkdir(join(todos, "pending"));
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched[2]).toContain(join(todos, "pending"));
      const source = join(todos, "pending", "2026-09-25-task.md");
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(source, "# New\n");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(3);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await writeFile(source, "# Changed\n");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(4);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await mkdir(join(todos, "done"));
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched.at(-1)).toContain(join(todos, "done"));
      await new Promise((resolve) => setTimeout(resolve, 175));
      await rename(source, join(todos, "done", "2026-09-25-task.md"));
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(6);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 175));
      await rm(join(todos, "done"), { recursive: true });
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(7);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  }, 10_000);

  it("watches only the debug directory and its resolved archive with the reader's filename policy", async () => {
    let paths: readonly string[] = [];
    let ignored: ((path: string) => boolean) | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: "/workspace", planningRoot: "/workspace/.planning", initialSnapshot: snapshot,
      readInventory: async () => ({ ...inventory, watchDirectories: ["debug", "debug/resolved", "debug/private", "debug/resolved/nested"] }),
      buildSnapshot: () => snapshot,
      watcherFactory: (nextPaths, options) => {
        paths = nextPaths;
        ignored = options.ignored;
        return new EventWatcher();
      },
    });
    try {
      await observer.refresh();
      expect(paths).toEqual(["/workspace/.planning", "/workspace/.planning/debug", "/workspace/.planning/debug/resolved"]);
      for (const accepted of ["debug", "debug/resolved", "debug/login-mobile-comb-falha.md", "debug/knowledge-base.md", "debug/resolved/civil-servant-outro-orgao.md"]) {
        expect(ignored?.(`/workspace/.planning/${accepted}`)).toBe(false);
      }
      for (const rejected of ["debug/58-06-red-evidence.json", "debug/private", "debug/private/note.md", "debug/resolved/nested/note.md", "debug/.hidden.md", "debug/space name.md", "debug/resolved/notes.md.bak"]) {
        expect(ignored?.(`/workspace/.planning/${rejected}`)).toBe(true);
      }
      expect(ignored?.("/workspace/.planning/debug/../../private.md")).toBe(true);
    } finally { await observer.close(); }
  });

  it("invalidates when a debug session is created and when it moves into the resolved archive", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    const planningRoot = join(workspace.root, ".planning");
    const debug = join(planningRoot, "debug");
    let reads = 0;
    let ready = false;
    const watched: string[][] = [];
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot, initialSnapshot: snapshot,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
      buildSnapshot: ({ observedAt }) => ({ ...snapshot, observedAt }),
      watcherFactory: (paths, options) => {
        watched.push([...paths]);
        ready = false;
        const watcher = chokidar.watch([...paths], options);
        watcher.on("ready", () => { ready = true; });
        return watcher as unknown as SnapshotWatcher;
      },
    });
    try {
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      await mkdir(join(debug, "resolved"), { recursive: true });
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      expect(watched.at(-1)).toEqual(expect.arrayContaining([debug, join(debug, "resolved")]));
      // Newly armed directories read as stale at ready: a file created before the watch began may have been missed.
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(observer.status().freshness).toBe("current");
      const session = join(debug, "login-falha.md");
      await writeFile(session, "---\nstatus: investigating\n---\n");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(3);
      await observer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(observer.status().freshness).toBe("current");
      await writeFile(join(debug, "evidence.json"), "{}");
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(observer.status().freshness).toBe("current");
      await rename(session, join(debug, "resolved", "login-falha.md"));
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect(reads).toBe(4);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  }, 10_000);
});
