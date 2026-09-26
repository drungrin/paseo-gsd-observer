import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: vi.fn((value: unknown) => [value, vi.fn()]) };
});

import { useState } from "react";
import { matchedTodos, TodosView } from "../../client/todos-components";
import type { BoardViewState } from "../../client/board-components";
import type { BoardTodos, TodoItem } from "../../shared/todos";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const item = (overrides: Partial<TodoItem> = {}): TodoItem => ({ directory: "pending", lifecycle: "pending", recordedStatus: null, statusConflict: false, duplicateName: false, title: "Check public link on a real device", summary: "A person still needs to observe the flow.", area: "web", createdAt: "2026-08-01", completedAt: null, phaseId: null, severity: "high", priority: null, ...overrides });
const data = (): BoardTodos => ({ availability: "available", directoryState: "observed", countsComplete: true, limited: false,
  items: [item({ duplicateName: true }), item({ directory: "backlog", lifecycle: "backlog", title: "Keep the follow-up for a later milestone", recordedStatus: "open", statusConflict: true, duplicateName: true, severity: "minor", area: null }),
    item({ directory: "completed", lifecycle: "completed", title: "Check hydration behavior", summary: null, area: "ui", severity: null, priority: "medium", completedAt: "2026-09-02", phaseId: "11" }),
    item({ directory: "root", lifecycle: "root-unclassified", title: "PR validation", summary: "Resume when the policy is approved.", recordedStatus: "deferred", severity: null, area: null })],
  counts: { pending: 1, backlog: 1, deferred: 0, done: 0, completed: 1, root: 1, totalFiles: 4, distinctTasks: 3, unavailable: 0, duplicates: 2, conflicts: 1, displayed: 4 } });
const state = (todos = data()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { todos } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as Node;
  return [value, ...nodes(value.props?.children)];
};
const text = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node !== "object") return "";
  return text((node as Node).props?.children);
};
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Node;
  if (typeof value.type === "function") return expand((value.type as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
const view = (todos?: BoardTodos, compact = false) => expand(TodosView({ state: state(todos), theme, compact, onRefresh: vi.fn() }));

describe("TODO tab", () => {
  it("lists standalone files project-wide with physical counts and distinct-name/recorded-status caveats", () => {
    const tree = view();
    const content = text(tree);
    expect(content).toContain("Standalone planning TODO files for this workspace. Read-only");
    expect(content).toContain("4 files safely read · 3 distinct filenames · 4 safe cards shown.");
    const single = data(); single.items = [single.items[0]]; single.counts = { ...single.counts, totalFiles: 1, distinctTasks: 1, displayed: 1, duplicates: 0, conflicts: 0 };
    expect(text(view(single))).toContain("1 record matches the current filters.");
    expect(content).toContain("2 files share names across folders · 1 folder/status disagreement.");
    expect(content).toContain("Folder counts exclude unreadable files and are not inferred work states.");
    expect(content).toContain("Recorded status disagrees with the folder; both are shown without changing the task.");
    expect(content).toContain("Another TODO file has the same name in a different folder; both records are shown.");
    expect(content).toContain("Recorded status: deferred");
    expect(content).toContain("Severity: high");
    expect(content).toContain("Priority: medium");
    expect(content).toContain("Related phase: 11");
    expect(content).toContain("Completed: 2026-09-02");
    expect(content).not.toContain("Create TODO");
    expect(content).not.toContain("Delete");
    const facts = nodes(tree).filter((node) => node.props?.accessible).map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(["Pending folder: 1", "Backlog / deferred folders: 1", "Done / completed folders: 1", "Root-level files: 1"]);
    const filters = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Filter:"));
    expect(filters.map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: All", "Filter: Pending", "Filter: Backlog", "Filter: Completed", "Filter: Unclassified", "Filter: Any importance", "Filter: high", "Filter: medium", "Filter: minor"]);
    expect(filters[0].props).toMatchObject({ accessibilityState: { selected: true }, "aria-pressed": true });
  });

  it("filters by lifecycle and either recorded severity or priority without turning root status into directory placement", () => {
    const source = data();
    expect(matchedTodos(source, "pending", "all")).toHaveLength(1);
    expect(matchedTodos(source, "backlog", "all").map((entry) => entry.directory)).toEqual(["backlog"]);
    expect(matchedTodos(source, "root-unclassified", "all").map((entry) => entry.recordedStatus)).toEqual(["deferred"]);
    expect(matchedTodos(source, "all", "medium").map((entry) => entry.title)).toEqual(["Check hydration behavior"]);
    expect(matchedTodos(source, "pending", "minor")).toEqual([]);
    // None of the source files is overwritten by selecting a filter.
    expect(source.items).toHaveLength(4);
  });

  it("keeps the clear-importance control reachable when a refresh removes the selected value", () => {
    vi.mocked(useState).mockImplementationOnce(((value: unknown) => [{ workspaceId: "selected", lifecycle: "all", importance: "high" }, vi.fn()]) as unknown as typeof useState);
    const changed = data(); changed.items = changed.items.map((entry) => ({ ...entry, severity: null, priority: null }));
    const tree = view(changed);
    expect(text(tree)).toContain("No safe TODO cards match these filters.");
    const reset = nodes(tree).find((node) => node.props?.accessibilityLabel === "Filter: Any importance");
    expect(reset?.props).toMatchObject({ accessibilityState: { selected: false }, "aria-pressed": false });
    expect(typeof reset?.props?.onPress).toBe("function");
  });

  it("distinguishes absent and empty directories, unknown evidence, local failures, caps, loading and stale snapshots", () => {
    const empty = data(); empty.items = []; empty.counts = { pending: 0, backlog: 0, deferred: 0, done: 0, completed: 0, root: 0, totalFiles: 0, distinctTasks: 0, unavailable: 0, duplicates: 0, conflicts: 0, displayed: 0 };
    empty.directoryState = "absent";
    expect(text(view(empty))).toContain("No .planning/todos directory was observed for this workspace.");
    empty.directoryState = "observed";
    expect(text(view(empty))).toContain("The observed TODO directory has no allowlisted files.");
    empty.directoryState = "unknown";
    expect(text(view(empty))).toContain("No TODO files were observed; the directory state is unknown.");
    const limited = data(); limited.limited = true; limited.counts.unavailable = 2; limited.counts.displayed = 3;
    expect(text(view(limited))).toContain("The TODO inventory or its safe excerpts are incomplete; counts cover only observed files.");
    limited.countsComplete = false;
    expect(text(view(limited))).toContain("At least 4 files safely read");
    expect(text(view(limited))).toContain("2 TODO observations unavailable");
    const unreadable = { ...empty, directoryState: "observed" as const, limited: true, counts: { ...empty.counts, unavailable: 1 } };
    expect(text(view(unreadable))).toContain("TODO files or directories could not be safely inspected; no records are shown.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(TodosView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading TODOs…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(expand(TodosView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Refresh to update TODOs.");
    expect(text(view({ ...data(), availability: "unavailable" }))).toContain("No readable planning inventory was found for this workspace.");
  });
});
