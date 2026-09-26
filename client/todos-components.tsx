import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardTodos, TodoItem, TodoImportance } from "../shared/todos.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

type LifecycleFilter = "all" | TodoItem["lifecycle"];
type Filter = { workspaceId: string; lifecycle: LifecycleFilter; importance: TodoImportance | "all" };
const lifecycleFilters: readonly LifecycleFilter[] = ["all", "pending", "backlog", "completed", "root-unclassified"];
const lifecycleLabels: Record<LifecycleFilter, string> = { all: "All", pending: "Pending", backlog: "Backlog", completed: "Completed", "root-unclassified": "Unclassified" };
const directoryLabels: Record<TodoItem["directory"], string> = { pending: "Pending folder", backlog: "Backlog folder", deferred: "Deferred folder", done: "Done folder", completed: "Completed folder", root: "TODO root" };
const colors = (theme: BoardTheme) => ({ border: theme.colors.border ?? theme.colors.foregroundMuted, surface: theme.colors.surface1 ?? theme.colors.surface0 });
const body = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
const small = (theme: BoardTheme, muted = true) => ({ ...body(theme, muted), fontSize: 12, lineHeight: 18 });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const matchedTodos = (data: BoardTodos, lifecycle: LifecycleFilter, importance: TodoImportance | "all"): TodoItem[] => data.items.filter((item) =>
  (lifecycle === "all" || item.lifecycle === lifecycle) && (importance === "all" || item.priority === importance || item.severity === importance));

