import type { BoardSnapshot } from "../shared/board-rpc.js";

export type PhaseFilter = "all" | "warnings" | "unknown";
export type PlanFilter = "all" | "summary" | "without-summary";
export type MilestoneReading = { selectedPhaseId: string | null; selectedPlanId: string | null; plansExpanded: Record<string, boolean>; scrollOffset: number; phaseFilter?: PhaseFilter; planFilter?: PlanFilter };
export type BoardReadingState = { workspaceId: string; snapshot: BoardSnapshot | null; busy: boolean; error: string | null; refreshAnnouncement: string | null; focusedMilestoneId: string | null; archiveExpanded: boolean; readingByMilestone: Record<string, MilestoneReading> };
export type BoardEvent = { type: "snapshot"; snapshot: BoardSnapshot } | { type: "focus-milestone"; milestoneId: string } | { type: "toggle-archive" } | { type: "select-phase"; milestoneId: string; phaseId: string } | { type: "toggle-plans"; milestoneId: string; phaseId: string } | { type: "select-plan"; milestoneId: string; planId: string } | { type: "set-scroll-offset"; milestoneId: string; offset: number } | { type: "set-phase-filter"; milestoneId: string; filter: PhaseFilter } | { type: "set-plan-filter"; milestoneId: string; filter: PlanFilter };

const emptyReading = (): MilestoneReading => ({ selectedPhaseId: null, selectedPlanId: null, plansExpanded: {}, scrollOffset: 0, phaseFilter: "all", planFilter: "all" });
export const createBoardState = (workspaceId: string): BoardReadingState => ({ workspaceId, snapshot: null, busy: false, error: null, refreshAnnouncement: null, focusedMilestoneId: null, archiveExpanded: false, readingByMilestone: {} });
const matchingMilestone = (state: BoardReadingState, milestoneId: string) => state.snapshot?.milestones.find((milestone) => milestone.id === milestoneId);

const reconcileReading = (snapshot: BoardSnapshot, previous: Record<string, MilestoneReading>) => Object.fromEntries(snapshot.milestones.map((milestone) => {
  const old = previous[milestone.id] ?? emptyReading();
  const phases = new Set(milestone.phases.map((phase) => phase.id));
  const selectedPhaseId = old.selectedPhaseId && phases.has(old.selectedPhaseId) ? old.selectedPhaseId : null;
  const selectedPhase = milestone.phases.find((phase) => phase.id === selectedPhaseId);
  const planIds = new Set(selectedPhase?.plans.map((plan) => plan.id) ?? []);
  return [milestone.id, { selectedPhaseId, selectedPlanId: old.selectedPlanId && planIds.has(old.selectedPlanId) ? old.selectedPlanId : null, plansExpanded: Object.fromEntries(Object.entries(old.plansExpanded).filter(([phaseId, expanded]) => expanded && phases.has(phaseId))), scrollOffset: Math.max(0, old.scrollOffset), phaseFilter: old.phaseFilter ?? "all", planFilter: old.planFilter ?? "all" }];
}));

export function boardReducer(state: BoardReadingState, event: BoardEvent): BoardReadingState {
  if (event.type === "snapshot") {
    const readingByMilestone = reconcileReading(event.snapshot, state.readingByMilestone);
    const existing = new Set(event.snapshot.milestones.map((milestone) => milestone.id));
    const focusedMilestoneId = state.focusedMilestoneId && existing.has(state.focusedMilestoneId) ? state.focusedMilestoneId : event.snapshot.milestones.find((milestone) => milestone.active && !milestone.archived)?.id ?? event.snapshot.milestones.find((milestone) => !milestone.archived)?.id ?? event.snapshot.milestones[0]?.id ?? null;
    return { ...state, snapshot: event.snapshot, focusedMilestoneId, readingByMilestone };
  }
  if (event.type === "toggle-archive") return { ...state, archiveExpanded: !state.archiveExpanded };
  if (event.type === "focus-milestone") return matchingMilestone(state, event.milestoneId) ? { ...state, focusedMilestoneId: event.milestoneId } : state;
  const milestone = matchingMilestone(state, event.milestoneId);
  if (!milestone) return state;
  const reading = state.readingByMilestone[event.milestoneId] ?? emptyReading();
  if (event.type === "select-phase") {
    if (!milestone.phases.some((phase) => phase.id === event.phaseId)) return state;
    return { ...state, focusedMilestoneId: event.milestoneId, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, selectedPhaseId: event.phaseId, selectedPlanId: null, planFilter: "all" } } };
  }
  if (event.type === "toggle-plans") {
    if (!milestone.phases.some((phase) => phase.id === event.phaseId)) return state;
    return { ...state, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, plansExpanded: { ...reading.plansExpanded, [event.phaseId]: !reading.plansExpanded[event.phaseId] } } } };
  }
  if (event.type === "select-plan") {
    const selectedPhase = milestone.phases.find((phase) => phase.id === reading.selectedPhaseId);
    if (!selectedPhase?.plans.some((plan) => plan.id === event.planId)) return state;
    return { ...state, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, selectedPlanId: event.planId } } };
  }
  if (event.type === "set-phase-filter") return { ...state, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, phaseFilter: event.filter } } };
  if (event.type === "set-plan-filter") return { ...state, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, planFilter: event.filter } } };
  return { ...state, readingByMilestone: { ...state.readingByMilestone, [event.milestoneId]: { ...reading, scrollOffset: Math.max(0, event.offset) } } };
}
