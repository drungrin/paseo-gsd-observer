import chokidar from "chokidar";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { createSnapshotObserver, type SnapshotWatcher, type WatcherOptions } from "../../server/snapshot-observer";
import type { BoardSnapshot } from "../../shared/board-rpc";
import { forkFiles, forkReviewFiles } from "../fixtures/path-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

const snapshot: BoardSnapshot = { workspaceId: "selected", observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: ["absent"], limited: false };
const silentWatcher = (): SnapshotWatcher => { const watcher: SnapshotWatcher = { on: () => watcher, close: async () => undefined }; return watcher; };

describe("GSD Path watcher", () => {
  it("watches .project and its allowlisted folders, ignoring every other file", async () => {
    const workspace = await FixtureWorkspace.create([...forkFiles, ...forkReviewFiles]);
    const projectRoot = await realpath(join(workspace.root, ".project"));
    let watched: { paths: readonly string[]; options: WatcherOptions } | undefined;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root: workspace.root, planningRoot: projectRoot, initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => { watched = { paths, options }; return silentWatcher(); },
    });
    try {
      await observer.refresh();
      const recovery = "plan/build-recovery-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
      expect(watched?.paths).toEqual([projectRoot, ...["discuss", "next", "plan", recovery, `${recovery}/review`, "review", "tasks"].map((path) => join(projectRoot, path))]);
      const ignored = (path: string) => watched!.options.ignored(join(projectRoot, path));
      for (const path of ["STATE.md", "ROADMAP.md", "plan", "tasks", "next", "review", "discuss", "plan/PLAN.md", "next/STATE.md", "discuss/ANSWERS.md", "tasks/T001-pin-runtime-version.md", "tasks/T012-new.md",
        "review/FINAL.md", "review/wave-3.cycle1.panel.muse.md", recovery, `${recovery}/review`, `${recovery}/review/wave-1.cycle1.md`]) expect(ignored(path), path).toBe(false);
      for (const path of ["MEMBERS.md", "build", "build/verify-ledger.jsonl", "program/RESEARCH.md", "tasks/notes.md", "plan/OTHER.md", "plan/build-recovery-abc", `${recovery}/PLAN.md`, `${recovery}/review/nested/x.md`,
        "review/notes.txt", "discuss/DIALOGUE.md", "../outside.md"]) expect(ignored(path), path).toBe(true);
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

  it("watches an install with no .project yet only for .project appearing", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".gsd-path/runtime.json", content: "{}\n" }]);
    const root = await realpath(workspace.root);
    let watched: { paths: readonly string[]; options: WatcherOptions } | undefined;
    let ready = false;
    const observer = createSnapshotObserver({
      workspaceId: "selected", root, planningRoot: join(root, ".project"), initialSnapshot: snapshot,
      readInventory: readAllowedInventory, buildSnapshot: buildBoardSnapshot,
      watcherFactory: (paths, options) => { watched = { paths, options }; const watcher = chokidar.watch([...paths], options); watcher.on("ready", () => { ready = true; }); return watcher as unknown as SnapshotWatcher; },
    });
    try {
      expect((await observer.refresh()).path?.setup).toBe("not-started");
      expect(watched?.paths).toEqual([root]);
      expect(["README.md", ".gsd-path", ".planning", "src"].map((name) => watched!.options.ignored(join(root, name)))).toEqual([true, true, true, true]);
      expect([root, join(root, ".project")].map((path) => watched!.options.ignored(path))).toEqual([false, false]);
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true);
      await workspace.write("README.md", "# Unrelated\n");
      await workspace.write(".project/STATE.md", forkFiles.find((file) => file.path === ".project/STATE.md")!.content);
      await expect.poll(() => observer.status().freshness, { timeout: 3_000 }).toBe("stale");
      expect((await observer.refresh()).path?.setup).toBe("started");
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });
});
