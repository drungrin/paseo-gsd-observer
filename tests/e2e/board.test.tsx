import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  FlatList: "FlatList",
}));
import { BoardView, createBoardController } from "../../index.client";
import { createBoardService } from "../../index.server";
import { boardRpc } from "../../shared/board-rpc";
import { fixtureFiles } from "../fixtures/gsd-fixtures";
import { FakeHost } from "../helpers/fake-host";
import { FixtureWorkspace } from "../helpers/fixture-workspace";
import { FakeWatcher } from "../helpers/fake-watcher";

const nodes = (node: unknown): Array<{ props?: Record<string, unknown> }> => {
  if (!node || typeof node !== "object") return [];
  const value = node as { props?: Record<string, unknown> };
  const children = value.props?.children;
  return [value, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
};

describe("board tracer", () => {
  it("uses the same safe board in a compact layout with compact spacing", () => {
    const view = BoardView({
      state: { workspaceId: "selected", snapshot: null, busy: false, error: null },
      onRefresh: () => undefined,
      theme: { colors: { surface0: "#000", foreground: "#fff", foregroundMuted: "#aaa", accent: "#0af", accentForeground: "#000" } },
      compact: true,
    } as Parameters<typeof BoardView>[0] & { compact: true });
    expect((view.props as { style: { padding: number } }).style.padding).toBe(8);
  });

  it("keeps the refresh-to-plan evidence path reachable in wide and compact layouts", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const host = new FakeHost();
    host.registerWorkspace("selected", workspace.root);
    const service = createBoardService({ resolveWorkspace: async (id) => host.resolveWorkspace(id) });
    host.handle(boardRpc, (input) => service.handle(input as never));
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: (input) => host.invoke(boardRpc, input, "selected") });
    await controller.dispatch("refresh");
    const milestone = controller.getState().snapshot?.milestones.find((item) => !item.archived);
    const phase = milestone?.phases[0];
    const plan = phase?.plans[0];
    expect(milestone && phase && plan).toBeTruthy();
    if (!milestone || !phase || !plan) throw new Error("fixture has no observable phase plan");
    controller.selectPhase(milestone.id, phase.id);
    controller.togglePlans(milestone.id, phase.id);
    controller.selectPlan(milestone.id, plan.id);
    for (const compact of [false, true]) {
      const view = BoardView({ state: controller.getState(), onRefresh: () => undefined, compact, inspectedPlanId: plan.id, theme: { colors: { surface0: "#000", foreground: "#fff", foregroundMuted: "#aaa", accent: "#0af", accentForeground: "#000" } } });
      expect(nodes(view).some((node) => node.props?.accessibilityLabel === `Phase detail ${phase.phaseId}`)).toBe(true);
      expect(nodes(view).some((node) => node.props?.accessibilityLabel === "Plan details side panel")).toBe(true);
      expect(nodes(view).some((node) => (node.props?.style as { flexDirection?: string } | undefined)?.flexDirection === (compact ? "column" : "row"))).toBe(true);
      expect(nodes(view).find((node) => node.props?.accessibilityLabel === "Phase navigation")?.props?.style).toMatchObject({ flex: 1, minWidth: 0 });
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
    await controller.dispatch("refresh");
    expect(controller.getState().snapshot?.milestones[0]).toMatchObject({ id: "2.2", title: "Early" });
    expect(controller.getState().snapshot?.milestones.find((milestone) => milestone.archived)).toMatchObject({ id: "archive:v0.1", title: "Arquivo v0.1" });
    await controller.dispatch("archive", "archive:v0.1");
    expect(controller.getState().snapshot?.milestones.find((milestone) => milestone.id === "archive:v0.1")?.phases).toHaveLength(1);
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
    const view = BoardView({ state: { workspaceId: "selected", snapshot: first.snapshot, busy: false, error: null }, onRefresh: () => { refreshes += 1; }, theme: { colors: { surface0: "#000", foreground: "#fff", foregroundMuted: "#aaa", accent: "#0af", accentForeground: "#000" } } });
    const button = nodes(view).find((node) => node.props?.label === "Refresh");
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
    releaseA?.({ kind: "snapshot", snapshot: { workspaceId: "A", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, milestones: [], warnings: [], limited: false } });
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
