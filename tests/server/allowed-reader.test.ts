import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBoardService } from "../../index.server";
import { LIMITS, readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
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

  it("identifies unreadable phase context separately from no context", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" }]);
    await workspace.createSymlink(".planning/phases/59.3-contracts/59.3-CONTEXT.md", "/etc/passwd");
    const inventory = await readAllowedInventory(workspace.root);
    expect(inventory.problems).toContainEqual({ phaseId: "59.3", kind: "context", warning: "containment-refused" });
    expect(inventory.warnings).not.toContain("containment-refused");
    expect(inventory.artifacts.some((artifact) => artifact.kind === "context")).toBe(false);
    await workspace.cleanup();
  });

  it("reads optional root requirements without changing Legacy warnings or limited state", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" }]);
    const before = await readAllowedInventory(workspace.root);
    expect(before.artifacts.map((item) => item.key)).not.toContain("REQUIREMENTS.md");
    expect(before.problems).not.toContainEqual(expect.objectContaining({ kind: "requirements" }));
    await workspace.write(".planning/REQUIREMENTS.md", "## Requisitos da v2.0\n- [x] **REQ-01**: Done\n");
    const after = await readAllowedInventory(workspace.root);
    expect(after.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "REQUIREMENTS.md", kind: "requirements" })]));
    expect(after.warnings).toEqual(before.warnings);
    expect(after.limited).toBe(before.limited);
    await workspace.cleanup();
  });

  it("keeps oversized and refused requirements local without hiding root State/Roadmap", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\n---\n" },
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
      { path: ".planning/REQUIREMENTS.md", content: "x".repeat(LIMITS.bytesPerFile + 1) },
    ]);
    const oversized = await readAllowedInventory(workspace.root);
    expect(oversized.artifacts.map((item) => item.kind)).toEqual(["roadmap", "state"]);
    expect(oversized.problems).toContainEqual({ kind: "requirements", warning: "oversize" });
    expect(oversized.warnings).not.toContain("oversize");
    expect(oversized.limited).toBe(false);
    await workspace.cleanup();
    const symlink = await FixtureWorkspace.create([
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\n---\n" },
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
    ]);
    await symlink.createSymlink(".planning/REQUIREMENTS.md", "/etc/passwd");
    const refused = await readAllowedInventory(symlink.root);
    expect(refused.problems).toContainEqual({ kind: "requirements", warning: "containment-refused" });
    expect(refused.warnings).not.toContain("containment-refused");
    expect(refused.artifacts.map((item) => item.kind)).toEqual(["roadmap", "state"]);
    await symlink.cleanup();
  });

  it("reads only exact current-phase optional checks after root inventory and requirements", async () => {
    const dir = ".planning/phases/59.3-current";
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Current\n" },
      { path: ".planning/STATE.md", content: "Deferred Items: completed\n" },
      { path: ".planning/WINDOWS.md", content: "status: complete\n" },
      { path: `${dir}/PATTERNS.md`, content: "# Patterns\n" },
      { path: `${dir}/59.3-UI-SPEC.md`, content: "---\nstatus: draft\n---\n" },
      { path: `${dir}/59.3-VALIDATION.md`, content: "---\nstatus: draft\nnyquist_compliant: false\n---\n" },
      { path: `${dir}/59.2-SECURITY.md`, content: "status: verified\n" },
      { path: `${dir}/59.3-01-UI-SPEC.md`, content: "status: complete\n" },
      { path: `${dir}/59.3-PLAN-CHECK.md.bak`, content: "status: passed\n" },
      { path: ".planning/milestones/v1.0-phases/59.3-old/59.3-RESEARCH.md", content: "status: passed\n" },
    ]);
    const inventory = await readAllowedInventory(workspace.root);
    expect(inventory.watchDirectories).toEqual(["phases", "phases/59.3-current"]);
    expect(inventory.artifacts.filter((item) => item.phaseId === "59.3" && item.kind !== "plan").map((item) => item.kind).sort()).toEqual(["patterns", "ui-spec", "validation"]);
    expect(inventory.artifacts.map((item) => item.kind)).not.toContain("windows");
    expect(inventory.warnings).toEqual([]);
    expect(inventory.artifacts.some((item) => item.key.startsWith("milestones/"))).toBe(false);
    expect(inventory.limited).toBe(false);
    await workspace.cleanup();
  });

  it("keeps refused and oversized optional evidence local instead of changing global limits", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
      { path: ".planning/phases/01-current/01-VALIDATION.md", content: "x".repeat(LIMITS.bytesPerFile + 1) },
      { path: ".planning/phases/01-current/01-UI-CHECK.md", content: "---\nstatus: passed\n---\n" },
    ]);
    await workspace.createSymlink(".planning/phases/01-current/01-SECURITY.md", "/etc/passwd");
    await writeFile(join(workspace.root, ".planning/phases/01-current/01-SPEC.md"), new Uint8Array([0xff]));
    const unreadable = await workspace.write(".planning/phases/01-current/01-PATTERNS.md", "# Private\n");
    await chmod(unreadable, 0o000);
    const inventory = await readAllowedInventory(workspace.root);
    expect(inventory.artifacts.map((item) => item.kind)).toContain("ui-check");
    expect(inventory.problems).toEqual(expect.arrayContaining([
      { phaseId: "1", kind: "validation", warning: "oversize" },
      { phaseId: "1", kind: "security", warning: "containment-refused" },
      { phaseId: "1", kind: "spec", warning: "malformed" },
      { phaseId: "1", kind: "patterns", warning: "unreadable" },
    ]));
    expect(inventory.warnings).not.toContain("oversize");
    expect(inventory.warnings).not.toContain("containment-refused");
    expect(inventory.limited).toBe(false);
    await workspace.cleanup();
  });

  it("refuses an empty external phases container before enumeration and never reads milestone archives", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/MILESTONES.md", content: "## v0.1\n" },
      { path: ".planning/milestones/v0.1-ROADMAP.md", content: "# Archived roadmap\n" },
    ]);
    const external = await mkdtemp(join(tmpdir(), "paseo-gsd-observer-external-"));
    await workspace.createSymlink(".planning/phases", external);

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

  it("reads only direct TODO Markdown from the root and supported buckets", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/todos/ci-validacao-pr.md", content: "# Root TODO\n" },
      { path: ".planning/todos/pending/2026-07-21-select-de-modo-da-capa-dispara-onvaluechange-espurio-ao-carregar-acrescimo.md", content: "# Pending\n" },
      { path: ".planning/todos/backlog/one.md", content: "# Backlog\n" },
      { path: ".planning/todos/deferred/two.md", content: "# Deferred\n" },
      { path: ".planning/todos/done/three.md", content: "# Done\n" },
      { path: ".planning/todos/completed/four.md", content: "# Completed\n" },
      { path: ".planning/todos/pending/nested/hidden.md", content: "not direct" },
      { path: ".planning/todos/other/hidden.md", content: "wrong bucket" },
      { path: ".planning/todos/pending/notes.txt", content: "wrong extension" },
      { path: ".planning/todos/pending/.hidden.md", content: "hidden" },
      { path: ".planning/todos/pending/bad name.md", content: "not a slug" },
      { path: ".planning/todos/pending/extra.md.bak", content: "backup" },
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.filter((item) => item.kind === "todo").map((item) => item.key).sort()).toEqual([
        "todos/backlog/one.md", "todos/ci-validacao-pr.md", "todos/completed/four.md", "todos/deferred/two.md", "todos/done/three.md",
        "todos/pending/2026-07-21-select-de-modo-da-capa-dispara-onvaluechange-espurio-ao-carregar-acrescimo.md",
      ]);
      expect(inventory.artifacts.filter((item) => item.kind === "todo").map((item) => item.key)).toEqual([
        "todos/pending/2026-07-21-select-de-modo-da-capa-dispara-onvaluechange-espurio-ao-carregar-acrescimo.md",
        "todos/backlog/one.md", "todos/deferred/two.md", "todos/ci-validacao-pr.md", "todos/completed/four.md", "todos/done/three.md",
      ]);
      expect(inventory.artifacts.filter((item) => item.kind === "todo")).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "todos/ci-validacao-pr.md", kind: "todo", size: 12 }),
      ]));
      expect(inventory.artifacts.filter((item) => item.kind === "todo").every((item) => !item.phaseId)).toBe(true);
      expect(inventory.watchDirectories).toEqual(["todos", "todos/pending", "todos/backlog", "todos/deferred", "todos/completed", "todos/done"]);
      expect(inventory.problems).not.toContainEqual(expect.objectContaining({ kind: "todo" }));
      const board = buildBoardSnapshot({ workspaceId: "selected", inventory, observedAt: "2026-09-25T00:00:00.000Z" });
      expect(JSON.stringify(board)).not.toContain(workspace.root);
      expect(JSON.stringify(board)).not.toContain("ci-validacao-pr.md");
      expect(JSON.stringify(board)).not.toContain("todos/pending/");
    } finally { await workspace.cleanup(); }
  });

  it("preserves case-sensitive TODO filenames and duplicate names across buckets", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/todos/pending/Task.md", content: "# First\n" },
      { path: ".planning/todos/pending/task.md", content: "# Second\n" },
      { path: ".planning/todos/backlog/Task.md", content: "# Third\n" },
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.filter((item) => item.kind === "todo").map((item) => item.key).sort()).toEqual([
        "todos/backlog/Task.md", "todos/pending/Task.md", "todos/pending/task.md",
      ]);
    } finally { await workspace.cleanup(); }
  });

  it("distinguishes absent TODO root from present empty buckets without changing Legacy status", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    try {
      const absent = await readAllowedInventory(workspace.root);
      expect(absent.problems).toContainEqual({ kind: "todo", warning: "absent" });
      expect(absent.watchDirectories).not.toContain("todos");
      await mkdir(join(workspace.root, ".planning/todos/pending"), { recursive: true });
      const empty = await readAllowedInventory(workspace.root);
      expect(empty.watchDirectories).toEqual(["todos", "todos/pending"]);
      expect(empty.problems).not.toContainEqual(expect.objectContaining({ kind: "todo" }));
      expect(empty.warnings).toEqual(absent.warnings);
      expect(empty.limited).toBe(absent.limited);
    } finally { await workspace.cleanup(); }
  });

  it("refuses TODO symlinks, oversized content, and invalid UTF-8 locally", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/todos/pending/huge.md", content: "x".repeat(LIMITS.bytesPerFile + 1) },
      { path: ".planning/todos/pending/safe.md", content: "# Safe\n" },
    ]);
    const external = await mkdtemp(join(tmpdir(), "paseo-todo-external-"));
    try {
      await workspace.createSymlink(".planning/todos/pending/linked.md", "/etc/passwd");
      await workspace.createSymlink(".planning/todos/backlog", external);
      await writeFile(join(workspace.root, ".planning/todos/pending/invalid.md"), new Uint8Array([0xff]));
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.filter((item) => item.kind === "todo").map((item) => item.key)).toEqual(["todos/pending/safe.md"]);
      expect(inventory.problems).toEqual(expect.arrayContaining([
        { kind: "todo", warning: "oversize" },
        { kind: "todo", warning: "malformed" },
        { kind: "todo", warning: "containment-refused" },
      ]));
      expect(inventory.watchDirectories).not.toContain("todos/backlog");
      expect(inventory.warnings).not.toContain("oversize");
      expect(inventory.warnings).not.toContain("malformed");
      expect(inventory.warnings).not.toContain("containment-refused");
      expect(inventory.limited).toBe(false);
      expect(JSON.stringify(inventory)).not.toContain(external);
      expect(JSON.stringify(inventory)).not.toContain("/etc/passwd");
    } finally {
      await workspace.cleanup();
      await rm(external, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked TODO root without enumerating external files", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    const external = await mkdtemp(join(tmpdir(), "paseo-todo-external-"));
    try {
      await writeFile(join(external, "outside.md"), "# Secret\n");
      await workspace.createSymlink(".planning/todos", external);
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.some((item) => item.kind === "todo")).toBe(false);
      expect(inventory.problems).toContainEqual({ kind: "todo", warning: "containment-refused" });
      expect(inventory.watchDirectories).not.toContain("todos");
      expect(inventory.warnings).not.toContain("containment-refused");
      expect(JSON.stringify(inventory)).not.toContain(external);
      expect(JSON.stringify(inventory)).not.toContain("Secret");
    } finally {
      await workspace.cleanup();
      await rm(external, { recursive: true, force: true });
    }
  });

  it("reports unreadable TODO containers instead of treating denied directory access as absent", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/todos/pending/task.md", content: "# Private\n" },
    ]);
    const todosRoot = join(workspace.root, ".planning/todos");
    try {
      await chmod(todosRoot, 0o000);
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.watchDirectories).toContain("todos");
      expect(inventory.watchDirectories).not.toContain("todos/pending");
      expect(inventory.artifacts.some((item) => item.kind === "todo")).toBe(false);
      expect(inventory.problems).toContainEqual({ kind: "todo", warning: "unreadable" });
      expect(inventory.problems).not.toContainEqual({ kind: "todo", warning: "absent" });
      expect(inventory.warnings).not.toContain("unreadable");
      expect(inventory.limited).toBe(false);
    } finally {
      await chmod(todosRoot, 0o700);
      await workspace.cleanup();
    }
  });

  it("retains a validated child watch path when its listing is unreadable", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/todos/pending/task.md", content: "# Private\n" },
    ]);
    const pending = join(workspace.root, ".planning/todos/pending");
    try {
      await chmod(pending, 0o000);
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.watchDirectories).toEqual(["todos", "todos/pending"]);
      expect(inventory.artifacts.some((item) => item.kind === "todo")).toBe(false);
      expect(inventory.problems).toContainEqual({ kind: "todo", warning: "unreadable" });
      expect(inventory.problems).not.toContainEqual({ kind: "todo", warning: "absent" });
      expect(inventory.warnings).not.toContain("unreadable");
    } finally {
      await chmod(pending, 0o700);
      await workspace.cleanup();
    }
  });

  it("reads existing optional checks before TODOs and prioritizes active TODO buckets at the cap", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
      { path: ".planning/phases/01-current/01-VALIDATION.md", content: "status: draft\n" },
      { path: ".planning/todos/pending/blocker.md", content: "# Blocker\n" },
      { path: ".planning/todos/backlog/later.md", content: "# Later\n" },
      { path: ".planning/todos/deferred/deferred.md", content: "# Deferred\n" },
      ...Array.from({ length: 129 }, (_, index) => ({ path: `.planning/todos/${String(index).padStart(3, "0")}.md`, content: "# Root\n" })),
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      const kinds = inventory.artifacts.map((item) => item.kind);
      expect(kinds.indexOf("validation")).toBeLessThan(kinds.indexOf("todo"));
      const todoKeys = inventory.artifacts.filter((item) => item.kind === "todo").map((item) => item.key);
      expect(todoKeys).toHaveLength(128);
      expect(todoKeys.slice(0, 3)).toEqual(["todos/pending/blocker.md", "todos/backlog/later.md", "todos/deferred/deferred.md"]);
      expect(inventory.problems).toContainEqual({ kind: "todo", warning: "limit-reached" });
      expect(inventory.warnings).not.toContain("limit-reached");
    } finally { await workspace.cleanup(); }
  });

  it("caps optional TODO count and bytes without changing global limited state", async () => {
    const files = Array.from({ length: 130 }, (_, index) => ({ path: `.planning/todos/pending/${String(index).padStart(3, "0")}.md`, content: "# TODO\n" }));
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }, ...files]);
    try {
      const capped = await readAllowedInventory(workspace.root);
      expect(capped.artifacts.filter((item) => item.kind === "todo")).toHaveLength(128);
      expect(capped.problems).toContainEqual({ kind: "todo", warning: "limit-reached" });
      expect(capped.limited).toBe(false);
      expect(capped.warnings).not.toContain("limit-reached");
    } finally { await workspace.cleanup(); }
    const large = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      ...Array.from({ length: 9 }, (_, index) => ({ path: `.planning/todos/pending/${index}.md`, content: "x".repeat(250 * 1024) })),
    ]);
    try {
      const capped = await readAllowedInventory(large.root);
      expect(capped.artifacts.filter((item) => item.kind === "todo")).toHaveLength(8);
      expect(capped.problems).toContainEqual({ kind: "todo", warning: "observation-limited" });
      expect(capped.warnings).not.toContain("observation-limited");
      expect(capped.limited).toBe(false);
    } finally { await large.cleanup(); }
  });

  it("preserves the 8 MB snapshot cap across mandatory files, optional checks, and TODOs", async () => {
    const content = "x".repeat(250 * 1024);
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
      ...Array.from({ length: 29 }, (_, index) => ({ path: `.planning/phases/01-current/01-${String(index).padStart(2, "0")}-PLAN.md`, content })),
      { path: ".planning/phases/01-current/01-VALIDATION.md", content },
      ...Array.from({ length: 4 }, (_, index) => ({ path: `.planning/todos/pending/${index}.md`, content })),
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.filter((item) => item.kind === "plan")).toHaveLength(29);
      expect(inventory.artifacts.filter((item) => item.kind === "validation")).toHaveLength(1);
      expect(inventory.artifacts.filter((item) => item.kind === "todo")).toHaveLength(2);
      expect(inventory.artifacts.reduce((total, item) => total + item.size, 0)).toBeLessThanOrEqual(LIMITS.bytesPerSnapshot);
      expect(inventory.problems).toContainEqual({ kind: "todo", warning: "observation-limited" });
      expect(inventory.warnings).not.toContain("observation-limited");
      expect(inventory.limited).toBe(false);
    } finally { await workspace.cleanup(); }
  });
});

