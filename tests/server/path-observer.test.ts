import chokidar from "chokidar";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { createSnapshotObserver, type SnapshotWatcher, type WatcherOptions } from "../../server/snapshot-observer";
import type { BoardSnapshot } from "../../shared/board-rpc";
import { forkFiles } from "../fixtures/path-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

const snapshot: BoardSnapshot = { workspaceId: "selected", observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: ["absent"], limited: false };
const silentWatcher = (): SnapshotWatcher => { const watcher: SnapshotWatcher = { on: () => watcher, close: async () => undefined }; return watcher; };

describe("GSD Path watcher", () => {
  it("watches .project and its allowlisted folders, ignoring every other file", async () => {
    const workspace = await FixtureWorkspace.create(forkFiles);
    const projectRoot = await realpath(join(workspace.root, ".project"));
    let watched: { paths: readonly string[]; options: WatcherOptions } | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot: projectRoot, initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => { watched = { paths, options }; return silentWatcher(); },
    });
    try {
      await observer.refresh();
      expect(watched?.paths).toEqual([projectRoot, join(projectRoot, "next"), join(projectRoot, "plan"), join(projectRoot, "tasks")]);
      const ignored = (path: string) => watched!.options.ignored(join(projectRoot, path));
      for (const path of ["STATE.md", "ROADMAP.md", "plan", "tasks", "next", "plan/PLAN.md", "next/STATE.md", "tasks/T001-pin-runtime-version.md", "tasks/T012-new.md"]) expect(ignored(path), path).toBe(false);
      for (const path of ["MEMBERS.md", "build", "build/verify-ledger.jsonl", "program/RESEARCH.md", "tasks/notes.md", "plan/OTHER.md", "plan/build-recovery-abc/PLAN.md", "../outside.md"]) expect(ignored(path), path).toBe(true);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });

  it("marks the snapshot stale when a task file changes", async () => {
    const workspace = await FixtureWorkspace.create(forkFiles);
    const projectRoot = await realpath(join(workspace.root, ".project"));
    let ready = false;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot: projectRoot, initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => { const watcher = chokidar.watch([...paths], options); watcher.on("ready", () => { ready = true; }); return watcher as unknown as SnapshotWatcher; },
    });
    try {
      await observer.refresh();
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      await writeFile(join(projectRoot, "tasks", "T003-register-invoices.md"), "---\nid: T003\nwave: 2\nstatus: done\n---\n", "utf8");
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      await observer.refresh();
      expect(observer.snapshot().path?.tasks.counts.done).toBe(3);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });

  it("moves the watcher to .project when a GSD Core workspace migrates to GSD Path", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n" }]);
    const planningRoot = await realpath(join(workspace.root, ".planning"));
    const watched: (readonly string[])[] = [];
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot, initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths) => { watched.push(paths); return silentWatcher(); },
    });
    try {
      expect((await observer.refresh()).flavor).toBe("gsd-core");
      for (const file of forkFiles) await workspace.write(file.path, file.content);
      expect((await observer.refresh()).flavor).toBe("gsd-path");
      const projectRoot = await realpath(join(workspace.root, ".project"));
      expect(watched.map((paths) => paths[0])).toEqual([planningRoot, projectRoot]);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });

  it("installs no watcher for an install that has no .project yet", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".gsd-path/runtime.json", content: "{}\n" }]);
    let created = 0;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot: join(workspace.root, ".project"), initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: () => { created += 1; return silentWatcher(); },
    });
    try {
      expect((await observer.refresh()).path?.setup).toBe("not-started");
      expect(created).toBe(0);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });
});
