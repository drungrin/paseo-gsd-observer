import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", FlatList: "FlatList" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));

import { BoardView } from "../../index.client";
import type { BoardViewState } from "../../index.client";

const theme = { colors: { surface0: "#000", foreground: "#fff", foregroundMuted: "#aaa", accent: "#0af", accentForeground: "#000" } };

const textContent = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!node || typeof node !== "object") return [];
  const children = (node as { props?: { children?: unknown } }).props?.children;
  return (Array.isArray(children) ? children : [children]).flatMap(textContent);
};

const nodes = (node: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> => {
  if (!node || typeof node !== "object") return [];
  const value = node as { props?: Record<string, unknown> };
  const children = value.props?.children;
  return [value, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
};

describe("board panel", () => {
  it("bounds expandable content and uses Paseo's gesture-aware vertical scroller", async () => {
    const tree = BoardView({ state: { workspaceId: "selected", snapshot: null, busy: false, error: null }, onRefresh: () => undefined, theme });
    const scroller = nodes(tree).find((node) => node.type === "PaseoScrollView");

    expect(tree.props.style).toMatchObject({ flex: 1, minHeight: 0 });
    expect(scroller?.props?.style).toMatchObject({ flex: 1, minHeight: 0 });
    expect(scroller?.props?.nestedScrollEnabled).toBe(true);
    await expect(readFile("client/board-components.tsx", "utf8")).resolves.toContain('from "@getpaseo/plugin/client/react-native"');
  });

  it("opens the selected phase with its plans and exposes the evidence inspector", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Board", column: "planned", roadmapDeclared: true, plans: [{ id: "live:1:01", planId: "01", title: "Resumo seguro do plano", evidenceStatus: "planned", summaryPaired: false, availability: "available", proof: [{ source: "plan", status: "observed", safeId: "01" }], warnings: ["absent"] }], planCount: 1, summaryCount: 0, stateMarker: true, review: "open", uat: "partial", proof: [], warnings: ["reconciliation-unavailable"], availability: "available", limited: false }] }],
      },
    };
    const tree = BoardView({ state, onRefresh: () => undefined, theme });
    const text = textContent(tree).join("");
    expect(text).toContain("Current roadmap");
    expect(text).toContain("Current snapshot");
    expect(text).toContain("Last refresh:");
    expect(text).toContain("Refresh");
    expect(text).not.toContain("Explore 0 archived milestones");
    expect(text).not.toContain("Current milestone");
    expect(text).not.toContain("State counts:");
    expect(text).not.toContain("Read-only, not authority");
    expect(text).not.toContain("Open GSD Board");
    expect(text).not.toContain("Observed phases");
    expect(text).not.toContain("All phases");
    expect(text).not.toContain("With warnings");
    expect(text).not.toContain("Unknown/unavailable state");
    expect(text.indexOf("Phases and plans")).toBeLessThan(text.indexOf("Goal: unavailable."));
    expect(text).toContain("Goal: unavailable.");
    expect(text).toContain("View phase details");
    expect(text).not.toContain("Phase details");
    expect(text).toContain("All (1)");
    expect(text).toContain("Completed (0)");
    expect(text).toContain("Remaining (1)");
    expect(text).toContain("Planned");
    expect(text).not.toContain("Limited observation");
    expect(text).not.toContain("Selected — detail visible");
    expect(text).not.toContain("Plan 01");
    expect(nodes(tree).some((node) => node.type === "FlatList" && Array.isArray(node.props?.data) && (node.props?.data as { id?: string }[])[0]?.id === "live:1:01")).toBe(true);
  });

  it("keeps phase navigation in the snapshot's numeric order while showing each evidence state", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Current", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [
          { id: "live:1", phaseId: "1", title: "Foundation", column: "completed", roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false },
          { id: "live:2", phaseId: "2", title: "Integration", column: "backlog", roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false },
          { id: "live:3", phaseId: "3", title: "Validation", column: "executing", roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false },
        ] }],
      },
    };

    const navigation = nodes(BoardView({ state, onRefresh: () => undefined, theme })).find((node) => node.props?.accessibilityLabel === "Phase navigation");
    const phaseButtons = nodes(navigation).filter((node) => typeof node.props?.label === "string" && node.props.label.startsWith("Phase "));

    expect(phaseButtons.map((button) => button.props?.label)).toEqual(["Phase 1: Foundation", "Phase 2: Integration", "Phase 3: Validation"]);
    expect(phaseButtons.map((button) => textContent(button).join(""))).toEqual(expect.arrayContaining([expect.stringContaining("Completed"), expect.stringContaining("Backlog"), expect.stringContaining("Executing")]));
  });

  it("renders the lateral inspector with the safe Goal, success criteria, review and UAT", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Safe Evidence Board", column: "verifying", roadmapDeclared: true, goal: "As a person, I want to inspect safe evidence.", successCriteria: ["The Goal is visible.", "Review and UAT are available."], plans: [{ id: "live:1:01", planId: "01", evidenceStatus: "summary-present", summaryPaired: true, availability: "available", proof: [], warnings: [] }], planCount: 1, summaryCount: 1, stateMarker: false, review: "resolved", uat: "passed", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };
    const text = textContent(BoardView({ state, onRefresh: () => undefined, theme, inspectedPhaseId: "live:1" })).join("");

    expect(nodes(BoardView({ state, onRefresh: () => undefined, theme, inspectedPhaseId: "live:1" })).some((node) => node.props?.accessibilityLabel === "Phase evidence side panel")).toBe(true);
    expect(text).toContain("Goal");
    expect(text).toContain("As a person, I want to inspect safe evidence.");
    expect(text).toContain("Success criteria");
    expect(text).toContain("The Goal is visible.");
    expect(text).toContain("Reviewresolved");
    expect(text).toContain("UATpassed");
    expect(text).not.toContain("The observer presents allowed fields");
    expect(nodes(BoardView({ state, onRefresh: () => undefined, theme, inspectedPhaseId: "live:1" })).some((node) => node.props?.accessibilityLabel === "Close phase evidence" && (node.props?.style as { position?: string } | undefined)?.position === "absolute")).toBe(true);
  });

  it("shows one explicit empty-plan row for a future phase without plan artifacts", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:3", selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Current", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:3", phaseId: "3", title: "Approved Structured Trace", column: "backlog", roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };
    const tree = BoardView({ state, onRefresh: () => undefined, theme });
    const text = textContent(tree).join("");

    expect(text).toContain("Goal: unavailable.");
    expect(text).toContain("No plans listed");
    expect(text).toContain("No plan artifacts are listed for this phase.");
    expect(nodes(tree).some((node) => node.props?.accessibilityLabel === "No plans listed")).toBe(true);
  });

  it("orders phase navigation by numeric phase ID instead of status", () => {
    const phase = (phaseId: string, column: "backlog" | "planned" | "completed") => ({ id: `live:${phaseId}`, phaseId, title: `Phase ${phaseId}`, column, roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: false, review: "absent" as const, uat: "absent" as const, proof: [], warnings: [], availability: "available" as const, limited: false });
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: null, selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: { workspaceId: "selected", observedAt: "2026-09-14T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, milestones: [{ id: "live", title: "Current", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [phase("14.9", "completed"), phase("14.10", "backlog"), phase("14.1", "planned"), phase("14", "backlog"), phase("14.9.1", "backlog")] }] },
    };

    const labels = nodes(BoardView({ state, onRefresh: () => undefined, theme })).flatMap((node) => typeof node.props?.label === "string" && /^Phase \d+(?:\.\d+)*:/.test(node.props.label) ? [node.props.label] : []);
    expect(labels).toEqual(["Phase 14: Phase 14", "Phase 14.1: Phase 14.1", "Phase 14.9: Phase 14.9", "Phase 14.9.1: Phase 14.9.1", "Phase 14.10: Phase 14.10"]);
  });

  it("replaces inline plan evidence with a plan details side panel", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: "live:1:01", plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Current", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Safe Evidence Board", column: "verifying", roadmapDeclared: true, plans: [{ id: "live:1:01", planId: "01", title: "Safe parser", goal: "As a person, I want to inspect a plan.", successCriteria: ["The plan details are visible."], summaryStatus: "complete", evidenceStatus: "summary-present", summaryPaired: true, availability: "available", proof: [], warnings: [] }], planCount: 1, summaryCount: 1, stateMarker: false, review: "resolved", uat: "passed", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };
    const tree = BoardView({ state, onRefresh: () => undefined, theme, inspectedPlanId: "live:1:01" });
    const text = textContent(tree).join("");

    expect(nodes(tree).some((node) => node.props?.accessibilityLabel === "Plan details side panel")).toBe(true);
    expect(text).toContain("Safe parser");
    expect(text).toContain("As a person, I want to inspect a plan.");
    expect(text).toContain("The plan details are visible.");
    expect(text).toContain("Summary status: complete");
    expect(text).not.toContain("Selected evidence");
  });

  it("uses the selected milestone as context and reveals every milestone in the archive grid", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "2.0", archiveExpanded: true,
      readingByMilestone: {},
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [
          { id: "2.0", title: "Faturamento Contratual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [] },
          { id: "archive:v1.9", title: "Shell lateral", archived: true, active: false, availability: "available", warnings: [], limited: false, phases: [] },
        ],
      },
    };

    const tree = BoardView({ state, onRefresh: () => undefined, theme });
    const text = textContent(tree).join("");

    expect(text.indexOf("Current roadmap")).toBeLessThan(text.indexOf("Milestone v2.0 · Faturamento Contratual"));
    expect(text).toContain("Current · 0 phases in the roadmap");
    expect(text).toContain("Explore 1 archived milestones");
    expect(text).toContain("v2.0 · Current");
    expect(text).toContain("v1.9 · Shell lateral");
    expect(nodes(tree).some((node) => node.props?.accessibilityLabel === "Available milestones")).toBe(true);
    expect(text.indexOf("Milestone v2.0 · Faturamento Contratual")).toBeLessThan(text.indexOf("Phases and plans"));
  });

  it("shows the safe plan title with its ID and evidence status only after plans are disclosed", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: null, plansExpanded: { "live:1": true }, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Board", column: "planned", roadmapDeclared: true, plans: [{ id: "live:1:01", planId: "01", title: "Resumo seguro do plano", evidenceStatus: "summary-present", summaryPaired: true, availability: "available", proof: [{ source: "plan", status: "observed", safeId: "01" }], warnings: [] }], planCount: 1, summaryCount: 1, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };

    const tree = BoardView({ state, onRefresh: () => undefined, theme });
    const planList = nodes(tree).find((node) => node.type === "FlatList" && Array.isArray(node.props?.data) && (node.props?.data as { id?: string }[])[0]?.id === "live:1:01");
    const renderItem = planList?.props?.renderItem as undefined | ((args: { item: { id: string; planId: string; title?: string; evidenceStatus: string } }) => unknown);
    const text = textContent(renderItem?.({ item: state.snapshot!.milestones[0].phases[0].plans[0] }) ?? null).join("");
    expect(text).toContain("Plan 01");
    expect(text).toContain("Resumo seguro do plano");
    expect(text).toContain("Completed");
  });

  it("keeps stale evidence with absolute and relative freshness and announces only a completed manual refresh", () => {
    const state = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      refreshAnnouncement: "Evidence updated.",
      readingByMilestone: { live: { selectedPhaseId: null, selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "stale", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [] }],
      },
    } as BoardViewState & { refreshAnnouncement: string };
    const tree = BoardView({ state, onRefresh: () => undefined, theme, now: () => new Date("2026-09-13T12:01:00.000Z") });
    const text = textContent(tree).join("");
    expect(text).toContain("9/13/2026");
    expect(text).toContain("1 minute ago");
    expect(text).toContain("Evidence updated.");
    expect(nodes(tree).some((node) => node.props?.accessibilityLiveRegion === "polite")).toBe(true);
  });

  it("qualifies archived milestones and failed refresh freshness without promoting a summary", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: "Não foi possível atualizar as evidências.", focusedMilestoneId: "archive", archiveExpanded: true,
      readingByMilestone: { archive: { selectedPhaseId: "archive:1", selectedPlanId: "archive:1:01", plansExpanded: { "archive:1": true }, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "refresh-failed", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "archive", title: "Arquivo", archived: true, active: false, availability: "available", warnings: [], limited: false, phases: [{ id: "archive:1", phaseId: "1", title: "Plano histórico", column: "completed", roadmapDeclared: true, plans: [{ id: "archive:1:01", planId: "01", evidenceStatus: "summary-present", summaryPaired: true, availability: "available", proof: [], warnings: [] }], planCount: 1, summaryCount: 1, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };
    const text = textContent(BoardView({ state, onRefresh: () => undefined, theme })).join("");
    expect(text).toContain("Plano histórico");
    expect(text).toContain("Evidence has limited freshness until a manual refresh.");
    expect(text).toContain("Completed");
    expect(text).not.toContain("Plan 01 completed");
  });

  it("keeps technical snapshot and milestone warnings out of the board while preserving phase provenance", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: null, plansExpanded: {}, scrollOffset: 0 } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: ["malformed"], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: ["containment-refused"], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Board", column: "planned", roadmapDeclared: true, plans: [], planCount: 0, summaryCount: 0, stateMarker: true, review: "open", uat: "partial", proof: [{ source: "roadmap", status: "observed", count: 2 }, { source: "reconciliation", status: "pending" }], warnings: [], availability: "available", limited: false }] }],
      },
    };

    const text = textContent(BoardView({ state, onRefresh: () => undefined, theme })).join("");

    expect(text).not.toContain("Snapshot observation");
    expect(text).not.toContain("Milestone observation");
    expect(text).not.toContain("Provenance");
    expect(text).not.toContain("roadmap — observed (2); reconciliation — pending");
  });

  it("keeps phase-card counts, dense plan regions, and selected provenance readable with host theme colors", () => {
    const title = "Um título seguro e deliberadamente longo para confirmar que o detalhe preserva a evidência legível sem truncar a informação essencial";
    const themed = { colors: { surface0: "#101", surface1: "#202", surface2: "#303", foreground: "#fff", foregroundMuted: "#ccc", border: "#555", accent: "#0af", accentForeground: "#000" } };
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: "live:1:01", plansExpanded: { "live:1": true }, scrollOffset: 0, phaseFilter: "all", planFilter: "all" } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Board", column: "planned", roadmapDeclared: true, plans: [{ id: "live:1:01", planId: "01", title, evidenceStatus: "summary-present", summaryPaired: true, availability: "available", proof: [{ source: "plan", status: "observed", safeId: "01" }], warnings: [] }], planCount: null, summaryCount: null, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };

    const tree = BoardView({ state, onRefresh: () => undefined, theme: themed, inspectedPlanId: "live:1:01" });
    const text = textContent(tree).join("");
    const planList = nodes(tree).find((node) => node.type === "FlatList" && Array.isArray(node.props?.data) && (node.props?.data as { id?: string }[])[0]?.id === "live:1:01");
    const renderItem = planList?.props?.renderItem as undefined | ((args: { item: { id: string; planId: string; title?: string; evidenceStatus: string } }) => unknown);
    const planRegion = textContent(renderItem?.({ item: state.snapshot!.milestones[0].phases[0].plans[0] }) ?? null).join("");

    expect(text).toContain("plans unavailable");
    expect(text).toContain("summaries unavailable");
    expect(nodes(tree).some((node) => node.props?.accessibilityLabel === "Plan details side panel")).toBe(true);
    expect(text).toContain(title);
    expect(text).toContain("Execution outcome");
    expect(text).toContain("Outcome was not recorded.");
    expect(planRegion).toContain("Plan 01");
    expect(planRegion).toContain(title);
    expect(planRegion).toContain("Completed");
    expect(nodes(tree).some((node) => (node.props?.style as { backgroundColor?: string } | undefined)?.backgroundColor === "#202")).toBe(true);
  });

  it("keeps local empty filters explicit while preserving a selected plan's safe provenance", () => {
    const state: BoardViewState = {
      workspaceId: "selected", busy: false, error: null, focusedMilestoneId: "live", archiveExpanded: false,
      readingByMilestone: { live: { selectedPhaseId: "live:1", selectedPlanId: "live:1:01", plansExpanded: { "live:1": true }, scrollOffset: 0, phaseFilter: "all", planFilter: "summary" } },
      snapshot: {
        workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
        milestones: [{ id: "live", title: "Atual", archived: false, active: true, availability: "available", warnings: [], limited: false, phases: [{ id: "live:1", phaseId: "1", title: "Board", column: "planned", roadmapDeclared: true, plans: [{ id: "live:1:01", planId: "01", evidenceStatus: "planned", summaryPaired: false, availability: "available", proof: [], warnings: [] }], planCount: 1, summaryCount: 0, stateMarker: false, review: "absent", uat: "absent", proof: [], warnings: [], availability: "available", limited: false }] }],
      },
    };
    const text = textContent(BoardView({ state, onRefresh: () => undefined, theme })).join("");

    expect(text).toContain("No plans match the local filter.");
    expect(text).toContain("Clear filter");
    expect(text).not.toContain("Selected evidence");
    expect(text).not.toContain("Classification");
  });
});
