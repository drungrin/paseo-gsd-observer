import { useMemo, useState } from "react";
import { Text } from "react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { BoardUsage, UsageActivity } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { BoardFrame, Card, textStyle, type ThemeProps } from "./board-frame.js";
import { PhasePicker } from "./core-components.js";
import { usageAlerts, usageNotice } from "./path-usage-components.js";
import { planState } from "./plans-components.js";
import { bucketsByLane, Recorder, type Lane, type LaneGroup, type LaneMark } from "./timeline-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { money } from "./usage-format.js";

type Phase = BoardOverview["plans"]["phases"][number];
type Plan = Phase["entries"][number];

/** What a plan's files show, as its lane's mark. */
const planMark = (plan: Plan): LaneMark => {
  const state = planState(plan);
  return state === "summary" ? { label: "Summary written", tone: "done" } : state === "planned" ? { label: "Plan file only", tone: "progress" } : { label: "Roadmap only", tone: "idle" };
};
const isWork = (lane: string) => lane !== "orchestrator" && lane !== "subagents";
/** "61-3" belongs to phase "61"; a phase lane is its own phase. */
export const lanePhase = (lane: string) => lane.includes("-") ? lane.slice(0, lane.lastIndexOf("-")) : lane;
const byId = (left: string, right: string) => left.localeCompare(right, "en", { numeric: true });

/** Several lanes' buckets as one lane: turns and cost added per ten-minute bucket. */
function merged(lists: readonly (readonly UsageActivity[])[], lane: string): UsageActivity[] {
  const byAt = new Map<string, UsageActivity>();
  for (const list of lists) for (const bucket of list) {
    const prior = byAt.get(bucket.at);
    if (!prior) { byAt.set(bucket.at, { ...bucket, lane }); continue; }
    prior.turns += bucket.turns;
    prior.cost = prior.cost === null && bucket.cost === null ? null : (prior.cost ?? 0) + (bucket.cost ?? 0);
  }
  return [...byAt.values()].sort((left, right) => left.at.localeCompare(right.at));
}

/** The phase the recorder opens on: the current one when its agents have worked, else the milestone phase that worked last. */
export function defaultTimelinePhase(phases: readonly Phase[], activity: readonly UsageActivity[]): string | null {
  const last = new Map<string, string>();
  for (const bucket of activity) if (isWork(bucket.lane)) { const phase = lanePhase(bucket.lane); if ((last.get(phase) ?? "") < bucket.at) last.set(phase, bucket.at); }
  const current = phases.find((phase) => phase.current);
  if (current && last.has(current.id)) return current.id;
  const latest = phases.filter((phase) => last.has(phase.id)).sort((left, right) => (last.get(right.id) ?? "").localeCompare(last.get(left.id) ?? ""))[0];
  return latest?.id ?? current?.id ?? null;
}

/**
 * The orchestrator first, then the open phase with a lane for its other agents and one per plan, the milestone's other phases
 * and phases outside it as one lane each, and subagents that are not GSD agents or name no phase.
 */
export function coreLaneGroups(overview: BoardOverview, activity: readonly UsageActivity[], open: string | null): LaneGroup[] {
  const byLane = bucketsByLane(activity);
  const phases = overview.plans.availability === "available" ? overview.plans.phases : [];
  const inMilestone = new Set(phases.map((phase) => phase.id));
  const done = new Set(overview.roadmap.phases.filter((phase) => phase.completed).map((phase) => phase.id));
  const groups: LaneGroup[] = [];
  const lane = (id: string, label: string, title: string | null, mark: LaneMark | null = null, buckets: UsageActivity[] = byLane.get(id) ?? []): Lane => ({ id, label, title, mark, buckets });
  if (byLane.has("orchestrator")) groups.push({ key: "orchestrator", title: "Orchestrator", current: false, band: false, lanes: [lane("orchestrator", "Orchestrator", "The sessions nobody spawned: /gsd commands such as /gsd-execute-phase, and the work they do themselves")] });
  // Every work lane of a phase: its other agents, and its plans' executors.
  const phaseLanes = new Map<string, string[]>();
  for (const id of byLane.keys()) if (isWork(id)) phaseLanes.set(lanePhase(id), [...phaseLanes.get(lanePhase(id)) ?? [], id]);
  const opened = phases.find((phase) => phase.id === open);
  if (opened) {
    const listed = new Set(opened.entries.map((plan) => plan.id));
    const unlisted = (phaseLanes.get(opened.id) ?? []).filter((id) => id !== opened.id && !listed.has(id)).sort(byId);
    groups.push({ key: `phase-${opened.id}`, title: `Phase ${opened.id} · ${opened.title}`, current: opened.current, band: true, lanes: [
      lane(opened.id, "Agents", `Planners, checkers, verifiers and the other GSD agents working on phase ${opened.id}`),
      ...opened.entries.map((plan) => lane(plan.id, plan.id, plan.title, planMark(plan))),
      ...unlisted.map((id) => lane(id, id, "An executor whose plan file this phase does not list")),
    ] });
  }
  const folded = (keep: (phase: string) => boolean) => [...phaseLanes].filter(([phase]) => phase !== opened?.id && keep(phase)).sort(([left], [right]) => byId(left, right))
    .map(([phase, ids]) => lane(`phase-${phase}`, `Phase ${phase}`, phases.find((entry) => entry.id === phase)?.title ?? null,
      inMilestone.has(phase) ? done.has(phase) ? { label: "Marked complete", tone: "done" } : phases.find((entry) => entry.id === phase)?.current ? { label: "Current", tone: "progress" } : null : null,
      merged(ids.map((id) => byLane.get(id) ?? []), `phase-${phase}`)));
  const others = folded((phase) => inMilestone.has(phase));
  if (others.length) groups.push({ key: "milestone", title: opened ? "This milestone's other phases" : "This milestone", current: false, band: false, lanes: others });
  // Phases outside this milestone are history: one lane for all of them.
  const earlier = [...phaseLanes].filter(([phase]) => !inMilestone.has(phase)).sort(([left], [right]) => byId(left, right));
  if (earlier.length) groups.push({ key: "earlier", title: phases.length ? "Outside this milestone" : "Phases", current: false, band: false, lanes: [lane("earlier", phases.length ? "Earlier phases" : "All phases",
    `${earlier.length === 1 ? "Phase" : "Phases"} ${earlier.map(([phase]) => phase).join(", ")}`, null, merged(earlier.flatMap(([, ids]) => ids.map((id) => byLane.get(id) ?? [])), "earlier"))] });
  if (byLane.has("subagents")) groups.push({ key: "subagents", title: "Other subagents", current: false, band: false, lanes: [lane("subagents", "Subagents", "Subagents that are not GSD agents, or that name no phase, such as Explore and reviewers")] });
  return groups;
}

