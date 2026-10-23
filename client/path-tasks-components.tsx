import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PathTask, PathWave } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, borderColor, Card, Count, PATH_WARNING_COPY, PathFrame, plural, SetupNotice, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./path-components.js";

const attentionStatuses = new Set(["failed", "blocked"]);

/** The badges describing one task, in reading order. */
export function taskFacts(task: PathTask): string[] {
  return [
    tokenLabel(task.status, "Status not recorded"),
    ...(task.repo ? [`Member: ${task.repo}`] : []),
    ...(task.deps.length ? [`Depends on ${task.deps.join(", ")}`] : []),
    ...(task.supersedes.length ? [`Supersedes ${task.supersedes.join(", ")}`] : []),
    ...(task.files ? [plural(task.files, "file")] : []),
  ];
}

function TaskRow({ task, theme, compact }: ThemeProps & { task: PathTask; compact: boolean }) {
  return <View role="listitem" style={{ flexDirection: compact ? "column" : "row", gap: compact ? 5 : 12, paddingHorizontal: compact ? 14 : 18, paddingVertical: 10, borderTopWidth: 1, borderColor: borderColor(theme) }}>
    <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : 64 }}>{task.id}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <Text style={textStyle(theme, !task.title)}>{task.title ?? "Title not safely displayable"}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {taskFacts(task).map((fact, index) => <Badge key={fact} label={fact} theme={theme} attention={index === 0 && attentionStatuses.has(task.status ?? "")} />)}
      </View>
      {task.idConflict && <Text role="alert" style={smallStyle(theme, false)}>The file records a different task id; the file name's id is shown.</Text>}
    </View>
  </View>;
}

function WaveGroup({ wave, expanded, onToggle, theme, compact }: ThemeProps & { wave: PathWave; expanded: boolean; onToggle(): void; compact: boolean }) {
  const done = wave.tasks.filter((task) => task.status === "done").length;
  const title = `Wave ${wave.number}${wave.name ? ` · ${wave.name}` : ""}${wave.current ? " · Current" : ""}`;
  const progress = wave.tasks.length ? `${done} of ${plural(wave.tasks.length, "task")} recorded done` : "No task files for this wave";
  return <View style={{ minWidth: 0, borderRadius: 10, borderWidth: 1, borderColor: wave.current ? theme.colors.accent : borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${progress}.${wave.inPlan ? "" : " Not listed in the plan."} ${expanded ? "Hide tasks" : "Show tasks"}.`} accessibilityState={{ expanded }} onPress={onToggle} style={{ minHeight: 56, padding: compact ? 14 : 18, flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text style={{ ...textStyle(theme), fontWeight: "600", fontSize: 16 }}>{title}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Text style={smallStyle(theme)}>{progress}</Text>{!wave.inPlan && <Badge label="Not in PLAN.md" theme={theme} attention />}</View>
      </View>
      <Text style={{ ...textStyle(theme), fontSize: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: borderColor(theme) }}>{expanded ? "Hide tasks  ⌃" : "Show tasks  ⌄"}</Text>
    </Pressable>
    {expanded && <>
      {wave.goal && <View style={{ gap: 3, paddingHorizontal: compact ? 14 : 18, paddingBottom: 12 }}>
        <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "600" }}>Goal</Text>
        <Text style={textStyle(theme, true)}>{wave.goal}</Text>
        {wave.goalShortened && <Text style={smallStyle(theme)}>The goal was shortened for safe display.</Text>}
      </View>}
      {wave.tasks.length ? <View role="list" accessibilityLabel={`Tasks in wave ${wave.number}`}>{wave.tasks.map((task) => <TaskRow key={task.id} task={task} theme={theme} compact={compact} />)}</View>
        : <Text style={{ ...textStyle(theme, true), paddingHorizontal: compact ? 14 : 18, paddingVertical: 12, borderTopWidth: 1, borderColor: borderColor(theme) }}>The plan lists this wave, but no task file records it.</Text>}
    </>}
  </View>;
}

export function PathTasksView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [selected, setSelected] = useState<{ workspaceId: string; wave: number | null } | null>(null);
  const path = state.snapshot?.path;
  const tasks = path?.tasks;
  const defaultWave = tasks?.waves.find((wave) => wave.current)?.number ?? tasks?.waves[0]?.number ?? null;
  const open = selected?.workspaceId === state.workspaceId ? selected.wave : defaultWave;
  const warnings = path?.warnings.filter((warning) => warning.startsWith("plan-") || warning.startsWith("task")) ?? [];
  return <PathFrame title="Tasks" description="Waves from PLAN.md and the task files of the current milestone." subject="tasks" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : tasks?.availability === "available" ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Count label="Tasks" value={tasks.counts.total} theme={theme} />
        <Count label="Done" value={tasks.counts.done} theme={theme} />
        <Count label="In progress" value={tasks.counts.inProgress} theme={theme} />
        <Count label="Pending" value={tasks.counts.pending} theme={theme} />
        <Count label="Failed or blocked" value={tasks.counts.failed + tasks.counts.blocked} theme={theme} attention={tasks.counts.failed + tasks.counts.blocked > 0} />
      </View>
      <Text style={smallStyle(theme)}>Statuses as the orchestrator recorded them; a done task is not a review verdict.{tasks.counts.other ? ` ${plural(tasks.counts.other, "task")} without a known status.` : ""}{tasks.planObserved ? "" : " No readable PLAN.md, so waves come from the task files only."}</Text>
      {tasks.limited && <Text role="alert" style={textStyle(theme, true)}>Some task evidence could not be fully read; counts may be partial.</Text>}
      {warnings.map((warning) => <Text key={warning} style={smallStyle(theme)}>{PATH_WARNING_COPY[warning]}</Text>)}
      {tasks.waves.length ? tasks.waves.map((wave) => <WaveGroup key={wave.number} wave={wave} expanded={wave.number === open} onToggle={() => setSelected({ workspaceId: state.workspaceId, wave: open === wave.number ? null : wave.number })} theme={theme} compact={compact} />)
        : <Text style={textStyle(theme, true)}>No waves are recorded yet.</Text>}
      {tasks.unassigned.length > 0 && <Card title="Tasks without a wave" theme={theme} attention>
        <View role="list" accessibilityLabel="Tasks without a wave" style={{ marginHorizontal: -20, marginBottom: -20 }}>{tasks.unassigned.map((task) => <TaskRow key={task.id} task={task} theme={theme} compact={compact} />)}</View>
      </Card>}
    </> : <Card title={tasks?.availability === "absent" ? "No tasks yet" : "Tasks unavailable"} theme={theme}>
      <Text style={textStyle(theme, true)}>{tasks?.availability === "absent" ? "No plan or task files yet. GSD Path writes them in the plan phase." : "The plan and task files could not be read safely."}</Text>
    </Card>}
  </PathFrame>;
}
