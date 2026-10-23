import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { BoardPath, PathTask, PathWave } from "../shared/path.js";
import type { UsageTask } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, borderColor, Card, BoardFrame, plural, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./board-frame.js";
import { SetupNotice, statusColor, statusGlyph, statusTone, taskLegend, TaskBar, warningAlerts } from "./path-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { duration, integer, money } from "./usage-format.js";
import { clockTime, figures, Flash, kicker, Legend, line, Pill, Pulse, Section, Stat, surface, text, tint, toneColor, Toggle } from "./ui-kit.js";

const attentionStatuses = new Set(["failed", "blocked"]);
/** How long a task that just changed keeps its ring when the tab is opened after the change. */
const FLASH_MS = 6_000;

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

/** The task the grid opens on: one in progress, else the current wave's first unfinished one, else the first unfinished, else the last. */
export function defaultTask(path: BoardPath): PathTask | null {
  const tasks = [...path.tasks.waves.flatMap((wave) => wave.tasks), ...path.tasks.unassigned];
  return tasks.find((task) => task.status === "in-progress") ?? path.tasks.waves.find((wave) => wave.current)?.tasks.find((task) => task.status !== "done")
    ?? tasks.find((task) => task.status !== "done") ?? tasks.at(-1) ?? null;
}

/** The tasks a task depends on (upstream) and the tasks that depend on it (downstream). */
export function relatedTasks(task: PathTask, tasks: readonly PathTask[]): Map<string, "upstream" | "downstream"> {
  const related = new Map<string, "upstream" | "downstream">(task.deps.map((id) => [id, "upstream"]));
  for (const other of tasks) if (other.deps.includes(task.id)) related.set(other.id, "downstream");
  return related;
}

type Mode = "status" | "spend";

function Tile({ task, spend, maxCost, mode, selected, relation, flash, onPress, theme }: ThemeProps & { task: PathTask; spend: UsageTask | undefined; maxCost: number; mode: Mode; selected: boolean; relation: "upstream" | "downstream" | null; flash: number | null; onPress(): void }) {
  const color = statusColor(theme, task.status);
  const accent = toneColor(theme, "accent");
  const pending = !task.status || task.status === "pending";
  const background = mode === "spend" ? spend?.cost ? tint(theme, accent, 0.07 + 0.55 * spend.cost / Math.max(maxCost, spend.cost)) : surface(theme, 2) : pending ? surface(theme, 2) : tint(theme, color, 0.16);
  const border = selected ? accent : relation === "upstream" ? toneColor(theme, "warning") : relation === "downstream" ? theme.colors.foreground : pending ? line(theme) : "transparent";
  const relationWords = relation === "upstream" ? ", needed by the selected task" : relation === "downstream" ? ", waits on the selected task" : "";
  return <View role="listitem"><Flash signal={flash} color={accent} radius={12}>
    <Pressable role="button" accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} accessibilityLabel={`${task.id}, ${tokenLabel(task.status, "status not recorded")}${task.title ? `, ${task.title}` : ""}${spend?.cost != null ? `, ${money(spend.cost)}` : ""}${relationWords}`} onPress={onPress}
      // React Native Web reports hover to the style callback; native platforms never set it.
      style={(state) => ({ width: 92, height: 68, padding: 9, justifyContent: "space-between", borderRadius: 12, backgroundColor: background, borderWidth: selected || relation ? 2 : 1, borderColor: border, borderStyle: relation || pending ? "dashed" : "solid", transform: [{ translateY: (state as { hovered?: boolean }).hovered ? -2 : 0 }] })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ ...text(theme, 13, "700"), ...figures }}>{task.id}</Text>
        {task.status === "in-progress" ? <View style={{ margin: -6 }}><Pulse color={color} size={6} /></View> : <Text style={{ ...text(theme, 12, "700"), color: pending ? theme.colors.foregroundMuted : color }}>{statusGlyph(task.status)}</Text>}
      </View>
      <Text numberOfLines={1} style={{ ...text(theme, 11, "500", mode === "status"), ...figures }}>{mode === "spend" ? spend ? money(spend.cost) : "no turns" : task.files ? plural(task.files, "file") : tokenLabel(task.status, "—").toLowerCase()}</Text>
    </Pressable>
  </Flash></View>;
}

