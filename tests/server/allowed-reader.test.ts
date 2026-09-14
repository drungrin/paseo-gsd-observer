import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBoardService } from "../../index.server";
import { LIMITS, readAllowedInventory } from "../../server/allowed-reader";
import { isStrictDescendant, resolveWorkspaceRoot } from "../../server/workspace-root";
import { fixtureFiles } from "../fixtures/gsd-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

describe("resolveWorkspaceRoot", () => {
  it("keeps a snapshot unavailable when the selected workspace cannot be resolved", async () => {
    const service = createBoardService({ resolveWorkspace: async () => null });

    await expect(service.handle({ workspaceId: "selected", intent: "refresh" })).resolves.toMatchObject({
      kind: "snapshot",
      snapshot: { availability: "unavailable", warnings: ["unreadable"] },
    });

    await service.close();
  });

  it("uses real identities and rejects a textual path that merely shares the workspace prefix", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const root = await resolveWorkspaceRoot(workspace.root);

    expect(root).toMatchObject({ available: true, root: workspace.root, planningRoot: `${workspace.root}/.planning` });
    expect(isStrictDescendant("/tmp/board", "/tmp/board-escape/.planning")).toBe(false);
    await workspace.createSymlink(".planning-linked", `${workspace.root}/.planning`);
    await workspace.cleanup();
  });
});

describe("readAllowedInventory", () => {
  it("uses the injected bounded inventory instead of opening a raw roadmap path", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const readInventory = vi.fn(async () => ({
      root: workspace.root,
      planningRoot: `${workspace.root}/.planning`,
      artifacts: [],
      warnings: [],
      limited: false,
    }));
    const service = createBoardService({
      resolveWorkspace: async () => workspace.root,
      readInventory,
    } as never);

    await service.handle({ workspaceId: "selected", intent: "refresh" });

    expect(readInventory).toHaveBeenCalledOnce();
    await service.close();
    await workspace.cleanup();
  });

  it("returns only discovered allowlisted artifacts and keeps a symlink refusal local", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    await workspace.createSymlink(".planning/phases/02.2-early/02-02-SUMMARY.md", "/etc/passwd");

    const inventory = await readAllowedInventory(workspace.root);

    expect(inventory.available).toBe(true);
    expect(inventory.artifacts.map((artifact) => artifact.key)).toEqual(expect.arrayContaining([
      "ROADMAP.md",
      "phases/02.2-early/02-01-PLAN.md",
      "phases/99-extra/99-CONTEXT.md",
    ]));
    expect(inventory.artifacts.map((artifact) => artifact.key)).not.toContain("fixtures/malformed.md");
    expect(inventory.problems).toEqual(expect.arrayContaining([expect.objectContaining({ phaseId: "2.2", warning: "containment-refused" })]));
    expect(JSON.stringify(inventory)).not.toContain("/etc/passwd");
    await workspace.cleanup();
  });

  it("caps an oversized allowlisted file before exposing its bytes", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "x".repeat(LIMITS.bytesPerFile + 1) }]);

    const inventory = await readAllowedInventory(workspace.root);

    expect(inventory.artifacts).toHaveLength(0);
    expect(inventory.warnings).toContain("oversize");
    await workspace.cleanup();
  });

  it("discovers archived phase artifacts only from a safe milestone directory name", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);

    const inventory = await readAllowedInventory(workspace.root);

    expect(inventory.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "milestones/v0.1-phases/01-old/01-CONTEXT.md", milestoneId: "v0.1", phaseId: "1" }),
    ]));
    await workspace.cleanup();
  });

  it("defers archive artifact reads while retaining safe archive identifiers", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);

    const inventory = await readAllowedInventory(workspace.root, { includeArchives: false });

    expect(inventory.archiveIds).toEqual(["v0.1"]);
    expect(inventory.artifacts.some((artifact) => artifact.milestoneId)).toBe(false);
    await workspace.cleanup();
  });

  it("refuses empty external phases and milestones containers before enumeration", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    const external = await mkdtemp(join(tmpdir(), "paseo-gsd-observer-external-"));
    await workspace.createSymlink(".planning/phases", external);
    await workspace.createSymlink(".planning/milestones", external);

    const inventory = await readAllowedInventory(workspace.root);

    expect(inventory.artifacts.map((artifact) => artifact.key)).toEqual(["ROADMAP.md"]);
    expect(inventory.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ warning: "containment-refused" }),
    ]));
    expect(inventory.warnings).toContain("containment-refused");
    expect(JSON.stringify(inventory)).not.toContain(external);
    await workspace.cleanup();
    await rm(external, { recursive: true, force: true });
  });
});
