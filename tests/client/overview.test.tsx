import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));

import { BoardTabs, tabForKey } from "../../client/board-tabs";
import { OverviewView, ProgressMeter, planCountLabel, statusLabel } from "../../client/overview-components";
import type { BoardOverview } from "../../shared/overview";
import type { BoardViewState } from "../../client/board-components";
import { phaseChecks } from "../helpers/phase-checks";

const theme = { colors: { surface0: "#ffffff", surface1: "#f9fafb", surface2: "#f0f2f5", foreground: "#16181d", foregroundMuted: "#56606d", accent: "#2a78d6", accentForeground: "#ffffff", border: "#d9dfe6" } };
const overview = (): BoardOverview => ({
  state: { availability: "available", milestone: "v2.0", milestoneName: "Contract management", phaseId: "59.3", phaseName: "Independent registrations and explicit confirmation", status: "Executing Phase 59.3", plan: "17 of 24", lastActivity: "2026-09-24 — resumed execution", updatedAt: "2026-09-25T01:33:27.753Z" },
  roadmap: { availability: "available", completedPhases: 4, totalPhases: 10, percent: 40, phases: [
    { id: "59.2", title: "Contract foundation", completed: true, current: false, completedPlans: 6, totalPlans: 6, percent: 100 },
    { id: "59.3", title: "Contract management", completed: false, current: true, completedPlans: 18, totalPlans: 24, percent: 75 },
    { id: "60", title: "Billing", completed: false, current: false, completedPlans: 0, totalPlans: null, percent: null },
  ] },
  requirements: { availability: "available", completed: 15, total: 41, percent: 37, mapped: 41 },
  plans: { availability: "available", observedPlans: 4, observedSummaries: 2, limited: false, phases: [
    { id: "59.2", title: "Contract foundation", current: false, declaredPlans: 6, entries: [], checks: phaseChecks() },
    { id: "59.3", title: "Contract management", current: true, declaredPlans: 24, entries: [
      { id: "59.3-23", number: "23", title: "Supplier regression", objective: "Exercise existing supplier flows.", wave: 11, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-17", number: "17", title: "Independent registry help", objective: "Update the six help guides.", wave: 14, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-18", number: "18", title: "Browser certification", objective: "Validate the browser journeys.", wave: 15, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-24", number: "24", title: null, objective: null, wave: 17, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
    ], checks: phaseChecks(true) },
    { id: "60", title: "Billing", current: false, declaredPlans: null, entries: [], checks: phaseChecks() },
  ] },
  context: { availability: "available", phases: [], limited: false },
  validation: { availability: "available", phases: [], limited: false },
  uat: { availability: "available", phases: [], limited: false },
  verification: { availability: "available", phases: [], limited: false },
  todos: { availability: "available", directoryState: "absent", countsComplete: true, items: [], counts: { pending: 0, backlog: 0, deferred: 0, done: 0, completed: 0, root: 0, totalFiles: 0, distinctTasks: 0, unavailable: 0, duplicates: 0, conflicts: 0, displayed: 0 }, limited: false },
  parkingLot: { availability: "available", section: "absent", items: [], counts: { recorded: 0, parked: 0, absorbed: 0, promoted: 0, reconciliation: 0, other: 0, displayed: 0 }, limited: false },
  debug: { availability: "available", directoryState: "absent", archiveState: "absent", sessions: [], countsComplete: true, limited: false, counts: { active: 0, archived: 0, attention: 0, unresolved: 0, open: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 0, unclassified: 0, reconciliation: 0, unavailable: 0, knowledgeBase: 0, notes: 0, displayed: 0 } },
  warnings: [],
});
const state = (value: BoardOverview | undefined = overview()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: { workspaceId: "selected", observedAt: "2026-09-25T01:34:00.000Z", freshness: "current", availability: "unknown", revision: 1, warnings: [], limited: false, overview: value } });
const nodes = (node: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as { type?: unknown; props?: Record<string, unknown> };
  return [value, ...nodes(value.props?.children)];
};
const textContent = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!node || typeof node !== "object") return "";
  return textContent((node as { props?: { children?: unknown } }).props?.children);
};