function WaveLane({ wave, label, spend, maxCost, mode, selected, related, flash, onSelect, theme, compact }: ThemeProps & { wave: PathWave; label: string; spend: Map<string, UsageTask>; maxCost: number; mode: Mode; selected: string | null; related: Map<string, "upstream" | "downstream">; flash(id: string): number | null; onSelect(id: string): void; compact: boolean }) {
  const done = wave.tasks.filter((task) => task.status === "done").length;
  const cost = wave.tasks.reduce((sum, task) => sum + (spend.get(task.id)?.cost ?? 0), 0);
  const seconds = wave.tasks.reduce((sum, task) => sum + (spend.get(task.id)?.durationS ?? 0), 0);
  const finished = wave.tasks.length > 0 && done === wave.tasks.length;
  return <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 10 : 18, paddingVertical: 16, borderTopWidth: 1, borderColor: line(theme) }}>
    <View style={{ width: compact ? undefined : 220, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text role="heading" style={{ ...text(theme, 22, "700"), ...figures, color: wave.current ? toneColor(theme, "accent") : finished ? toneColor(theme, "success") : theme.colors.foreground }}>{label}</Text>
        {wave.current && <Pill theme={theme} tone="accent" label="Current" />}
        {finished && !wave.current && <Pill theme={theme} tone="success" glyph="✓" label="Done" />}
        {!wave.inPlan && <Pill theme={theme} tone="warning" label="Not in PLAN.md" />}
      </View>
      <Text style={text(theme, 13, "600")}>{wave.name ?? (wave.number ? "Unnamed wave" : "Tasks without a wave")}</Text>
      <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{done} of {plural(wave.tasks.length, "task")} recorded done{cost ? ` · ${money(Math.round(cost * 100) / 100)}` : ""}{seconds ? ` · ${duration(seconds)} agent time` : ""}</Text>
      {wave.goal && <Text numberOfLines={3} style={text(theme, 12, "400", true)}>{wave.goal}</Text>}
    </View>
    <View role="list" accessibilityLabel={`Tasks in ${wave.number ? `wave ${wave.number}` : "no wave"}`} style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, alignContent: "flex-start" }}>
      {wave.tasks.length ? wave.tasks.map((task) => <Tile key={task.id} task={task} spend={spend.get(task.id)} maxCost={maxCost} mode={mode} selected={selected === task.id} relation={related.get(task.id) ?? null} flash={flash(task.id)} onPress={() => onSelect(task.id)} theme={theme} />)
        : <Text style={text(theme, 13, "400", true)}>The plan lists this wave, but no task file records it.</Text>}
    </View>
  </View>;
}

