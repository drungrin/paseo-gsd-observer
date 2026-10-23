import { useState } from "react";
import { Text, View } from "react-native";
import type { BoardTodos, TodoItem, TodoImportance } from "../shared/todos.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { Badge, BoardFrame, Card, Count, FilterChip, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { kicker, Legend, SegmentBar, tint, toneColor } from "./ui-kit.js";

type LifecycleFilter = "all" | TodoItem["lifecycle"];
type Filter = { workspaceId: string; lifecycle: LifecycleFilter; importance: TodoImportance | "all" };
const lifecycleFilters: readonly LifecycleFilter[] = ["all", "pending", "backlog", "completed", "root-unclassified"];
const lifecycleLabels: Record<LifecycleFilter, string> = { all: "All", pending: "Pending", backlog: "Backlog", completed: "Completed", "root-unclassified": "Unclassified" };
const body = textStyle;
const small = smallStyle;
const directoryLabels: Record<TodoItem["directory"], string> = { pending: "Pending folder", backlog: "Backlog folder", deferred: "Deferred folder", done: "Done folder", completed: "Completed folder", root: "TODO root" };

export const matchedTodos = (data: BoardTodos, lifecycle: LifecycleFilter, importance: TodoImportance | "all"): TodoItem[] => data.items.filter((item) =>
  (lifecycle === "all" || item.lifecycle === lifecycle) && (importance === "all" || item.priority === importance || item.severity === importance));

