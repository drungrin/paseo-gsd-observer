import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { PlansView, planEvidenceLabel } from "../../client/plans-components";
import { PhaseChecks, checkLabel } from "../../client/phase-checks";
import type { BoardViewState } from "../../client/board-components";
import type { BoardOverview } from "../../shared/overview";
import { phaseChecks } from "../helpers/phase-checks";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4" } };
const plans = (): BoardOverview["plans"] => ({
  availability: "available", observedPlans: 4, observedSummaries: 2, limited: false,
  phases: [
    { id: "59.2", title: "Contract foundation", current: false, declaredPlans: 6, entries: [], checks: phaseChecks() },
    { id: "59.3", title: "Contract management", current: true, declaredPlans: 24, entries: [
      { id: "59.3-23", number: "23", title: "Supplier check", objective: "Recheck suppliers.", wave: 11, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-17", number: "17", title: "Registry help", objective: "Update help.", wave: 14, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-18", number: "18", title: "Browser certification", objective: "Test the journeys.", wave: 15, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-24", number: "24", title: null, objective: null, wave: 17, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
    ], checks: phaseChecks(true) },
    { id: "60", title: "Billing", current: false, declaredPlans: null, entries: [], checks: phaseChecks() },
  ],
});
const state = (data = plans()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: { workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, overview: { plans: data } as BoardOverview } });
const nodes = (node: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as { type?: unknown; props?: Record<string, unknown> };
  return [value, ...nodes(value.props?.children)];
};
const text = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node !== "object") return "";
  return text((node as { props?: { children?: unknown } }).props?.children);
};
const renderFunction = (node: { type?: unknown; props?: Record<string, unknown> }) => (node.type as (props: Record<string, unknown>) => unknown)(node.props ?? {});

