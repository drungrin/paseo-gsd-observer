import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import { BoardTabs, tabsFor, type BoardTab, type TabFocusTarget } from "./board-tabs.js";
import { OverviewView } from "./overview-components.js";
import { PlansView } from "./plans-components.js";
import { ContextView } from "./context-components.js";
import { ValidationView } from "./validation-components.js";
import { UatView } from "./uat-components.js";
import { VerificationView } from "./verification-components.js";
import { TodosView } from "./todos-components.js";
import { ParkingLotView } from "./parking-lot-components.js";
import { DebugView } from "./debug-components.js";
import { PathOverviewView } from "./path-overview-components.js";
import { PathTasksView } from "./path-tasks-components.js";
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
  const flavor = state.snapshot?.flavor;
  const tabs = tabsFor(flavor);
  const selectedTab = tabSelection.workspaceId === workspaceId ? tabSelection.tab : "overview";
  const activeTab = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : "overview";
  const compact = layout.compact || panelWidth !== null && panelWidth < 760;
  const onRefresh = () => { void controller.dispatch("refresh"); };
  useEffect(() => { controller.start(); void controller.dispatch("snapshot"); return () => controller.dispose(); }, [controller]);
  useEffect(() => { setShowTable(false); }, [workspaceId]);
  const view = { state, theme: theme as BoardTheme, compact, onRefresh };
  const panels: Record<BoardTab, () => ReactNode> = {
    overview: () => flavor === "gsd-path" ? <PathOverviewView {...view} /> : <OverviewView {...view} showTable={showTable} onToggleTable={() => setShowTable((value) => !value)} />,
    plans: () => <PlansView {...view} />,
    context: () => <ContextView {...view} />,
    validation: () => <ValidationView {...view} />,
    verification: () => <VerificationView {...view} />,
    uat: () => <UatView {...view} />,
    todos: () => <TodosView {...view} />,
    parking: () => <ParkingLotView {...view} />,
    debug: () => <DebugView {...view} />,
    tasks: () => <PathTasksView {...view} />,
  };
  return <View onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
    <BoardTabs tabs={tabs} activeTab={activeTab} focusedTab={focusedTab} onSelect={(tab) => setTabSelection({ workspaceId, tab })} onFocus={setFocusedTab} idPrefix={idPrefix} tabRefs={tabRefs} theme={theme as BoardTheme} compact={compact} />
    {tabs.map(({ id }) => <View key={id} nativeID={`${idPrefix}-panel-${id}`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${id}`} aria-hidden={activeTab !== id} importantForAccessibility={activeTab === id ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === id ? "flex" : "none" }}>
      {panels[id]()}
    </View>)}
  </View>;
}