function Meta({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={small(theme)}><Text style={{ ...small(theme, false), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function TodoCard({ item, theme }: { item: TodoItem; theme: BoardTheme; compact: boolean }) {
  const attention = item.statusConflict || item.duplicateName;
  return <Card title={item.title ?? "Title unavailable"} theme={theme} attention={attention}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 6 }}>
      <Badge label={directoryLabels[item.directory]} theme={theme} />
      {item.recordedStatus && <Badge label={`Recorded status: ${item.recordedStatus.replace(/-/g, " ")}`} theme={theme} attention={item.statusConflict} />}
      {item.severity && <Badge label={`Severity: ${item.severity}`} theme={theme} />}
      {item.priority && <Badge label={`Priority: ${item.priority}`} theme={theme} />}
    </View>
    {attention && <View style={{ gap: 3 }}>
      {item.statusConflict && <Text role="alert" style={small(theme, false)}>Recorded status disagrees with the folder; both are shown without changing the task.</Text>}
      {item.duplicateName && <Text role="alert" style={small(theme, false)}>Another TODO file has the same name in a different folder; both records are shown.</Text>}
    </View>}
    {(item.area || item.phaseId || item.createdAt || item.completedAt) && <View style={{ gap: 2 }}>
      <Meta label="Area" value={item.area} theme={theme} />
      <Meta label="Related phase" value={item.phaseId} theme={theme} />
      {item.createdAt && <Meta label="Created" value={item.createdAt} theme={theme} />}
      {item.completedAt && <Meta label="Completed" value={item.completedAt} theme={theme} />}
    </View>}
    {item.summary && <Text style={body(theme, true)}>{item.summary}</Text>}
  </Card>;
}

const folderColor = (theme: BoardTheme, folder: "pending" | "backlog" | "done" | "root") => folder === "pending" ? theme.colors.foreground : folder === "backlog" ? tint(theme, theme.colors.foregroundMuted, 0.5)
  : folder === "done" ? toneColor(theme, "success") : tint(theme, toneColor(theme, "warning"), 0.6);

/** The files by folder; when the inventory is incomplete each figure is a lower bound. */
function FolderBar({ counts, lowerBound, theme }: ThemeProps & { counts: BoardTodos["counts"]; lowerBound: boolean }) {
  const least = lowerBound ? "at least " : "";
  const folders = [
    { key: "pending" as const, value: counts.pending, label: "pending" },
    { key: "backlog" as const, value: counts.backlog + counts.deferred, label: "backlog or deferred" },
    { key: "done" as const, value: counts.done + counts.completed, label: "done or completed" },
    { key: "root" as const, value: counts.root, label: "at the root" },
  ];
  return <View style={{ gap: 8 }}>
    <SegmentBar theme={theme} height={12} label={folders.map((folder) => `${least}${folder.value} ${folder.label}`).join(", ")} segments={folders.map((folder) => ({ label: folder.key, value: folder.value, color: folderColor(theme, folder.key) }))} />
    <Legend theme={theme} items={folders.filter((folder) => folder.value > 0).map((folder) => ({ color: folderColor(theme, folder.key), label: `${least}${folder.value} ${folder.label}` }))} />
  </View>;
}

/** The caveats behind the TODOs tab. */
export const todosNotes = () => [
  "Standalone planning TODO files for this workspace. Read-only; phase plans, UAT and roadmap parking-lot work remain in their own views.",
  "Folder counts exclude unreadable files and are not inferred work states.",
];

export function TodosView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [filter, setFilter] = useState<Filter>({ workspaceId: state.workspaceId, lifecycle: "all", importance: "all" });
  const data = state.snapshot?.overview?.todos;
  const lifecycle = filter.workspaceId === state.workspaceId ? filter.lifecycle : "all";
  const importance = filter.workspaceId === state.workspaceId ? filter.importance : "all";
  const set = (next: Partial<Filter>) => setFilter({ workspaceId: state.workspaceId, lifecycle, importance, ...next });
  const availableImportance = data ? [...new Set(data.items.flatMap((item) => [item.severity, item.priority]).filter((value): value is TodoImportance => !!value))].sort() : [];
  const listed = data ? matchedTodos(data, lifecycle, importance) : [];
  const qualifiers = data ? [
    data.limited ? "The TODO inventory or its safe excerpts are incomplete; counts cover only observed files." : null,
    data.counts.unavailable ? `${plural(data.counts.unavailable, "TODO observation")} unavailable.` : null,
    data.counts.duplicates ? `${plural(data.counts.duplicates, "file")} share names across folders.` : null,
    data.counts.conflicts ? `${plural(data.counts.conflicts, "folder/status disagreement")}.` : null,
  ].filter((value): value is string => !!value) : [];
  return <BoardFrame title="TODOs" description="Standalone TODO files, by the folder they sit in." subject="TODOs" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={qualifiers} notes={todosNotes()}>
    {data?.availability === "available" ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Count label="Pending folder" value={data.counts.pending} theme={theme} />
        <Count label="Backlog / deferred folders" value={data.counts.backlog + data.counts.deferred} theme={theme} />
        <Count label="Done / completed folders" value={data.counts.done + data.counts.completed} theme={theme} />
        <Count label="Root-level files" value={data.counts.root} theme={theme} />
      </View>
      {data.counts.totalFiles > 0 && <FolderBar counts={data.counts} lowerBound={!data.countsComplete} theme={theme} />}
      <Text style={small(theme)}>{data.countsComplete ? plural(data.counts.totalFiles, "file") : `At least ${plural(data.counts.totalFiles, "file")}`} safely read · {plural(data.counts.distinctTasks, "distinct filename")} · {plural(data.counts.displayed, "safe card")} shown.</Text>
      {data.counts.totalFiles > 0 && <>
        <View style={{ gap: 7 }}><Text role="heading" style={kicker(theme)}>Folder status</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {lifecycleFilters.map((value) => <FilterChip key={value} label={lifecycleLabels[value]} selected={lifecycle === value} onPress={() => set({ lifecycle: value })} theme={theme} />)}
          </View>
        </View>
        {(availableImportance.length > 0 || importance !== "all") && <View style={{ gap: 7 }}><Text role="heading" style={kicker(theme)}>Recorded severity or priority</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <FilterChip label="Any importance" selected={importance === "all"} onPress={() => set({ importance: "all" })} theme={theme} />
            {availableImportance.map((value) => <FilterChip key={value} label={value} selected={importance === value} onPress={() => set({ importance: value })} theme={theme} />)}
          </View>
        </View>}
        <View style={{ gap: 10 }}>
          <Text style={small(theme)}>{plural(listed.length, "record")} {listed.length === 1 ? "matches" : "match"} the current filters{data.counts.displayed < data.counts.totalFiles ? "; additional files may not have safe cards" : ""}.</Text>
          {listed.length ? listed.map((item, index) => <TodoCard key={index} item={item} theme={theme} compact={compact} />)
            : <Card title="No matching TODOs" theme={theme}><Text style={body(theme, true)}>No safe TODO cards match these filters. Try a different folder status or importance.</Text></Card>}
        </View>
      </>}
      {!data.counts.totalFiles && <Card title={data.counts.unavailable ? "TODO inventory incomplete" : data.directoryState === "absent" ? "No TODO directory" : "No standalone TODO files"} theme={theme}>
        <Text style={body(theme, true)}>{data.counts.unavailable ? "TODO files or directories could not be safely inspected; no records are shown." : data.directoryState === "absent" ? "No .planning/todos directory was observed for this workspace." : data.directoryState === "observed" ? "The observed TODO directory has no allowlisted files." : "No TODO files were observed; the directory state is unknown."}</Text>
      </Card>}
    </> : <Card title="TODOs unavailable" theme={theme}><Text style={body(theme, true)}>No readable planning inventory was found for this workspace.</Text></Card>}
  </BoardFrame>;
}
