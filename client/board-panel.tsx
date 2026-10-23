import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import { BoardTabs, pathBadges, tabsFor, type BoardTab, type TabFocusTarget } from "./board-tabs.js";
import { coreBadges, OverviewView } from "./overview-components.js";
import { PlansView } from "./plans-components.js";
import { ContextView } from "./context-components.js";
import { ValidationView } from "./validation-components.js";
import { UatView } from "./uat-components.js";
import { VerificationView } from "./verification-components.js";
import { TodosView } from "./todos-components.js";
import { ParkingLotView } from "./parking-lot-components.js";
import { DebugView } from "./debug-components.js";
import { PathOverviewView } from "./path-overview-components.js";
import { PathQuestionsView } from "./path-questions-components.js";
import { PathReviewsView } from "./path-reviews-components.js";
import { PathTasksView } from "./path-tasks-components.js";
import { PathTimelineView } from "./path-timeline-components.js";
import { boardRpc, type BoardRequest, type BoardResponse } from "../shared/board-rpc.js";
import { ledgerRpc, usageRpc } from "../shared/usage.js";
import { createUsageController } from "./usage-controller.js";
import { PathLedgerView } from "./path-ledger-components.js";
import { PathRoadmapView } from "./path-roadmap-components.js";
import { createBoardState, snapshotChanges, type BoardReadingState } from "./board-state.js";
import type { BoardTheme } from "./board-components.js";

export type { BoardTheme, BoardViewState } from "./board-components.js";
/** `quiet` reads without announcing "Evidence updated."; an automatic refresh says what changed instead. */
export type BoardController = { getState(): BoardReadingState; subscribe(listener: () => void): () => void; setWorkspace(workspaceId: string): void; start(): void; poll(): Promise<void>; dispatch(intent: BoardRequest["intent"], options?: { quiet?: boolean }): Promise<void>; dispose(): void };

/** How often the panel asks whether the files changed; status is answered from memory, so this is cheap. */
const POLL_MS = 3_000;
/** A workspace the server no longer observes (its daemon restarted, or it was idle too long) is read again at most this often. */
const RECOVER_MS = 30_000;
/** When the files change, usage is read again at most this often: reading session logs costs more than reading the files. */
const USAGE_FOLLOW_MS = 60_000;

export function createBoardController({ workspaceId, callBoardRpc, clock = Date.now, pollMs = POLL_MS }: { workspaceId: string; callBoardRpc: (input: BoardRequest) => Promise<BoardResponse>; clock?: () => number; pollMs?: number }): BoardController {
  let state = createBoardState(workspaceId);
  let selectedWorkspaceId = workspaceId;
  let generation = 0;
  let disposed = false;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let recoveredAt = Number.NEGATIVE_INFINITY;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const controller: BoardController = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setWorkspace(nextWorkspaceId) { if (nextWorkspaceId === selectedWorkspaceId) return; selectedWorkspaceId = nextWorkspaceId; generation += 1; state = createBoardState(nextWorkspaceId); notify(); },
    start() { if (!statusTimer) statusTimer = setInterval(() => { void controller.poll(); }, pollMs); },
    /** Follows the files: a status poll that finds them changed, while nothing is being read, reads them again. */
    async poll() {
      if (disposed || state.busy) return;
      await controller.dispatch("status");
      const snapshot = state.snapshot;
      if (disposed || state.busy || state.statusFailed || !snapshot) return;
      if (snapshot.freshness === "stale") { await controller.dispatch("refresh", { quiet: true }); return; }
      // The server answers "absent" for a workspace it no longer observes; reading it again starts a new observation.
      if (snapshot.freshness === "refresh-failed" && snapshot.warnings.includes("absent") && clock() - recoveredAt >= RECOVER_MS) {
        recoveredAt = clock();
        await controller.dispatch("refresh", { quiet: true });
      }
    },
    async dispatch(intent, { quiet = false } = {}) {
      const requestWorkspaceId = selectedWorkspaceId;
      const requestGeneration = intent === "status" ? generation : ++generation;
      // A status poll leaves a read in progress, and its error, as they are.
      if (intent !== "status") { state = { ...state, busy: true, error: null, refreshAnnouncement: null }; notify(); }
      try {
        const response = await callBoardRpc({ workspaceId: requestWorkspaceId, intent });
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        if (response.kind === "snapshot") state = { ...state, snapshot: response.snapshot, busy: false, statusFailed: false, error: response.snapshot.freshness === "refresh-failed" ? "Could not refresh evidence." : null, refreshAnnouncement: intent === "refresh" && !quiet && response.snapshot.freshness === "current" ? "Evidence updated." : null, changes: snapshotChanges(state.snapshot, response.snapshot, clock()) ?? state.changes };
        else {
          const current = state.snapshot;
          // An unchanged status is not news: the views are not rendered again every poll.
          if (current && current.observedAt === response.observedAt && current.freshness === response.freshness && current.availability === response.availability && current.revision === response.revision
            && current.warnings.length === response.warnings.length && current.warnings.every((warning, index) => warning === response.warnings[index]) && !state.refreshAnnouncement && !state.statusFailed) return;
          state = { ...state, refreshAnnouncement: null, statusFailed: false, snapshot: current ? { ...current, observedAt: response.observedAt, freshness: response.freshness, availability: response.availability, revision: response.revision, warnings: response.warnings } : null };
        }
      } catch {
        if (disposed || requestWorkspaceId !== selectedWorkspaceId || requestGeneration !== generation) return;
        // A poll that gets no answer says so on its own; it is not a failed read of the files.
        state = intent === "status" ? { ...state, statusFailed: true } : { ...state, busy: false, error: "Could not refresh evidence.", refreshAnnouncement: null };
      }
      notify();
    },
    dispose() { disposed = true; generation += 1; if (statusTimer) clearInterval(statusTimer); listeners.clear(); },
  };
  return controller;
}