describe("readAllowedInventory debug sessions", () => {
  const debugKeys = (inventory: Awaited<ReturnType<typeof readAllowedInventory>>) => (inventory.debugArtifacts ?? []).map((item) => item.key);

  it("reads direct debug Markdown from the active directory and its resolved archive into its own list", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/debug/login-mobile-comb-falha.md", content: "---\nstatus: awaiting_human_verify\n---\n" },
      { path: ".planning/debug/knowledge-base.md", content: "# GSD Debug Knowledge Base\n" },
      { path: ".planning/debug/58-06-red-evidence.json", content: "{}" },
      { path: ".planning/debug/resolved/civil-servant-outro-orgao.md", content: "---\nstatus: resolved\n---\n" },
      { path: ".planning/debug/resolved/nested/hidden.md", content: "not direct" },
      { path: ".planning/debug/other/hidden.md", content: "wrong folder" },
      { path: ".planning/debug/.hidden.md", content: "hidden" },
      { path: ".planning/debug/bad name.md", content: "not a slug" },
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      expect(debugKeys(inventory)).toEqual(["debug/knowledge-base.md", "debug/login-mobile-comb-falha.md", "debug/resolved/civil-servant-outro-orgao.md"]);
      expect(inventory.debugArtifacts?.every((item) => item.kind === "debug" && !item.phaseId)).toBe(true);
      expect(inventory.artifacts.some((item) => item.kind === "debug" || item.key.startsWith("debug/"))).toBe(false);
      expect(inventory.watchDirectories).toEqual(expect.arrayContaining(["debug", "debug/resolved"]));
      expect(inventory.watchDirectories).not.toContain("debug/other");
      expect(inventory.problems).not.toContainEqual(expect.objectContaining({ kind: "debug" }));
      const board = buildBoardSnapshot({ workspaceId: "selected", inventory, observedAt: "2026-09-25T00:00:00.000Z" });
      expect(JSON.stringify(board)).not.toContain(workspace.root);
      expect(JSON.stringify(board)).not.toContain("debug/resolved/");
      expect(JSON.stringify(board)).not.toContain(".md");
    } finally { await workspace.cleanup(); }
  });

  it("distinguishes an absent debug directory from an absent archive without changing Legacy status", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "# Roadmap\n" }]);
    try {
      const absent = await readAllowedInventory(workspace.root);
      expect(absent.problems).toContainEqual({ kind: "debug", warning: "absent" });
      expect(absent.watchDirectories).not.toContain("debug");
      await mkdir(join(workspace.root, ".planning/debug"));
      const empty = await readAllowedInventory(workspace.root);
      expect(empty.watchDirectories).toContain("debug");
      expect(empty.watchDirectories).not.toContain("debug/resolved");
      expect(empty.problems).not.toContainEqual(expect.objectContaining({ kind: "debug" }));
      expect(empty.warnings).toEqual(absent.warnings);
      expect(empty.limited).toBe(absent.limited);
    } finally { await workspace.cleanup(); }
  });

  it("refuses debug symlinks, oversized content, and invalid UTF-8 locally", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      { path: ".planning/debug/huge.md", content: "x".repeat(LIMITS.bytesPerFile + 1) },
      { path: ".planning/debug/safe.md", content: "---\nstatus: investigating\n---\n" },
    ]);
    const external = await mkdtemp(join(tmpdir(), "paseo-debug-external-"));
    try {
      await writeFile(join(external, "outside.md"), "---\nstatus: resolved\n---\nSecret\n");
      await workspace.createSymlink(".planning/debug/linked.md", "/etc/passwd");
      await workspace.createSymlink(".planning/debug/resolved", external);
      await writeFile(join(workspace.root, ".planning/debug/invalid.md"), new Uint8Array([0xff]));
      const inventory = await readAllowedInventory(workspace.root);
      expect(debugKeys(inventory)).toEqual(["debug/safe.md"]);
      expect(inventory.problems).toEqual(expect.arrayContaining([
        { kind: "debug", warning: "oversize" }, { kind: "debug", warning: "malformed" }, { kind: "debug", warning: "containment-refused" },
      ]));
      expect(inventory.watchDirectories).not.toContain("debug/resolved");
      expect(inventory.warnings).not.toContain("oversize");
      expect(inventory.warnings).not.toContain("containment-refused");
      expect(inventory.limited).toBe(false);
      expect(JSON.stringify(inventory)).not.toContain(external);
      expect(JSON.stringify(inventory)).not.toContain("Secret");
    } finally {
      await workspace.cleanup();
      await rm(external, { recursive: true, force: true });
    }
  });

  it("keeps its own byte and file budget after phase evidence has used the snapshot budget", async () => {
    const content = "x".repeat(250 * 1024);
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Current\n" },
      ...Array.from({ length: 33 }, (_, index) => ({ path: `.planning/phases/01-current/01-${String(index).padStart(2, "0")}-PLAN.md`, content })),
      ...Array.from({ length: 13 }, (_, index) => ({ path: `.planning/debug/session-${String(index).padStart(2, "0")}.md`, content: `---\nstatus: investigating\n---\n${content}` })),
    ]);
    try {
      const inventory = await readAllowedInventory(workspace.root);
      expect(inventory.artifacts.reduce((total, item) => total + item.size, 0)).toBeLessThanOrEqual(LIMITS.bytesPerSnapshot);
      expect(inventory.artifacts.filter((item) => item.kind === "plan").length).toBeLessThan(33);
      expect(inventory.problems).toContainEqual(expect.objectContaining({ phaseId: "1", warning: "observation-limited" }));
      // Twelve 250 KB sessions fit the 3 MB debug budget; the thirteenth is reported, not silently dropped.
      expect(inventory.debugArtifacts).toHaveLength(12);
      expect(inventory.problems).toContainEqual({ kind: "debug", warning: "observation-limited" });
    } finally { await workspace.cleanup(); }
    const many = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "# Roadmap\n" },
      ...Array.from({ length: 161 }, (_, index) => ({ path: `.planning/debug/${String(index).padStart(3, "0")}.md`, content: "---\nstatus: resolved\n---\n" })),
      { path: ".planning/debug/resolved/archived.md", content: "---\nstatus: resolved\n---\n" },
    ]);
    try {
      const capped = await readAllowedInventory(many.root);
      expect(capped.debugArtifacts).toHaveLength(160);
      expect(capped.problems).toContainEqual({ kind: "debug", warning: "limit-reached" });
      expect(capped.warnings).not.toContain("limit-reached");
      expect(capped.limited).toBe(false);
    } finally { await many.cleanup(); }
  });
});