function Card({ title, subtitle, children, theme }: { title: string; subtitle?: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ minWidth: 0, padding: 16, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: colors(theme).border, backgroundColor: colors(theme).surface }}>
    <View style={{ gap: 2 }}><Text role="heading" style={{ ...body(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>{subtitle && <Text style={small(theme)}>{subtitle}</Text>}</View>
    {children}
  </View>;
}

function FilterButton({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress(): void; theme: BoardTheme }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${label}`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: selected ? theme.colors.accent : colors(theme).border, backgroundColor: selected ? theme.colors.surface2 ?? theme.colors.surface0 : colors(theme).surface }}>
    <Text style={{ ...body(theme), fontWeight: selected ? "600" : "400" }}>{label}</Text>
  </Pressable>;
}

function Count({ label, value, theme, attention = false }: { label: string; value: number; theme: BoardTheme; attention?: boolean }) {
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 140, flexGrow: 1, padding: 12, gap: 3, borderRadius: 8, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : colors(theme).border, backgroundColor: colors(theme).surface }}>
    <Text style={small(theme)}>{label}</Text><Text style={{ ...body(theme), fontWeight: "600", fontSize: 18 }}>{value}</Text>
  </View>;
}

function Meta({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={small(theme)}><Text style={{ ...small(theme, false), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function TodoCard({ item, theme, compact }: { item: TodoItem; theme: BoardTheme; compact: boolean }) {
  const attention = item.statusConflict || item.duplicateName;
  return <Card title={item.title ?? "Title unavailable"} theme={theme}>
    <View style={{ flexDirection: compact ? "column" : "row", flexWrap: "wrap", alignItems: "flex-start", gap: 8 }}>
      <Text style={{ ...small(theme, false), fontWeight: "600" }}>{directoryLabels[item.directory]}</Text>
      {item.recordedStatus && <Text style={small(theme)}>Recorded status: {item.recordedStatus.replace(/-/g, " ")}</Text>}
      {item.severity && <Text style={small(theme)}>Severity: {item.severity}</Text>}
      {item.priority && <Text style={small(theme)}>Priority: {item.priority}</Text>}
    </View>
    {attention && <View style={{ gap: 3 }}>
      {item.statusConflict && <Text role="alert" style={small(theme, false)}>Recorded status disagrees with the folder; both are shown without changing the task.</Text>}
      {item.duplicateName && <Text role="alert" style={small(theme, false)}>Another TODO file has the same name in a different folder; both records are shown.</Text>}
    </View>}
    <Meta label="Area" value={item.area} theme={theme} />
    <Meta label="Related phase" value={item.phaseId} theme={theme} />
    {item.createdAt && <Meta label="Created" value={item.createdAt} theme={theme} />}
    {item.completedAt && <Meta label="Completed" value={item.completedAt} theme={theme} />}
    {item.summary && <Text style={body(theme, true)}>{item.summary}</Text>}
  </Card>;
}

export function TodosView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [filter, setFilter] = useState<Filter>({ workspaceId: state.workspaceId, lifecycle: "all", importance: "all" });
  const data = state.snapshot?.overview?.todos;
  const lifecycle = filter.workspaceId === state.workspaceId ? filter.lifecycle : "all";
  const importance = filter.workspaceId === state.workspaceId ? filter.importance : "all";
  const set = (next: Partial<Filter>) => setFilter({ workspaceId: state.workspaceId, lifecycle, importance, ...next });
  const availableImportance = data ? [...new Set(data.items.flatMap((item) => [item.severity, item.priority]).filter((value): value is TodoImportance => !!value))].sort() : [];
  const listed = data ? matchedTodos(data, lifecycle, importance) : [];
  const { border, surface } = colors(theme);
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 16 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...body(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>TODOs</Text>
        <Text style={body(theme, true)}>Standalone planning TODO files for this workspace. Read-only; phase plans, UAT and roadmap parking-lot work remain in their own views.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing TODOs" : "Refresh TODOs"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh}
        style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: border, backgroundColor: surface }}><Text style={body(theme)}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={body(theme, true)}>Loading TODOs…</Text> : <>
      {state.error && <Text role="alert" style={body(theme)}>Could not refresh TODOs. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={body(theme, true)}>Planning files may have changed. Refresh to update TODOs.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={body(theme, true)}>{state.refreshAnnouncement}</Text>}
      {data?.availability === "available" ? <>
        {data.limited && <Text role="alert" style={small(theme)}>The TODO inventory or its safe excerpts are incomplete; counts cover only observed files.</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Count label="Pending folder" value={data.counts.pending} theme={theme} />
          <Count label="Backlog / deferred folders" value={data.counts.backlog + data.counts.deferred} theme={theme} />
          <Count label="Done / completed folders" value={data.counts.done + data.counts.completed} theme={theme} />
          <Count label="Root-level files" value={data.counts.root} theme={theme} />
        </View>
        <Text style={small(theme)}>{data.countsComplete ? plural(data.counts.totalFiles, "file") : `At least ${plural(data.counts.totalFiles, "file")}`} safely read · {plural(data.counts.distinctTasks, "distinct filename")} · {plural(data.counts.displayed, "safe card")} shown. Folder counts exclude unreadable files and are not inferred work states.</Text>
        {(data.counts.unavailable > 0 || data.counts.duplicates > 0 || data.counts.conflicts > 0) && <Text role="alert" style={small(theme, false)}>{[
          data.counts.unavailable ? `${plural(data.counts.unavailable, "TODO observation")} unavailable` : null,
          data.counts.duplicates ? `${plural(data.counts.duplicates, "file")} share names across folders` : null,
          data.counts.conflicts ? `${plural(data.counts.conflicts, "folder/status disagreement")}` : null,
        ].filter(Boolean).join(" · ")}.</Text>}
        {data.counts.totalFiles > 0 && <>
          <View style={{ gap: 7 }}><Text role="heading" style={{ ...body(theme), fontWeight: "600" }}>Folder status</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {lifecycleFilters.map((value) => <FilterButton key={value} label={lifecycleLabels[value]} selected={lifecycle === value} onPress={() => set({ lifecycle: value })} theme={theme} />)}
            </View>
          </View>
          {(availableImportance.length > 0 || importance !== "all") && <View style={{ gap: 7 }}><Text role="heading" style={{ ...body(theme), fontWeight: "600" }}>Recorded severity or priority</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <FilterButton label="Any importance" selected={importance === "all"} onPress={() => set({ importance: "all" })} theme={theme} />
              {availableImportance.map((value) => <FilterButton key={value} label={value} selected={importance === value} onPress={() => set({ importance: value })} theme={theme} />)}
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
    </>}
  </ScrollView>;
}
