import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contribute, { createBoardService } from "../../index.server";
import { readAllowedInventory } from "../../server/allowed-reader";
import type { BoardResponse } from "../../shared/board-rpc";
import { boardRpc } from "../../shared/board-rpc";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

describe("board RPC boundary", () => {
  it("reads the daemon workspaceDirectory from the production RPC context", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Observed\n" }]);
    let handler: ((input: unknown, context: unknown) => unknown | Promise<unknown>) | undefined;
    const cleanup = contribute({ handle(_contract: unknown, registered: (input: unknown, context: unknown) => unknown | Promise<unknown>) { handler = registered; } } as never);

    const result = await handler?.(
      { workspaceId: "selected", intent: "refresh" },
      { paseo: { workspaces: { ref: () => ({ refresh: async () => ({ id: "selected", workspaceDirectory: workspace.root }) }) } } },
    );

    expect(result).toMatchObject({ kind: "snapshot", snapshot: { availability: "available", overview: { roadmap: { phases: [{ title: "Observed" }] } } } });
    cleanup();
    await workspace.cleanup();
  });

  it("rejects paths, extra keys, and oversized workspace IDs at the schema boundary", async () => {
    await expect(boardRpc.input.parseAsync({ workspaceId: "selected", intent: "refresh", root: "/tmp" })).rejects.toBeDefined();
    await expect(boardRpc.input.parseAsync({ workspaceId: "x".repeat(129), intent: "refresh" })).rejects.toBeDefined();
  });

  it("returns only cache metadata for status and never resolves or reads a workspace", async () => {
    let resolutions = 0;
    const service = createBoardService({ resolveWorkspace: async () => { resolutions += 1; throw new Error("secret: never disclose"); } });
    await expect(service.handle({ workspaceId: "missing", intent: "status" })).resolves.toMatchObject({ kind: "status", availability: "unavailable", observedAt: null });
    expect(resolutions).toBe(0);
    await service.close();
  });

  it("turns hostile resolver and symlink failures into an unavailable safe DTO", async () => {
    const outside = await mkdtemp(join(tmpdir(), "paseo-outside-"));
    await writeFile(join(outside, "ROADMAP.md"), "### Phase 9: secret-token-value\n", "utf8");
    const workspace = await FixtureWorkspace.create([{ path: ".planning/keep", content: "safe" }]);
    await workspace.createSymlink(".planning/ROADMAP.md", join(outside, "ROADMAP.md"));
    const service = createBoardService({ resolveWorkspace: async () => workspace.root });
    const result = await service.handle({ workspaceId: "selected", intent: "refresh" });
    expect(result).toMatchObject({ kind: "snapshot", snapshot: { availability: "unavailable", warnings: ["containment-refused"] } });
    expect(JSON.stringify(result)).not.toContain("secret-token-value");
    await service.close();
    await workspace.cleanup();
    await rm(outside, { recursive: true, force: true });
  });

  it("keeps a refused context phase-local during a live observer refresh", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" }]);
    await workspace.createSymlink(".planning/phases/59.3-contracts/59.3-CONTEXT.md", "/etc/passwd");
    const service = createBoardService({ resolveWorkspace: async () => workspace.root });
    const result = await service.handle({ workspaceId: "selected", intent: "refresh" }) as Extract<BoardResponse, { kind: "snapshot" }>;
    expect(result.snapshot).toMatchObject({ freshness: "current", overview: { context: { phases: [{ id: "59.3", observation: "unavailable" }] } } });
    expect(result.snapshot.warnings).not.toContain("containment-refused");
    expect(JSON.stringify(result)).not.toContain("/etc/passwd");
    await service.close();
    await workspace.cleanup();
  });

  it("returns an already observed snapshot from cache without replacing its evidence", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phase 1: Observed\n" },
      { path: ".planning/phases/01-observed/01-01-PLAN.md", content: "---\nphase: 1\nplan: 01\n---\n" },
    ]);
    let reads = 0;
    const service = createBoardService({
      resolveWorkspace: async () => workspace.root,
      readInventory: async (directory) => { reads += 1; return readAllowedInventory(directory); },
    });
    const first = await service.handle({ workspaceId: "selected", intent: "refresh" }) as Extract<BoardResponse, { kind: "snapshot" }>;
    const cached = await service.handle({ workspaceId: "selected", intent: "snapshot" });
    expect(cached).toEqual(first);
    expect(reads).toBe(1);
    await service.close();
    await workspace.cleanup();
  });

  it("discards a refresh when authoritative workspace identity changes during its read", async () => {
    const first = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: First\n" }]);
    const second = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 2: Second\n" }]);
    let selected = first.root;
    let switched = false;
    const service = createBoardService({
      resolveWorkspace: async () => selected,
      readInventory: async (directory) => {
        if (directory === first.root && !switched) { switched = true; selected = second.root; }
        return readAllowedInventory(directory);
      },
    });
    const result = await service.handle({ workspaceId: "selected", intent: "refresh" });
    expect(result).toMatchObject({ kind: "snapshot", snapshot: { overview: { roadmap: { phases: [{ title: "Second" }] } } } });
    await service.close();
    await first.cleanup();
    await second.cleanup();
  });
});