export function BoardPanel({ workspaceId, theme, layout, initialTab = "overview" }: PluginWorkspacePanelProps & { initialTab?: BoardTab }) {
  const callBoardRpc = useRpc(boardRpc);
  const controller = useMemo(() => createBoardController({ workspaceId, callBoardRpc }), [workspaceId, callBoardRpc]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const callUsageRpc = useRpc(usageRpc);
  const callLedgerRpc = useRpc(ledgerRpc);
  const usageController = useMemo(() => createUsageController({ workspaceId, callUsageRpc, callLedgerRpc }), [workspaceId, callUsageRpc, callLedgerRpc]);
  const usage = useSyncExternalStore(usageController.subscribe, usageController.getState, usageController.getState);
  // Paseo's live state for the workspace, beside the recorded pipeline state the board reads from the files.
  const agent = useWorkspace(workspaceId, (workspace) => ({ status: workspace.status, since: workspace.statusEnteredAt }));
  const [tabSelection, setTabSelection] = useState<{ workspaceId: string; tab: BoardTab }>({ workspaceId, tab: initialTab });
  const [focusedTab, setFocusedTab] = useState<BoardTab | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  // A tab's content is built the first time it is opened, then kept, so its own choices survive switching tabs.
  const [opened, setOpened] = useState<{ workspaceId: string; tabs: BoardTab[] }>({ workspaceId, tabs: [initialTab] });
  const tabRefs = useRef<Partial<Record<BoardTab, TabFocusTarget | null>>>({});
  const idPrefix = `board-${useId().replace(/:/g, "")}`;
  const flavor = state.snapshot?.flavor;
  const tabs = tabsFor(flavor);
  const selectedTab = tabSelection.workspaceId === workspaceId ? tabSelection.tab : "overview";
  const activeTab = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : "overview";
  const compact = layout.compact || panelWidth !== null && panelWidth < 760;
  // Usage is read only for GSD Path workspaces, apart from the snapshot; the ledger only when its tab asks for it.
  const onRefresh = () => { void controller.dispatch("refresh"); if (flavor === "gsd-path") void usageController.load(); };
  const onRefreshLedger = () => { onRefresh(); if (usage.ledger.loaded) void usageController.loadLedger(false); };
  const navigate = (tab: BoardTab) => {
    setTabSelection({ workspaceId, tab });
    setOpened((previous) => previous.workspaceId === workspaceId ? previous.tabs.includes(tab) ? previous : { workspaceId, tabs: [...previous.tabs, tab] } : { workspaceId, tabs: [tab] });
  };
  const built = new Set([...(opened.workspaceId === workspaceId ? opened.tabs : []), activeTab]);
  useEffect(() => { controller.start(); void controller.dispatch("snapshot"); return () => controller.dispose(); }, [controller]);
  useEffect(() => () => usageController.dispose(), [usageController]);
  useEffect(() => { if (flavor === "gsd-path") void usageController.load(); }, [flavor, usageController]);
  useEffect(() => { if (flavor === "gsd-path" && state.changes) void usageController.loadIfOlderThan(USAGE_FOLLOW_MS); }, [flavor, state.changes, usageController]);
  useEffect(() => { setShowTable(false); }, [workspaceId]);
  const view = { state, theme: theme as BoardTheme, compact, onRefresh };
  const panels: Record<BoardTab, () => ReactNode> = {
    overview: () => flavor === "gsd-path" ? <PathOverviewView {...view} usage={usage} agent={agent} onNavigate={navigate} /> : <OverviewView {...view} agent={agent} onNavigate={navigate} showTable={showTable} onToggleTable={() => setShowTable((value) => !value)} />,
    plans: () => <PlansView {...view} />,
    context: () => <ContextView {...view} />,
    validation: () => <ValidationView {...view} />,
    verification: () => <VerificationView {...view} />,
    uat: () => <UatView {...view} />,
    todos: () => <TodosView {...view} />,
    parking: () => <ParkingLotView {...view} />,
    debug: () => <DebugView {...view} />,
    roadmap: () => <PathRoadmapView {...view} usage={usage} />,
    tasks: () => <PathTasksView {...view} usage={usage} />,
    timeline: () => <PathTimelineView {...view} usage={usage} />,
    reviews: () => <PathReviewsView {...view} />,
    questions: () => <PathQuestionsView {...view} />,
    ledger: () => <PathLedgerView {...view} usage={usage} onRefresh={onRefreshLedger} onLoadLedger={(more) => { void usageController.loadLedger(more); }} />,
  };
  return <View onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
    <BoardTabs tabs={tabs} badges={flavor === "gsd-path" ? pathBadges(state.snapshot?.path) : flavor === "gsd-core" ? coreBadges(state.snapshot?.overview) : {}} activeTab={activeTab} focusedTab={focusedTab} onSelect={navigate} onFocus={setFocusedTab} idPrefix={idPrefix} tabRefs={tabRefs} theme={theme as BoardTheme} compact={compact} />
    {tabs.map(({ id }) => <View key={id} nativeID={`${idPrefix}-panel-${id}`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${id}`} aria-hidden={activeTab !== id} importantForAccessibility={activeTab === id ? "auto" : "no-hide-descendants"} style={{ flex: 1, minHeight: 0, display: activeTab === id ? "flex" : "none" }}>
      {built.has(id) ? panels[id]() : null}
    </View>)}
  </View>;
}
