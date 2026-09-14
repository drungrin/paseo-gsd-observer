import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
import { createBoardController } from "../../index.client";
import { boardReducer, createBoardState } from "../../client/board-state";
import type { BoardSnapshot } from "../../shared/board-rpc";

const snapshot = (phaseColumn: "planned" | "executing" = "planned"): BoardSnapshot => ({
  workspaceId: "selected",
  observedAt: "2026-09-13T12:00:00.000Z",
  freshness: "current",
  availability: "available",
  revision: 1,
  warnings: [],
  limited: false,
  milestones: [
    {
      id: "live",
      title: "Milestone atual",
      archived: false,
      active: true,
      availability: "available",
      warnings: [],
      limited: false,
      phases: [{
        id: "live:1",
        phaseId: "1",
        title: "Board",
        column: phaseColumn,
        roadmapDeclared: true,
        plans: [{ id: "live:1:01", planId: "01", evidenceStatus: "planned", summaryPaired: false, availability: "available", proof: [], warnings: [] }],
        planCount: 1,
        summaryCount: 0,
        stateMarker: true,
        review: "absent",
        uat: "absent",
        proof: [],
        warnings: [],
        availability: "available",
        limited: false,
      }],
    },
    {
      id: "archive",
      title: "Milestone arquivado",
      archived: true,
      active: false,
      availability: "available",
      warnings: [],
      limited: false,
      phases: [],
    },
  ],
});

describe("board reading state", () => {
  it("keeps local phase and plan filters scoped to the observed milestone", () => {
    const initial = boardReducer(createBoardState("selected"), { type: "snapshot", snapshot: snapshot() });
    const warnings = boardReducer(initial, { type: "set-phase-filter", milestoneId: "live", filter: "warnings" });
    const summary = boardReducer(warnings, { type: "set-plan-filter", milestoneId: "live", filter: "summary" });
    expect(summary.readingByMilestone.live).toMatchObject({ phaseFilter: "warnings", planFilter: "summary" });
    expect(summary.readingByMilestone.archive).toMatchObject({ phaseFilter: "all", planFilter: "all" });
  });

  it("preserves local filters over refresh and resets only the plan filter on phase selection", async () => {
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async () => ({ kind: "snapshot", snapshot: snapshot() }) });
    await controller.dispatch("snapshot");
    controller.setPhaseFilter("live", "warnings");
    controller.setPlanFilter("live", "summary");
    await controller.dispatch("refresh");
    expect(controller.getState().readingByMilestone.live).toMatchObject({ phaseFilter: "warnings", planFilter: "summary" });
    controller.selectPhase("live", "live:1");
    expect(controller.getState().readingByMilestone.live).toMatchObject({ phaseFilter: "warnings", planFilter: "all" });
    controller.dispose();
  });

  it("preserves the selected phase and its disclosure when a valid snapshot reclassifies its card", async () => {
    let current = snapshot();
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async () => ({ kind: "snapshot", snapshot: current }) });
    await controller.dispatch("snapshot");

    controller.selectPhase("live", "live:1");
    controller.togglePlans("live", "live:1");
    controller.setScrollOffset("live", 88);
    current = snapshot("executing");
    await controller.dispatch("refresh");

    expect(controller.getState()).toMatchObject({
      focusedMilestoneId: "live",
      readingByMilestone: {
        live: { selectedPhaseId: "live:1", plansExpanded: { "live:1": true }, scrollOffset: 88 },
      },
    });
    expect(controller.getState().snapshot?.milestones[0].phases[0].column).toBe("executing");
    controller.dispose();
  });

  it("keeps live reading context while opening an archive and removes selections no longer present", async () => {
    let current = snapshot();
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async () => ({ kind: "snapshot", snapshot: current }) });
    await controller.dispatch("snapshot");
    controller.selectPhase("live", "live:1");
    controller.setScrollOffset("live", 64);
    controller.focusMilestone("archive");
    controller.focusMilestone("live");

    expect(controller.getState()).toMatchObject({ focusedMilestoneId: "live", readingByMilestone: { live: { selectedPhaseId: "live:1", scrollOffset: 64 } } });
    current = { ...snapshot(), milestones: [{ ...snapshot().milestones[0], phases: [] }, snapshot().milestones[1]] };
    await controller.dispatch("refresh");
    expect(controller.getState().readingByMilestone.live?.selectedPhaseId).toBeNull();
    controller.dispose();
  });
});