/** The caveats behind the GSD Core flight recorder. */
export function coreTimelineNotes(): string[] {
  return [
    "Each block is ten minutes of host turns; a darker block holds more turns. Idle stretches over 90 minutes fold into the ≈ breaks.",
    "A plan's lane holds the turns of the GSD executor whose prompt names that plan's PLAN.md file first (on Codex, the plan file it opens first); a phase's other GSD agents (planners, checkers, verifiers and the like) are placed by the phase their task names. Codex records those agents' tasks only in encrypted form, so on Codex they count with the other subagents. Sessions nobody spawned are the orchestrator.",
    "Times are local. The open phase's band runs from its lanes' first turn to their last; other phases are one lane each.",
  ];
}

/** What qualifies the recorder: the usage qualifiers, and activity left out past the limit. */
export const coreTimelineAlerts = (usage: UsageViewState) => [...usageAlerts(usage), ...(usage.usage?.availability === "available" && usage.usage.activityLimited ? ["More activity is recorded than the observer carries; the oldest is left out."] : [])];

/** Each phase's spend, by phase id. */
const phaseSpend = (usage: BoardUsage | null) => new Map((usage?.phases ?? []).map((phase) => [phase.id, phase]));

export function CoreTimelineView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const [picked, setPicked] = useState<{ workspaceId: string; phase: string } | null>(null);
  const overview = state.snapshot?.overview;
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  const activity = value?.activity;
  const phases = overview?.plans.availability === "available" ? overview.plans.phases : [];
  const spend = phaseSpend(value);
  const active = phases.filter((phase) => spend.has(phase.id) || phase.current);
  const open = (picked?.workspaceId === state.workspaceId && phases.some((phase) => phase.id === picked.phase) ? picked.phase : null) ?? defaultTimelinePhase(phases, activity ?? []);
  // The recorder redraws its thousands of blocks only when the groups change.
  const groups = useMemo(() => overview ? coreLaneGroups(overview, activity ?? [], open) : [], [overview, activity, open]);
  const plans = new Set(phases.flatMap((phase) => phase.entries.map((plan) => plan.id)));
  // The history opens on the open phase's last turn, not on the newest work of another phase.
  const focus = { key: open ?? "none", at: (activity ?? []).reduce<number | null>((latest, bucket) => isWork(bucket.lane) && lanePhase(bucket.lane) === open ? Math.max(latest ?? 0, Date.parse(bucket.at)) : latest, null) };
  return <BoardFrame title="Timeline" description="A flight recorder of this workspace: every host turn on one time axis, a lane per plan in the open phase." subject="timeline" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={coreTimelineAlerts(usage)} notes={coreTimelineNotes()}>
    {!overview ? <Card title="Project evidence unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable planning state was found for this workspace.</Text></Card> : <>
      {value && active.length > 1 && <PhasePicker label="Open a phase" selected={open} onSelect={(id) => setPicked({ workspaceId: state.workspaceId, phase: id })} theme={theme} phases={active.map((phase) => {
        const slot = spend.get(phase.id);
        return { id: phase.id, current: phase.current, tone: null, detail: slot ? slot.cost !== null ? money(slot.cost) : `${slot.turns} turns` : "no turns", description: `${phase.title}. ${slot ? `${slot.turns} turns${slot.cost !== null ? `, ${money(slot.cost)}` : ""}` : "No turns recorded"}.` };
      })} />}
      <Recorder workspaceId={state.workspaceId} groups={groups} activity={activity ?? []} spans={(value?.plans ?? []).filter((plan) => plans.has(plan.id))} unit="plan" notice={usageNotice(usage)} focus={focus} theme={theme} compact={compact} />
    </>}
  </BoardFrame>;
}