function TaskDetail({ task, tasks, spend, onSelect, theme, compact }: ThemeProps & { task: PathTask; tasks: readonly PathTask[]; spend: UsageTask | undefined; onSelect(id: string): void; compact: boolean }) {
  const dependents = tasks.filter((other) => other.deps.includes(task.id)).map((other) => other.id);
  const tone = statusTone(task.status);
  const chips = (ids: readonly string[], chipTone: "warning" | "neutral") => ids.length ? ids.map((id) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Select ${id}`} onPress={() => onSelect(id)}><Pill theme={theme} tone={chipTone} label={id} /></Pressable>) : <Text style={text(theme, 12, "400", true)}>nothing</Text>;
  const span = spend?.first && spend.last ? (Date.parse(spend.last) - Date.parse(spend.first)) / 1000 : null;
  return <Section theme={theme} tone={tone === "neutral" ? undefined : tone} gap={14}>
    <View style={{ flexDirection: compact ? "column" : "row", gap: 16, justifyContent: "space-between" }}>
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        <Text style={kicker(theme)}>{[task.id, task.wave !== null ? `wave ${task.wave}` : null, task.repo ? `member ${task.repo}` : null].filter(Boolean).join(" · ")}</Text>
        <Text role="heading" style={text(theme, 17, "600", !task.title)}>{task.title ?? "Title not safely displayable"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Pill theme={theme} tone={tone} glyph={statusGlyph(task.status)} label={tokenLabel(task.status, "Status not recorded")} strong />
          {task.files ? <Pill theme={theme} label={plural(task.files, "file")} /> : null}
          {task.supersedes.length ? <Pill theme={theme} label={`Supersedes ${task.supersedes.join(", ")}`} /> : null}
        </View>
        {task.idConflict && <Text role="alert" style={smallStyle(theme, false)}>The file records a different task id; the file name's id is shown.</Text>}
      </View>
      <View style={{ gap: 8, minWidth: compact ? undefined : 260 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Text style={{ ...kicker(theme), width: 84 }}>Needs</Text>{chips(task.deps, "warning")}</View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Text style={{ ...kicker(theme), width: 84 }}>Unblocks</Text>{chips(dependents, "neutral")}</View>
      </View>
    </View>
    {spend ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Stat theme={theme} size={20} label="Spent" value={money(spend.cost)} />
      <Stat theme={theme} size={20} label="Turns" value={integer(spend.turns)} />
      <Stat theme={theme} size={20} label="Agent time" value={duration(spend.durationS)} />
      <Stat theme={theme} size={20} label="Wall clock" value={span === null ? "—" : duration(span)} detail={`${clockTime(spend.first)} → ${clockTime(spend.last)}`} />
    </View> : <Text style={text(theme, 12, "400", true)}>No host session names this task yet.</Text>}
  </Section>;
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

/** Each wave as a card listing its tasks with their facts: the tab's list view. */
export function TaskList({ path, theme, compact }: ThemeProps & { path: BoardPath; compact: boolean }) {
  const { waves, unassigned } = path.tasks;
  return <View style={{ gap: 12 }}>
    {waves.map((wave) => <Card key={wave.number} title={`Wave ${wave.number}${wave.name ? ` · ${wave.name}` : ""}${wave.current ? " · Current" : ""}`} theme={theme} attention={!wave.inPlan}>
      {!wave.inPlan && <Text style={smallStyle(theme)}>Not listed in PLAN.md.</Text>}
      {wave.goal && <Text style={textStyle(theme, true)}>{wave.goal}</Text>}
      {wave.tasks.length ? <View role="list" accessibilityLabel={`Tasks in wave ${wave.number}`} style={{ marginHorizontal: -20, marginBottom: -20 }}>{wave.tasks.map((task) => <TaskRow key={task.id} task={task} theme={theme} compact={compact} />)}</View>
        : <Text style={textStyle(theme, true)}>The plan lists this wave, but no task file records it.</Text>}
    </Card>)}
    {unassigned.length > 0 && <Card title="Tasks without a wave" theme={theme} attention>
      <View role="list" accessibilityLabel="Tasks without a wave" style={{ marginHorizontal: -20, marginBottom: -20 }}>{unassigned.map((task) => <TaskRow key={task.id} task={task} theme={theme} compact={compact} />)}</View>
    </Card>}
  </View>;
}

/** The caveats behind the tasks tab. */
export function tasksNotes(path: BoardPath | undefined): string[] {
  const tasks = path?.tasks;
  return [
    "Statuses as the orchestrator recorded them in the task files; a done task is not a review verdict.",
    "Spend per task counts the turns of subagents whose log names that task first; a reviewer is counted under the first task it reads.",
    ...(tasks && !tasks.planObserved && tasks.availability === "available" ? ["No readable PLAN.md, so waves come from the task files only."] : []),
    ...(tasks?.waves.some((wave) => wave.goalShortened) ? ["Some wave goals were shortened for safe display."] : []),
    ...(tasks?.counts.other ? [`${plural(tasks.counts.other, "task")} without a known status.`] : []),
  ];
}

export function PathTasksView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage?: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [mode, setMode] = useState<Mode>("status");
  const [picked, setPicked] = useState<{ workspaceId: string; id: string } | null>(null);
  const path = state.snapshot?.path;
  const tasks = path?.tasks;
  const all = tasks ? [...tasks.waves.flatMap((wave) => wave.tasks), ...tasks.unassigned] : [];
  const spend = new Map((usage?.usage?.availability === "available" ? usage.usage.tasks : []).map((task) => [task.id, task]));
  const maxCost = Math.max(0, ...[...spend.values()].map((task) => task.cost ?? 0));
  const selected = (picked?.workspaceId === state.workspaceId ? all.find((task) => task.id === picked.id) : undefined) ?? (path ? defaultTask(path) : null);
  const related = selected ? relatedTasks(selected, all) : new Map<string, "upstream" | "downstream">();
  const changes = state.changes;
  const flash = (id: string) => changes && Date.now() - changes.at < FLASH_MS && changes.tasks.includes(id) ? changes.at : null;
  const select = (id: string) => setPicked({ workspaceId: state.workspaceId, id });
  const lane = (wave: PathWave, label: string) => <WaveLane key={wave.number} wave={wave} label={label} spend={spend} maxCost={maxCost} mode={mode} selected={selected?.id ?? null} related={related} flash={flash} onSelect={select} theme={theme} compact={compact} />;
  return <BoardFrame title="Tasks" description="Every task of the current milestone, wave by wave. Select one to see what it needs and what it unblocks." subject="tasks" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={warningAlerts(path, (warning) => warning.startsWith("plan-") || warning.startsWith("task"))} notes={tasksNotes(path)}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : tasks?.availability === "available" ? <>
      <View style={{ gap: 10 }}>
        <TaskBar path={path} theme={theme} height={14} />
        <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", gap: 10 }}>
          <Legend theme={theme} items={taskLegend(theme, path)} />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {view === "grid" && <Toggle<Mode> theme={theme} label="Color tasks by" value={mode} onChange={setMode} options={[{ value: "status", label: "Status" }, { value: "spend", label: "Spend" }]} />}
            <Toggle<"grid" | "list"> theme={theme} label="Show tasks as" value={view} onChange={setView} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
          </View>
        </View>
      </View>
      {tasks.limited && <Text role="alert" style={textStyle(theme, true)}>Some task evidence could not be fully read; counts may be partial.</Text>}
      {!tasks.waves.length && !tasks.unassigned.length ? <Text style={textStyle(theme, true)}>No waves are recorded yet.</Text> : view === "grid" ? <>
        {selected && <TaskDetail task={selected} tasks={all} spend={spend.get(selected.id)} onSelect={select} theme={theme} compact={compact} />}
        <View>
          {tasks.waves.map((wave) => lane(wave, `W${wave.number}`))}
          {tasks.unassigned.length > 0 && lane({ number: 0, name: null, goal: null, goalShortened: false, current: false, inPlan: true, tasks: tasks.unassigned }, "—")}
        </View>
        {mode === "spend" && <Text style={smallStyle(theme)}>{maxCost > 0 ? `Darker tiles cost more; the costliest task spent ${money(maxCost)}.` : "No task's turns have a price, so the tiles show no cost."}</Text>}
      </> : <TaskList path={path} theme={theme} compact={compact} />}
    </> : <Card title={tasks?.availability === "absent" ? "No tasks yet" : "Tasks unavailable"} theme={theme}>
      <Text style={textStyle(theme, true)}>{tasks?.availability === "absent" ? "No plan or task files yet. GSD Path writes them in the plan phase." : "The plan and task files could not be read safely."}</Text>
    </Card>}
  </BoardFrame>;
}