describe("Plans tab", () => {
  it("shows current-milestone plan files and independent summary counts", () => {
    const tree = PlansView({ state: state(), theme, onRefresh: vi.fn() });
    expect(text(tree)).toContain("PlansCurrent-milestone plan files and roadmap annotations.");
    expect(text(tree)).toContain("4Plan files observed2Matching summaries observed");
    expect(text(tree)).toContain("not a verified completion");
    const groups = nodes(tree).filter((node) => typeof node.type === "function" && node.type.name === "PhaseGroup");
    expect(groups.map((group) => (group.props?.phase as { id: string }).id)).toEqual(["59.2", "59.3", "60"]);
    expect(groups.map((group) => group.props?.expanded)).toEqual([false, true, false]);
    const selected = renderFunction(groups[1]);
    expect(text(selected)).toContain("2 roadmap checked · 24 declared · 2 summaries observed");
    const rows = nodes(selected).filter((node) => typeof node.type === "function" && node.type.name === "PlanRow");
    expect(rows.map((row) => (row.props?.plan as { id: string }).id)).toEqual(["59.3-23", "59.3-17", "59.3-18", "59.3-24"]);
  });

  it("keeps roadmap checkmarks, plan files, and summary observations separate", () => {
    const current = plans().phases[1].entries;
    expect(planEvidenceLabel(current[0])).toEqual(["Roadmap checked", "Plan file observed", "Summary observed"]);
    expect(planEvidenceLabel(current[2])).toEqual(["Roadmap unchecked", "Plan file observed", "No readable summary observed"]);
    expect(planEvidenceLabel({ ...current[3], roadmapChecked: null, planObserved: false })).toEqual(["Not listed in roadmap", "No readable plan file observed", "No readable summary observed"]);
    expect(planEvidenceLabel({ ...current[3], roadmapChecked: null, roadmapConflict: true })).toEqual(["Conflicting roadmap checkmarks", "Plan file observed", "No readable summary observed"]);
    const selected = nodes(renderFunction(nodes(PlansView({ state: state(), theme, onRefresh: vi.fn() })).find((node) => typeof node.type === "function" && node.type.name === "PhaseGroup" && (node.props?.phase as { id: string }).id === "59.3")!));
    const pending = selected.find((node) => typeof node.type === "function" && node.type.name === "PlanRow" && (node.props?.plan as { id: string }).id === "59.3-18")!;
    const expanded = renderFunction({ ...pending, props: { ...pending.props, expanded: true } });
    const planControl = nodes(expanded).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Plan 59.3-18:"));
    expect(planControl?.props?.accessibilityLabel).toContain("Wave 15. Roadmap unchecked. Plan file observed. No readable summary observed. Hide details.");
    expect(text(expanded)).toContain("Test the journeys.");
    expect(text(expanded)).not.toContain("Summary, as recorded");
    expect(text(expanded)).toContain("neither proves verification");
  });

  it("shows summary wording separately from plan evidence and marks absent or limited wording", () => {
    const render = (overrides: Partial<ReturnType<typeof plans>["phases"][number]["entries"][number]>) => {
      const data = plans();
      data.phases[1].entries[0] = { ...data.phases[1].entries[0], ...overrides };
      const group = nodes(PlansView({ state: state(data), theme, onRefresh: vi.fn() })).find((node) => typeof node.type === "function" && node.type.name === "PhaseGroup" && (node.props?.phase as { id: string }).id === "59.3")!;
      const row = nodes(renderFunction(group)).find((node) => typeof node.type === "function" && node.type.name === "PlanRow" && (node.props?.plan as { id: string }).id === "59.3-23")!;
      return text(renderFunction({ ...row, props: { ...row.props, expanded: true } }));
    };
    const recorded = render({ summaryExcerpt: "Processos e instrumentos agora carregam lifecycle explícito.", summaryExcerptLimited: false });
    expect(recorded).toContain("Plan evidenceRecheck suppliers.");
    expect(recorded).toContain("Summary, as recordedProcessos e instrumentos agora carregam lifecycle explícito.");
    expect(recorded).toContain("neither proves verification");
    expect(render({ summaryExcerpt: null, summaryExcerptLimited: false })).toContain("No introductory prose recorded before the next heading.");
    expect(render({ summaryExcerpt: null, summaryExcerptLimited: true })).toContain("No safe summary introduction available.");
    expect(render({ summaryExcerpt: "The gate remains blocked.", summaryExcerptLimited: true })).toContain("Some summary wording was withheld or shortened for safe display.");
  });

  it("handles unavailable plans and loading without presenting an invented zero", () => {
    const unavailable = { ...plans(), availability: "unavailable" as const, phases: [], observedPlans: 0, observedSummaries: 0 };
    expect(text(PlansView({ state: state(unavailable), theme, onRefresh: vi.fn() }))).toContain("Plans unavailable");
    const loading: BoardViewState = { workspaceId: "empty", snapshot: null, busy: true, error: null };
    expect(text(PlansView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading plans…");
    expect(text(PlansView({ state: { ...loading, busy: false }, theme, onRefresh: vi.fn() }))).toContain("Plans unavailable");
  });

  it("uses compact group controls and discloses stale or limited observation", () => {
    const data = plans(); data.limited = true;
    const current = state(data); current.snapshot!.freshness = "stale";
    const tree = PlansView({ state: current, theme, compact: true, onRefresh: vi.fn() });
    expect(text(tree)).toContain("Refresh to update plans.");
    expect(text(tree)).toContain("counts may be partial.");
    const group = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "PhaseGroup" && (node.props?.phase as { id: string }).id === "59.3")!;
    const button = nodes(renderFunction(group)).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Phase 59.3: Contract management"));
    expect(button?.props?.accessibilityLabel).toContain("Current phase. 2 roadmap checked. 24 declared. 2 summaries observed. Hide plans.");
    expect(button?.props?.accessibilityState).toEqual({ expanded: true });
    expect(button?.props?.style).toMatchObject({ flexDirection: "column" });
  });

  it("shows the five phase stages and phase-only check groups without asserting success from file presence", () => {
    const current = plans().phases[1];
    const tree = PhaseChecks({ phase: current, theme, compact: false });
    const rail = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "Rail")!;
    expect(text(renderFunction(rail))).toContain("Phase progress");
    const stages = nodes(renderFunction(rail)).filter((node) => typeof node.type === "function" && node.type.name === "Stage");
    expect(stages.map((stage) => [stage.props?.title, stage.props?.detail])).toEqual([
      ["Discuss", "Observed"], ["Research", "Observed"], ["Plan", "4 plans observed"],
      ["Execute", "2/24 summaries observed"], ["Verify", "Not observed"],
    ]);
    const panels = nodes(tree).filter((node) => typeof node.type === "function" && node.type.name === "CheckGroupPanel");
    expect(panels.map((panel) => panel.props?.title)).toEqual(["Plan sub-stages", "Execute sub-stages"]);
    const copy = text([renderFunction(rail), ...panels.map(renderFunction)]);
    expect(copy).toContain("Plan sub-stages");
    expect(copy).toContain("Execute sub-stages");
    expect(copy).not.toContain("apply to entire phase");
    const planRows = nodes(renderFunction(panels[0])).filter((node) => typeof node.type === "function" && node.type.name === "CheckRow");
    const executeRows = nodes(renderFunction(panels[1])).filter((node) => typeof node.type === "function" && node.type.name === "CheckRow");
    expect(planRows).toHaveLength(11);
    expect(executeRows).toHaveLength(5);
    const nyquist = planRows.find((node) => node.props?.label === "Nyquist")!;
    const nyquistRow = renderFunction(nyquist);
    expect(nodes(nyquistRow).find((node) => node.props?.accessibilityLabel === "Nyquist: Observed · draft · compliance: no")).toBeDefined();
    expect(text(nyquistRow)).toContain("Draft · pending");
    expect(checkLabel(current.checks.plan.uiSpec)).toBe("Observed · draft");
    expect(checkLabel(current.checks.plan.spec)).toBe("Not observed");
    expect(checkLabel({ observation: "observed", reportedStatus: "open", compliant: null })).toBe("Observed · open");
    expect(checkLabel({ observation: "observed", reportedStatus: "partial", compliant: null })).toBe("Observed · partial");
    expect(checkLabel({ observation: "observed", reportedStatus: "failed", compliant: null })).toBe("Observed · failed");
    const compactTree = PhaseChecks({ phase: current, theme, compact: true });
    const compactRail = nodes(compactTree).find((node) => typeof node.type === "function" && node.type.name === "Rail")!;
    expect(nodes(renderFunction(compactRail)).find((node) => (node.props?.style as { gap?: number })?.gap === 8 && (node.props?.style as { flexDirection?: string })?.flexDirection === "column")?.props?.style).toMatchObject({ alignItems: "stretch" });
    expect(nodes(compactTree).find((node) => (node.props?.style as { gap?: number })?.gap === 12 && (node.props?.style as { flexDirection?: string })?.flexDirection === "column")?.props?.style).toMatchObject({ alignItems: "stretch" });
  });
});
