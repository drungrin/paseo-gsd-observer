import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { BoardTabs, type BoardTab, type TabFocusTarget } from "./board-tabs.js";
import { OverviewView } from "./overview-components.js";
import { PlansView } from "./plans-components.js";
import { ContextView } from "./context-components.js";
import { ValidationView } from "./validation-components.js";
import { UatView } from "./uat-components.js";
import { VerificationView } from "./verification-components.js";
import { TodosView } from "./todos-components.js";
import { ParkingLotView } from "./parking-lot-components.js";
import { DebugView } from "./debug-components.js";
import { boardRpc, type BoardRequest, type BoardResponse } from "../shared/board-rpc.js";
import { createBoardState, type BoardReadingState } from "./board-state.js";
import type { BoardTheme } from "./board-components.js";

export type { BoardTheme, BoardViewState } from "./board-components.js";
export type BoardController = { getState(): BoardReadingState; subscribe(listener: () => void): () => void; setWorkspace(workspaceId: string): void; start(): void; dispatch(intent: BoardRequest["intent"]): Promise<void>; dispose(): void };

export function createBoardController({ workspaceId, callBoardRpc }: { workspaceId: string; callBoardRpc: (input: BoardRequest) => Promise<BoardResponse> }): BoardController {
  let state = createBoardState(workspaceId);
  let selectedWorkspaceId = workspaceId;
  let generation = 0;
  let disposed = false;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setWorkspace(nextWorkspaceId) { if (nextWorkspaceId === selectedWorkspaceId) return; selectedWorkspaceId = nextWorkspaceId; generation += 1; state = createBoardState(nextWorkspaceId); notify(); },
    start() { if (!statusTimer) statusTimer = setInterval(() => { void this.dispatch("status"); }, 5_000); },
    async dispatch(intent) {
      const requestWorkspaceId = selectedWorkspaceId;
      const requestGeneration = intent === "status" ? generation : ++generation;
      state = { ...state, busy: intent !== "status", error: null, refreshAnnouncement: null }; notify();
      try {
        const response = await callBoardRpc({ workspaceId: requestWorkspaceId, intent });
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        if (response.kind === "snapshot") state = { ...state, snapshot: response.snapshot, busy: false, error: response.snapshot.freshness === "refresh-failed" ? "Could not refresh evidence." : null, refreshAnnouncement: intent === "refresh" && response.snapshot.freshness === "current" ? "Evidence updated." : null };
        else state = { ...state, busy: false, refreshAnnouncement: null, snapshot: state.snapshot ? { ...state.snapshot, observedAt: response.observedAt, freshness: response.freshness, availability: response.availability, revision: response.revision, warnings: response.warnings } : null };
      } catch {
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        state = { ...state, busy: false, error: "Could not refresh evidence.", refreshAnnouncement: null };
      }
      notify();
    },
    dispose() { disposed = true; generation += 1; if (statusTimer) clearInterval(statusTimer); listeners.clear(); },
  };
}

export function BoardPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const callBoardRpc = useRpc(boardRpc);
  const controller = useMemo(() => createBoardController({ workspaceId, callBoardRpc }), [workspaceId, callBoardRpc]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [tabSelection, setTabSelection] = useState<{ workspaceId: string; tab: BoardTab }>({ workspaceId, tab: "overview" });
  const [focusedTab, setFocusedTab] = useState<BoardTab | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const tabRefs = useRef<Partial<Record<BoardTab, TabFocusTarget | null>>>({});
  const idPrefix = `board-${useId().replace(/:/g, "")}`;
  const activeTab = tabSelection.workspaceId === workspaceId ? tabSelection.tab : "overview";
  const compact = layout.compact || panelWidth !== null && panelWidth < 760;
  const onRefresh = () => { void controller.dispatch("refresh"); };
  useEffect(() => { controller.start(); void controller.dispatch("snapshot"); return () => controller.dispose(); }, [controller]);
  useEffect(() => { setShowTable(false); }, [workspaceId]);
  return <View onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
    <BoardTabs activeTab={activeTab} focusedTab={focusedTab} onSelect={(tab) => setTabSelection({ workspaceId, tab })} onFocus={setFocusedTab} idPrefix={idPrefix} tabRefs={tabRefs} theme={theme as BoardTheme} compact={compact} />
    <View nativeID={`${idPrefix}-panel-overview`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-overview`} aria-hidden={activeTab !== "overview"} importantForAccessibility={activeTab === "overview" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "overview" ? "flex" : "none" }}>
      <OverviewView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} showTable={showTable} onToggleTable={() => setShowTable((value) => !value)} />
    </View>
    <View nativeID={`${idPrefix}-panel-plans`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-plans`} aria-hidden={activeTab !== "plans"} importantForAccessibility={activeTab === "plans" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "plans" ? "flex" : "none" }}>
      <PlansView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-context`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-context`} aria-hidden={activeTab !== "context"} importantForAccessibility={activeTab === "context" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "context" ? "flex" : "none" }}>
      <ContextView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-validation`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-validation`} aria-hidden={activeTab !== "validation"} importantForAccessibility={activeTab === "validation" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "validation" ? "flex" : "none" }}>
      <ValidationView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-verification`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-verification`} aria-hidden={activeTab !== "verification"} importantForAccessibility={activeTab === "verification" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "verification" ? "flex" : "none" }}>
      <VerificationView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-uat`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-uat`} aria-hidden={activeTab !== "uat"} importantForAccessibility={activeTab === "uat" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "uat" ? "flex" : "none" }}>
      <UatView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-todos`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-todos`} aria-hidden={activeTab !== "todos"} importantForAccessibility={activeTab === "todos" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "todos" ? "flex" : "none" }}>
      <TodosView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-parking`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-parking`} aria-hidden={activeTab !== "parking"} importantForAccessibility={activeTab === "parking" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "parking" ? "flex" : "none" }}>
      <ParkingLotView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
    <View nativeID={`${idPrefix}-panel-debug`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-debug`} aria-hidden={activeTab !== "debug"} importantForAccessibility={activeTab === "debug" ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === "debug" ? "flex" : "none" }}>
      <DebugView state={state} theme={theme as BoardTheme} compact={compact} onRefresh={onRefresh} />
    </View>
  </View>;
}