describe("Overview", () => {
  it("shows three English cards independently of Legacy classifications", () => {
    const tree = OverviewView({ state: state(), theme, onRefresh: vi.fn() });
    const text = textContent(tree);
    expect(text).toContain("StateSTATE.md");
    expect(text).toContain("Roadmap ProgressROADMAP.md");
    expect(text).toContain("RequirementsREQUIREMENTS.md");
    expect(text).toContain("41 requirements");
    expect(text).toContain("15 of 41 marked complete37%");
    expect(text).toContain("26 pending · 41 of 41 mapped to phases");
    expect(text).toContain("Checklist status only; not independent verification");
    expect(text.indexOf("StateSTATE.md")).toBeLessThan(text.indexOf("RequirementsREQUIREMENTS.md"));
    expect(text.indexOf("RequirementsREQUIREMENTS.md")).toBeLessThan(text.indexOf("Roadmap ProgressROADMAP.md"));
    expect(text).toContain("v2.0");
    expect(text).toContain("Phase 59.3");
    expect(text).toContain("Executing");
    expect(text).toContain("17 of 24");
    expect(text).toContain("4 of 10 phases complete40%");
    expect(text).toContain("18 / 24 plans");
    expect(text).toContain("75%");
    expect(text).toContain("0 plans completed · total TBD");
    expect(text).not.toContain("Current roadmap");
    expect(text).not.toContain("No observable GSD planning");
    expect(nodes(tree).filter((node) => node.type === ProgressMeter).map((node) => node.props?.percent)).toEqual([37, 40, 100, 75]);
  });

  it("keeps State and Roadmap availability independent", () => {
    const data = overview();
    data.state.availability = "unavailable";
    let text = textContent(OverviewView({ state: state(data), theme, onRefresh: vi.fn() }));
    expect(text).toContain("State unavailable");
    expect(text).toContain("4 of 10 phases complete40%");
    data.state.availability = "available";
    data.roadmap.availability = "unavailable";
    text = textContent(OverviewView({ state: state(data), theme, onRefresh: vi.fn() }));
    expect(text).toContain("Roadmap unavailable");
    expect(text).toContain("Phase 59.3");
    expect(text).not.toContain("4 of 10 phases complete");
  });

  it("keeps requirements independent and avoids percentages for unavailable or empty checklists", () => {
    const data = overview();
    data.requirements = { availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null };
    let tree = OverviewView({ state: state(data), theme, onRefresh: vi.fn() });
    expect(textContent(tree)).toContain("Requirements unavailable");
    expect(textContent(tree)).toContain("4 of 10 phases complete40%");
    expect(nodes(tree).filter((node) => node.type === ProgressMeter).map((node) => node.props?.percent)).toEqual([40, 100, 75]);

    data.requirements = { availability: "available", completed: 0, total: 0, percent: null, mapped: null };
    tree = OverviewView({ state: state(data), theme, onRefresh: vi.fn() });
    expect(textContent(tree)).toContain("No requirements declared for this milestone.");
    expect(textContent(tree)).not.toContain("0 of 0 marked complete");
    expect(nodes(tree).filter((node) => node.type === ProgressMeter).map((node) => node.props?.percent)).toEqual([40, 100, 75]);
  });

  it("provides a text data view with the same values and no progress marks", () => {
    const onToggleTable = vi.fn();
    const tree = OverviewView({ state: state(), theme, onRefresh: vi.fn(), showTable: true, onToggleTable });
    const tableComponent = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "RoadmapTable");
    const table = (tableComponent?.type as (props: unknown) => unknown)(tableComponent?.props);
    expect(textContent(table)).toContain("18 / 24 plans");
    expect(textContent(table)).toContain("75%");
    expect(nodes(table).some((node) => node.props?.accessibilityLabel === "Roadmap progress data table")).toBe(true);
    expect(nodes(table).filter((node) => node.props?.role === "row")).toHaveLength(4);
    expect(nodes(tree).filter((node) => node.type === ProgressMeter).map((node) => node.props?.percent)).toEqual([37]);
    const toggle = nodes(tree).find((node) => node.props?.accessibilityLabel === "Show progress bars");
    (toggle?.props?.onPress as () => void)();
    expect(onToggleTable).toHaveBeenCalledOnce();
  });

  it("holds existing content during refresh and labels stale evidence", () => {
    const current = state();
    current.busy = true;
    current.error = "refresh failed";
    current.snapshot!.freshness = "stale";
    const tree = OverviewView({ state: current, theme, onRefresh: vi.fn() });
    expect(textContent(tree)).toContain("4 of 10 phases complete40%");
    expect(textContent(tree)).toContain("The last snapshot is still displayed.");
    expect(textContent(tree)).toContain("Planning files may have changed.");
    const refresh = nodes(tree).find((node) => node.props?.accessibilityLabel === "Refreshing overview");
    expect(refresh?.props?.disabled).toBe(true);
  });

  it("handles first load, no planning, and explicit refresh without manufacturing progress", () => {
    const onRefresh = vi.fn();
    const empty = { workspaceId: "empty", snapshot: null, busy: true, error: null };
    expect(textContent(OverviewView({ state: empty, theme, onRefresh }))).toContain("Loading project overview…");
    const tree = OverviewView({ state: { ...empty, busy: false }, theme, onRefresh });
    expect(textContent(tree)).toContain("State unavailable");
    expect(textContent(tree)).toContain("Roadmap unavailable");
    expect(textContent(tree)).toContain("Requirements unavailable");
    expect(textContent(tree)).not.toContain("100%");
    (nodes(tree).find((node) => node.props?.accessibilityLabel === "Refresh overview")?.props?.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("stacks cards in compact layouts and discloses conflicting counts", () => {
    const data = overview();
    data.warnings = ["plan-count-conflict"];
    const tree = OverviewView({ state: state(data), compact: true, theme, onRefresh: vi.fn() });
    const cards = nodes(tree).find((node) => (node.props?.style as { gap?: number; alignItems?: string })?.gap === 20 && (node.props?.style as { alignItems?: string }).alignItems === "stretch");
    expect(cards?.props?.style).toMatchObject({ flexDirection: "column" });
    expect(textContent(tree)).toContain("Conflicting plan percentages are not shown.");
    const compactText = textContent(tree);
    expect(compactText.indexOf("StateSTATE.md")).toBeLessThan(compactText.indexOf("Roadmap ProgressROADMAP.md"));
    expect(compactText.indexOf("Roadmap ProgressROADMAP.md")).toBeLessThan(compactText.indexOf("RequirementsREQUIREMENTS.md"));
    expect(statusLabel(null)).toBe("Not recorded");
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(planCountLabel({ ...data.roadmap.phases[2], completedPlans: null })).toBe("Plans not declared");
  });
});

describe("internal board tabs", () => {
  const renderTabs = (activeTab: "overview" | "plans" | "context" | "validation" | "verification" | "uat" | "todos" | "parking" | "debug" = "overview") => {
    const onSelect = vi.fn();
    const overviewFocus = vi.fn();
    const plansFocus = vi.fn();
    const contextFocus = vi.fn();
    const validationFocus = vi.fn();
    const verificationFocus = vi.fn();
    const uatFocus = vi.fn();
    const todosFocus = vi.fn();
    const parkingFocus = vi.fn();
    const debugFocus = vi.fn();
    const tree = BoardTabs({ activeTab, focusedTab: null, onSelect, onFocus: vi.fn(), idPrefix: "test-board", tabRefs: { current: { overview: { focus: overviewFocus }, plans: { focus: plansFocus }, context: { focus: contextFocus }, validation: { focus: validationFocus }, verification: { focus: verificationFocus }, uat: { focus: uatFocus }, todos: { focus: todosFocus }, parking: { focus: parkingFocus }, debug: { focus: debugFocus } } }, theme, compact: false });
    return { tree, onSelect, overviewFocus, plansFocus, contextFocus, validationFocus, debugFocus, tabs: nodes(tree).filter((node) => node.props?.role === "tab") };
  };

  it("orders Overview first and Debug last with accessible panel relationships", () => {
    const { tabs, onSelect } = renderTabs();
    expect(tabs.map((tab) => tab.props?.accessibilityLabel)).toEqual(["Overview", "Plans", "Context", "Validation", "Verification", "UAT", "TODOs", "Parking Lot", "Debug"]);
    expect(tabs[0].props).toMatchObject({ tabIndex: 0, accessibilityState: { selected: true }, "aria-selected": true, "aria-controls": "test-board-panel-overview" });
    expect(tabs[1].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-plans" });
    expect(tabs[2].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-context" });
    expect(tabs[3].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-validation" });
    expect(tabs[4].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-verification" });
    expect(tabs[5].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-uat" });
    expect(tabs[6].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-todos" });
    expect(tabs[7].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-parking" });
    expect(tabs[8].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-debug" });
    expect(tabs).toHaveLength(9);
    (tabs[1].props?.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith("plans");
    expect(renderTabs("plans").tabs[1].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("context").tabs[2].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("validation").tabs[3].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("verification").tabs[4].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("uat").tabs[5].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("todos").tabs[6].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("parking").tabs[7].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("debug").tabs[8].props?.accessibilityState).toEqual({ selected: true });
  });

  it("supports arrow, Home and End navigation with keyboard focus", () => {
    const { tabs, onSelect, plansFocus } = renderTabs();
    const preventDefault = vi.fn();
    (tabs[0].props?.onKeyDown as (event: unknown) => void)({ key: "ArrowRight", preventDefault });
    expect(onSelect).toHaveBeenCalledWith("plans");
    expect(plansFocus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(tabForKey("plans", "ArrowRight")).toBe("context");
    expect(tabForKey("context", "ArrowLeft")).toBe("plans");
    expect(tabForKey("context", "ArrowRight")).toBe("validation");
    expect(tabForKey("validation", "ArrowLeft")).toBe("context");
    expect(tabForKey("validation", "ArrowRight")).toBe("verification");
    expect(tabForKey("verification", "ArrowLeft")).toBe("validation");
    expect(tabForKey("verification", "ArrowRight")).toBe("uat");
    expect(tabForKey("uat", "ArrowLeft")).toBe("verification");
    expect(tabForKey("uat", "ArrowRight")).toBe("todos");
    expect(tabForKey("todos", "ArrowLeft")).toBe("uat");
    expect(tabForKey("todos", "ArrowRight")).toBe("parking");
    expect(tabForKey("parking", "ArrowLeft")).toBe("todos");
    expect(tabForKey("parking", "ArrowRight")).toBe("debug");
    expect(tabForKey("debug", "ArrowLeft")).toBe("parking");
    expect(tabForKey("debug", "ArrowRight")).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft")).toBe("debug");
    expect(tabForKey("debug", "Home")).toBe("overview");
    expect(tabForKey("overview", "End")).toBe("debug");
    expect(tabForKey("overview", "Tab")).toBeNull();
  });
});
