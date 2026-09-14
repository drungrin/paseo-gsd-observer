import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ScrollView } from "react-native";
import { boardRpc, type BoardRequest, type BoardResponse } from "../shared/board-rpc.js";
import { boardReducer, createBoardState, type BoardReadingState, type PhaseFilter, type PlanFilter } from "./board-state.js";
import { BoardView, type BoardTheme, type BoardViewState } from "./board-components.js";

export type { BoardTheme, BoardViewState } from "./board-components.js";
export { BoardView } from "./board-components.js";
export type BoardController = { getState(): BoardReadingState; subscribe(listener: () => void): () => void; setWorkspace(workspaceId: string): void; start(): void; dispatch(intent: BoardRequest["intent"], milestoneId?: string): Promise<void>; focusMilestone(milestoneId: string): void; toggleArchive(): void; selectPhase(milestoneId: string, phaseId: string): void; togglePlans(milestoneId: string, phaseId: string): void; selectPlan(milestoneId: string, planId: string): void; setScrollOffset(milestoneId: string, offset: number): void; setPhaseFilter(milestoneId: string, filter: PhaseFilter): void; setPlanFilter(milestoneId: string, filter: PlanFilter): void; dispose(): void };

export function createBoardController({ workspaceId, callBoardRpc }: { workspaceId: string; callBoardRpc: (input: BoardRequest) => Promise<BoardResponse> }): BoardController {
  let state = createBoardState(workspaceId);
  let selectedWorkspaceId = workspaceId;
  let generation = 0;
  let disposed = false;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const update = (event: Parameters<typeof boardReducer>[1]) => { state = boardReducer(state, event); notify(); };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setWorkspace(nextWorkspaceId) { if (nextWorkspaceId === selectedWorkspaceId) return; selectedWorkspaceId = nextWorkspaceId; generation += 1; state = createBoardState(nextWorkspaceId); notify(); },
    start() { if (!statusTimer) statusTimer = setInterval(() => { void this.dispatch("status"); }, 5_000); },
    async dispatch(intent, milestoneId) {
      const archiveMilestoneId = milestoneId;
      if (intent === "archive" && !archiveMilestoneId?.startsWith("archive:")) return;
      const requestWorkspaceId = selectedWorkspaceId;
      const requestGeneration = intent === "status" ? generation : ++generation;
      state = { ...state, busy: intent !== "status", error: null, refreshAnnouncement: null }; notify();
      try {
        const request: BoardRequest = intent === "archive" ? { workspaceId: requestWorkspaceId, intent, milestoneId: archiveMilestoneId! } : { workspaceId: requestWorkspaceId, intent };
        const response = await callBoardRpc(request);
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        if (response.kind === "snapshot") state = { ...boardReducer(state, { type: "snapshot", snapshot: response.snapshot }), busy: false, refreshAnnouncement: intent === "refresh" ? "Evidence updated." : intent === "archive" ? "Archived milestone loaded." : null };
        else state = { ...state, busy: false, refreshAnnouncement: null, snapshot: state.snapshot ? { ...state.snapshot, observedAt: response.observedAt, freshness: response.freshness, availability: response.availability, revision: response.revision, warnings: response.warnings } : null };
      } catch {
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        state = { ...state, busy: false, error: "Could not refresh evidence.", refreshAnnouncement: null };
      }
      notify();
    },
    focusMilestone: (milestoneId) => update({ type: "focus-milestone", milestoneId }),
    toggleArchive: () => update({ type: "toggle-archive" }),
    selectPhase: (milestoneId, phaseId) => update({ type: "select-phase", milestoneId, phaseId }),
    togglePlans: (milestoneId, phaseId) => update({ type: "toggle-plans", milestoneId, phaseId }),
    selectPlan: (milestoneId, planId) => update({ type: "select-plan", milestoneId, planId }),
    setScrollOffset: (milestoneId, offset) => update({ type: "set-scroll-offset", milestoneId, offset }),
    setPhaseFilter: (milestoneId, filter) => update({ type: "set-phase-filter", milestoneId, filter }),
    setPlanFilter: (milestoneId, filter) => update({ type: "set-plan-filter", milestoneId, filter }),
    dispose() { disposed = true; generation += 1; if (statusTimer) clearInterval(statusTimer); listeners.clear(); },
  };
}

export function BoardPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const callBoardRpc = useRpc(boardRpc);
  const controller = useMemo(() => createBoardController({ workspaceId, callBoardRpc }), [workspaceId, callBoardRpc]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const scrollRef = useRef<ScrollView>(null);
  const [inspectedPhaseId, setInspectedPhaseId] = useState<string | null>(null);
  const [inspectedPlanId, setInspectedPlanId] = useState<string | null>(null);
  useEffect(() => { controller.start(); void controller.dispatch("snapshot"); return () => controller.dispose(); }, [controller]);
  useEffect(() => { const offset = state.focusedMilestoneId ? state.readingByMilestone[state.focusedMilestoneId]?.scrollOffset ?? 0 : 0; scrollRef.current?.scrollTo({ y: Math.max(0, offset), animated: false }); }, [state.focusedMilestoneId, state.snapshot?.revision]);
  return <BoardView state={state} theme={theme as BoardTheme} compact={layout.compact} onRefresh={() => { void controller.dispatch("refresh"); }} onFocusMilestone={(milestoneId) => { controller.focusMilestone(milestoneId); if (milestoneId.startsWith("archive:")) void controller.dispatch("archive", milestoneId); }} onToggleArchive={controller.toggleArchive} onSelectPhase={controller.selectPhase} onSelectPlan={controller.selectPlan} onScrollOffset={controller.setScrollOffset} onSetPlanFilter={controller.setPlanFilter} inspectedPhaseId={inspectedPhaseId} onInspectPhase={setInspectedPhaseId} onCloseInspector={() => setInspectedPhaseId(null)} inspectedPlanId={inspectedPlanId} onInspectPlan={setInspectedPlanId} onClosePlanInspector={() => setInspectedPlanId(null)} scrollRef={scrollRef} />;
}
