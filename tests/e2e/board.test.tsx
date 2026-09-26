import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  FlatList: "FlatList",
  Platform: { OS: "web" },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});
import { createBoardController } from "../../index.client";
import { OverviewView } from "../../client/overview-components";
import { PlansView } from "../../client/plans-components";
import { createBoardService } from "../../index.server";
import { boardRpc } from "../../shared/board-rpc";
import { fixtureFiles } from "../fixtures/gsd-fixtures";
import { FakeHost } from "../helpers/fake-host";
import { FixtureWorkspace } from "../helpers/fixture-workspace";
import { FakeWatcher } from "../helpers/fake-watcher";

const theme = { colors: { surface0: "#000", foreground: "#fff", foregroundMuted: "#aaa", accent: "#0af", accentForeground: "#000" } };
type Node = { type?: unknown; props?: Record<string, unknown> };
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Node;
  if (typeof value.type === "function") return expand((value.type as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
const nodes = (node: unknown): Node[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as Node;
  return [value, ...nodes(value.props?.children)];
};
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";

describe("board tracer", () => {
  it("keeps the refresh-to-plan evidence path reachable in wide and compact layouts", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.3-contracts/59.3-01-PLAN.md", content: "---\nphase: 59.3-contracts\nplan: \"01\"\n---\n# Plan 01: Contract registry\n" },
    ]);
    const host = new FakeHost();
    host.registerWorkspace("selected", workspace.root);
    const service = createBoardService({ resolveWorkspace: async (id) => host.resolveWorkspace(id) });
    host.handle(boardRpc, (input) => service.handle(input as never));
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: (input) => host.invoke(boardRpc, input, "selected") });
    await controller.dispatch("refresh");
    expect(controller.getState().snapshot?.overview?.plans.phases.map((phase) => phase.id)).toEqual(["59.3"]);
    for (const compact of [false, true]) {
      const content = text(expand(PlansView({ state: controller.getState(), onRefresh: () => undefined, theme, compact })));
      expect(content).toContain("Contract registry");
    }
    controller.dispose();
    await service.close();
    await workspace.cleanup();
  });

  it("reads a real selected workspace only after the refresh intent", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const host = new FakeHost();
    host.registerWorkspace("selected", workspace.root);
    const service = createBoardService({ resolveWorkspace: async (id) => host.resolveWorkspace(id) });
    host.handle(boardRpc, (input) => service.handle(input as never));
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: (input) => host.invoke(boardRpc, input, "selected") });
    expect(controller.getState().snapshot).toBeNull();
    await controller.dispatch("refresh");
    expect(controller.getState().snapshot).toMatchObject({ workspaceId: "selected", availability: "available", freshness: "current" });
    // Archived milestones are no longer read or published.
    expect(JSON.stringify(controller.getState().snapshot)).not.toMatch(/Archived roadmap|Archived phase|v0\.1/);
    await expect(host.invoke(boardRpc, { workspaceId: "selected", intent: "archive", milestoneId: "archive:v0.1" }, "selected")).rejects.toBeDefined();
    await expect(host.invoke(boardRpc, { workspaceId: "selected", intent: "refresh", root: workspace.root }, "selected")).rejects.toBeDefined();
    await service.close();
    await workspace.cleanup();
  });

  it("keeps observed evidence on watcher invalidation until a visible manual refresh", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const watcher = new FakeWatcher();
    const service = createBoardService({ resolveWorkspace: async () => workspace.root, watcherFactory: () => watcher, clock: () => new Date("2026-09-13T12:00:00.000Z") });
    const first = await service.handle({ workspaceId: "selected", intent: "refresh" });
    expect(first.kind).toBe("snapshot");
    if (first.kind !== "snapshot") throw new Error("expected a snapshot");
    watcher.emitChange(".planning/ROADMAP.md");
    const status = await service.handle({ workspaceId: "selected", intent: "status" });
    expect(status).toMatchObject({ freshness: "stale", observedAt: first.snapshot.observedAt });
    let refreshes = 0;
    const view = expand(OverviewView({ state: { workspaceId: "selected", snapshot: { ...first.snapshot, freshness: "stale" }, busy: false, error: null }, onRefresh: () => { refreshes += 1; }, theme, showTable: false, onToggleTable: () => undefined }));
    expect(text(view)).toContain("Refresh");
    const button = nodes(view).find((node) => node.props?.accessibilityLabel === "Refresh overview");
    (button?.props?.onPress as (() => void) | undefined)?.();
    expect(refreshes).toBe(1);
    await service.close();
    await workspace.cleanup();
  });

  it("does not publish a late response after the selected workspace changes", async () => {
    let releaseA: ((response: Awaited<ReturnType<typeof boardRpc.output.parseAsync>>) => void) | undefined;
    const controller = createBoardController({
      workspaceId: "A",
      callBoardRpc: () => new Promise((resolve) => { releaseA = resolve; }),
    });
    const pending = controller.dispatch("refresh");
    expect(typeof (controller as unknown as { setWorkspace?: unknown }).setWorkspace).toBe("function");
    (controller as unknown as { setWorkspace(workspaceId: string): void }).setWorkspace("B");
    releaseA?.({ kind: "snapshot", snapshot: { workspaceId: "A", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false } });
    await pending;
    expect(controller.getState()).toMatchObject({ workspaceId: "B", snapshot: null });
    controller.dispose();
  });

  it("keeps client and shared imports inside the read-only plugin boundary", async () => {
    const files = ["index.client.tsx", "client/board-panel.tsx", "client/board-components.tsx", "client/board-state.ts", "shared/board-rpc.ts"];
    const sources = await Promise.all(files.map(async (file) => ({ file, source: await readFile(file, "utf8") })));
    for (const { file, source } of sources) {
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const imports = parsed.statements.filter(ts.isImportDeclaration).map((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "");
      expect(imports.some((specifier) => /^(?:node:|fs$|path$|child_process$)/.test(specifier))).toBe(false);
      expect(source).not.toMatch(/\b(?:addLifecycle|addProvider|addTerminal|before\s*\()/);
    }
    expect(sources.find(({ file }) => file === "index.client.tsx")?.source).toContain("addWorkspacePanel");
    expect(sources.find(({ file }) => file === "index.client.tsx")?.source).toContain('title: "Open GSD Board"');
  });
});
