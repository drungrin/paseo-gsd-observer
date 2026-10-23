import { useMemo } from "react";
import type { BoardPath, PathTask } from "../shared/path.js";
import type { UsageActivity } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { BoardFrame, tokenLabel, type ThemeProps } from "./board-frame.js";
import { SetupNotice } from "./path-components.js";
import { usageAlerts, usageNotice } from "./path-usage-components.js";
import { bucketsByLane, Recorder, type Lane, type LaneGroup, type LaneMark } from "./timeline-components.js";
import type { UsageViewState } from "./usage-controller.js";

export { buildScale, heatmapRows, Heartbeat, longPole, peakParallel, type Lane, type LaneGroup, type Scale } from "./timeline-components.js";

/** A task's recorded status as its lane's mark. */
const taskMark = (task: PathTask): LaneMark => ({ label: tokenLabel(task.status, "Status not recorded"),
  tone: task.status === "done" ? "done" : task.status === "in-progress" ? "progress" : task.status === "failed" || task.status === "blocked" ? "danger" : "idle" });

/** The orchestrator first, then each wave's tasks in plan order, tasks no wave lists, and subagents that named no task. */
export function laneGroups(path: BoardPath, activity: readonly UsageActivity[]): LaneGroup[] {
  const byLane = bucketsByLane(activity);
  const lane = (id: string, task: PathTask | null = null): Lane => ({ id, label: id, title: task?.title ?? null, mark: task ? taskMark(task) : null, buckets: byLane.get(id) ?? [] });
  const groups: LaneGroup[] = [];
  if (byLane.has("orchestrator")) groups.push({ key: "orchestrator", title: "Orchestrator", current: false, band: false, lanes: [{ ...lane("orchestrator"), label: "Orchestrator", title: "The sessions nobody spawned: planning, dispatch, landing and gates" }] });
  const placed = new Set<string>();
  for (const wave of path.tasks.waves) {
    if (!wave.tasks.length) continue;
    for (const task of wave.tasks) placed.add(task.id);
    groups.push({ key: `wave-${wave.number}`, title: `W${wave.number}${wave.name ? ` · ${wave.name}` : ""}`, current: wave.current, band: true, lanes: wave.tasks.map((task) => lane(task.id, task)) });
  }
  const loose = [...path.tasks.unassigned.filter((task) => !placed.has(task.id)).map((task) => { placed.add(task.id); return lane(task.id, task); }),
    ...[...byLane.keys()].filter((id) => id !== "orchestrator" && id !== "subagents" && !placed.has(id)).sort().map((id) => lane(id))];
  if (loose.length) groups.push({ key: "other-tasks", title: "Tasks outside the current plan", current: false, band: false, lanes: loose });
  if (byLane.has("subagents")) groups.push({ key: "subagents", title: "Other subagents", current: false, band: false, lanes: [{ ...lane("subagents"), label: "Subagents", title: "Subagents whose log names no task, such as reviewers and researchers" }] });
  return groups;
}

/** The caveats behind the flight recorder. */
export function timelineNotes(): string[] {
  return [
    "Each block is ten minutes of host turns; a darker block holds more turns. Idle stretches over 90 minutes fold into the ≈ breaks.",
    "A task's lane holds the turns of subagents (Claude Code sidechains and spawned Codex workers) whose log names that task first; a reviewer reading a wave lands in its first task's lane. Sessions nobody spawned are the orchestrator.",
    "Times are local. A wave's band runs from its tasks' first turn to their last.",
  ];
}

/** What qualifies the recorder: the usage qualifiers, and activity left out past the limit. */
export const timelineAlerts = (usage: UsageViewState) => [...usageAlerts(usage), ...(usage.usage?.availability === "available" && usage.usage.activityLimited ? ["More activity is recorded than the observer carries; the oldest is left out."] : [])];

export function PathTimelineView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  const activity = value?.activity;
  // The recorder redraws its thousands of blocks only when the groups change.
  const groups = useMemo(() => path ? laneGroups(path, activity ?? []) : [], [path, activity]);
  return <BoardFrame title="Timeline" description="A flight recorder of this workspace: every host turn on one time axis, one lane per task agent." subject="timeline" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={timelineAlerts(usage)} notes={timelineNotes()}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} />
      : <Recorder workspaceId={state.workspaceId} groups={groups} activity={activity ?? []} spans={value?.tasks ?? []} unit="task" notice={usageNotice(usage)} theme={theme} compact={compact} />}
  </BoardFrame>;
}
