import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type ScrollView as NativeScrollView } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardPath, PathTask } from "../shared/path.js";
import { ACTIVITY_BUCKET_MS, type UsageActivity, type UsageTask } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { BoardFrame, plural, tokenLabel, type ThemeProps } from "./board-frame.js";
import { SetupNotice, statusColor } from "./path-components.js";
import { usageAlerts, usageNotice } from "./path-usage-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { duration, integer, money } from "./usage-format.js";
import { clockTime, figures, kicker, line, Pill, Pulse, Section, Stat, surface, text, tint, toneColor, useNow } from "./ui-kit.js";

/**
 * The flight recorder: every host turn of the workspace on one time axis, a lane per task agent grouped by wave, the orchestrator
 * on top. Idle stretches longer than GAP_MS fold into a narrow break, so the hours with work get the width.
 */

const GAP_MS = 90 * 60_000;
const BREAK_PX = 22;
const LANE_HEIGHT = 20;
/** The least width an hour of work gets; a long history scrolls rather than squeezes. */
const MIN_HOUR_PX = 24;
/** Activity this recent counts as happening now. */
const LIVE_MS = 20 * 60_000;

export type Scale = { segments: { start: number; end: number; x: number; width: number }[]; width: number; start: number; end: number; x(time: number): number };

/**
 * Places bucket start times across at least `minWidth` pixels, folding every gap longer than `gapMs` into a fixed break. The scale
 * widens past `minWidth` when the breaks and an hour of work per MIN_HOUR_PX would not fit, so no stretch of work collapses.
 */
export function buildScale(times: readonly number[], minWidth: number, gapMs = GAP_MS): Scale | null {
  if (!times.length) return null;
  const spans: { start: number; end: number }[] = [];
  for (const time of [...new Set(times)].sort((left, right) => left - right)) {
    const last = spans[spans.length - 1];
    if (last && time - last.end <= gapMs) last.end = Math.max(last.end, time + ACTIVITY_BUCKET_MS);
    else spans.push({ start: time, end: time + ACTIVITY_BUCKET_MS });
  }
  const active = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const breaks = BREAK_PX * (spans.length - 1);
  const width = Math.max(minWidth, breaks + MIN_HOUR_PX * active / 3_600_000);
  const perMs = (width - breaks) / active;
  let cursor = 0;
  const segments = spans.map((span) => { const placed = { ...span, x: cursor, width: (span.end - span.start) * perMs }; cursor += placed.width + BREAK_PX; return placed; });
  const x = (time: number) => {
    // The first segment that ends at or after the time: inside it, the time's offset; before it, its start.
    let low = 0, high = segments.length - 1;
    if (time > segments[high].end) return segments[high].x + segments[high].width;
    while (low < high) { const middle = (low + high) >> 1; if (segments[middle].end < time) low = middle + 1; else high = middle; }
    const segment = segments[low];
    return time < segment.start ? segment.x : segment.x + (time - segment.start) * perMs;
  };
  return { segments, width, start: spans[0].start, end: spans[spans.length - 1].end, x };
}

export type Lane = { id: string; label: string; title: string | null; task: PathTask | null; buckets: UsageActivity[] };
export type LaneGroup = { key: string; title: string; current: boolean; wave: boolean; lanes: Lane[] };

/** The orchestrator first, then each wave's tasks in plan order, tasks no wave lists, and subagents that named no task. */
export function laneGroups(path: BoardPath, activity: readonly UsageActivity[]): LaneGroup[] {
  const byLane = new Map<string, UsageActivity[]>();
  for (const bucket of activity) { const buckets = byLane.get(bucket.lane); if (buckets) buckets.push(bucket); else byLane.set(bucket.lane, [bucket]); }
  const lane = (id: string, task: PathTask | null = null): Lane => ({ id, label: id, title: task?.title ?? null, task, buckets: byLane.get(id) ?? [] });
  const groups: LaneGroup[] = [];
  if (byLane.has("orchestrator")) groups.push({ key: "orchestrator", title: "Orchestrator", current: false, wave: false, lanes: [{ ...lane("orchestrator"), label: "Orchestrator", title: "The sessions nobody spawned: planning, dispatch, landing and gates" }] });
  const placed = new Set<string>();
  for (const wave of path.tasks.waves) {
    if (!wave.tasks.length) continue;
    for (const task of wave.tasks) placed.add(task.id);
    groups.push({ key: `wave-${wave.number}`, title: `W${wave.number}${wave.name ? ` · ${wave.name}` : ""}`, current: wave.current, wave: true, lanes: wave.tasks.map((task) => lane(task.id, task)) });
  }
  const loose = [...path.tasks.unassigned.filter((task) => !placed.has(task.id)).map((task) => { placed.add(task.id); return lane(task.id, task); }),
    ...[...byLane.keys()].filter((id) => id !== "orchestrator" && id !== "subagents" && !placed.has(id)).sort().map((id) => lane(id))];
  if (loose.length) groups.push({ key: "other-tasks", title: "Tasks outside the current plan", current: false, wave: false, lanes: loose });
  if (byLane.has("subagents")) groups.push({ key: "subagents", title: "Other subagents", current: false, wave: false, lanes: [{ ...lane("subagents"), label: "Subagents", title: "Subagents whose log names no task, such as reviewers and researchers" }] });
  return groups;
}

/** The most task lanes at work in one bucket, and when. */
export function peakParallel(activity: readonly UsageActivity[]): { agents: number; at: string } | null {
  const lanes = new Map<string, Set<string>>();
  for (const bucket of activity) if (bucket.lane !== "orchestrator" && bucket.lane !== "subagents") lanes.set(bucket.at, (lanes.get(bucket.at) ?? new Set()).add(bucket.lane));
  let peak: { agents: number; at: string } | null = null;
  for (const [at, set] of lanes) if (!peak || set.size > peak.agents) peak = { agents: set.size, at };
  return peak;
}

/** The task whose first and last turns lie furthest apart: the one its wave waited on longest. */
export function longPole(tasks: readonly UsageTask[]): { task: UsageTask; span: number } | null {
  let pole: { task: UsageTask; span: number } | null = null;
  for (const task of tasks) {
    if (!task.first || !task.last) continue;
    const span = Date.parse(task.last) - Date.parse(task.first);
    if (!pole || span > pole.span) pole = { task, span };
  }
  return pole;
}

/** `cost` is null when no turn of the day has a price. */
export type HeatRow = { day: string; hours: number[]; turns: number; cost: number | null };

/** Turns per local hour for the latest `days` days that had any. */
export function heatmapRows(activity: readonly UsageActivity[], days = 14): HeatRow[] {
  const rows = new Map<number, HeatRow & { midnight: number }>();
  for (const bucket of activity) {
    const time = new Date(bucket.at);
    const midnight = new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
    const row = rows.get(midnight) ?? { day: time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), hours: new Array<number>(24).fill(0), turns: 0, cost: null, midnight };
    rows.set(midnight, row);
    row.hours[time.getHours()] += bucket.turns;
    row.turns += bucket.turns;
    if (bucket.cost !== null) row.cost = (row.cost ?? 0) + bucket.cost;
  }
  return [...rows.values()].sort((left, right) => left.midnight - right.midnight).slice(-days).map(({ day, hours, turns, cost }) => ({ day, hours, turns, cost }));
}

/** Turns per half hour across the last day, newest on the right; the newest bar breathes while agents are at work. */
export function Heartbeat({ activity, theme, hours = 24, height = 34 }: ThemeProps & { activity: readonly UsageActivity[]; hours?: number; height?: number }) {
  const now = useNow(60_000);
  const slots = hours * 2;
  const start = now - hours * 3_600_000;
  const values = new Array<number>(slots).fill(0);
  for (const bucket of activity) {
    const time = Date.parse(bucket.at);
    if (time >= start && time <= now) values[Math.min(slots - 1, Math.floor((time - start) / 1_800_000))] += bucket.turns;
  }
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const active = values[slots - 1] > 0;
  const color = toneColor(theme, "accent");
  return <View accessible accessibilityRole="image" accessibilityLabel={`${plural(total, "host turn")} in the last ${hours} hours${active ? ", active now" : ""}`} style={{ gap: 4 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: 2 }}>
      {values.map((value, index) => <View key={index} style={{ flex: 1, height: value ? Math.max(3, height * value / max) : 2, borderRadius: 2, backgroundColor: value ? color : tint(theme, theme.colors.foregroundMuted, 0.25), opacity: value ? 0.45 + 0.55 * (index / slots) : 1 }} />)}
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={text(theme, 11, "400", true)}>{hours}h ago</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>{active && <Pulse color={color} size={5} />}<Text style={text(theme, 11, "500", !active)}>{active ? "active now" : "now"}</Text></View>
    </View>
  </View>;
}

const laneColor = (theme: ThemeProps["theme"], lane: Lane) => lane.id === "orchestrator" ? theme.colors.foreground : lane.id === "subagents" ? toneColor(theme, "warning")
  : lane.task?.status === "failed" || lane.task?.status === "blocked" ? toneColor(theme, "danger") : toneColor(theme, "accent");

function Axis({ scale, theme }: ThemeProps & { scale: Scale }) {
  const first = scale.segments[0];
  const hourPx = 3_600_000 * first.width / (first.end - first.start);
  const step = Math.max(1, Math.ceil(38 / Math.max(hourPx, 1)));
  const ticks: { x: number; label: string; day: boolean }[] = [];
  let lastDay = "";
  for (const segment of scale.segments) {
    const hour = new Date(segment.start); hour.setMinutes(0, 0, 0);
    for (let time = hour.getTime() + 3_600_000; time < segment.end; time += 3_600_000) {
      const date = new Date(time);
      const isDay = date.toDateString() !== lastDay;
      if (!isDay && date.getHours() % step) continue;
      const x = scale.x(time);
      const previous = ticks[ticks.length - 1];
      // A day label wins over a crowded hour; a crowded hour is skipped.
      if (previous && x - previous.x < (previous.day ? 96 : 34)) { if (!isDay) continue; ticks.pop(); }
      ticks.push({ x, label: isDay ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : `${date.getHours()}h`, day: isDay });
      lastDay = date.toDateString();
    }
  }
  return <View importantForAccessibility="no-hide-descendants" style={{ height: 30, width: scale.width, position: "relative" }}>
    {ticks.map((tick, index) => <View key={`line-${index}`} style={{ position: "absolute", left: tick.x, bottom: 0, width: 1, height: tick.day ? 10 : 6, backgroundColor: line(theme) }} />)}
    {ticks.map((tick, index) => <Text key={`label-${index}`} numberOfLines={1} style={{ position: "absolute", left: tick.x + 3, top: 2, color: tick.day ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 11, fontWeight: tick.day ? "600" : "400", ...figures }}>{tick.label}</Text>)}
  </View>;
}

const Track = memo(function Track({ lane, scale, maxTurns, selected, theme }: ThemeProps & { lane: Lane; scale: Scale; maxTurns: number; selected: boolean }) {
  const color = laneColor(theme, lane);
  const times = lane.buckets.map((bucket) => Date.parse(bucket.at));
  const from = times.length ? scale.x(Math.min(...times)) : null;
  const to = times.length ? scale.x(Math.max(...times) + ACTIVITY_BUCKET_MS) : null;
  return <View style={{ height: LANE_HEIGHT, position: "relative", backgroundColor: selected ? tint(theme, toneColor(theme, "accent"), 0.08) : "transparent" }}>
    {from !== null && to !== null && <View style={{ position: "absolute", left: from, width: Math.max(1, to - from), top: LANE_HEIGHT / 2, height: 1, backgroundColor: tint(theme, color, 0.45) }} />}
    {lane.buckets.map((bucket) => {
      const start = Date.parse(bucket.at);
      const left = scale.x(start);
      return <View key={bucket.at} style={{ position: "absolute", left, width: Math.max(2, scale.x(start + ACTIVITY_BUCKET_MS) - left - 1), top: 4, height: LANE_HEIGHT - 8, borderRadius: 2, backgroundColor: color, opacity: 0.3 + 0.7 * Math.min(1, bucket.turns / maxTurns) }} />;
    })}
  </View>;
});

/** "42 turns · $3.10 · 80 active minutes" for one lane. */
export function laneSummary(lane: Lane): string {
  const turns = lane.buckets.reduce((sum, bucket) => sum + bucket.turns, 0);
  const priced = lane.buckets.some((bucket) => bucket.cost !== null);
  const cost = lane.buckets.reduce((sum, bucket) => sum + (bucket.cost ?? 0), 0);
  return `${plural(turns, "turn")}${priced ? ` · ${money(Math.round(cost * 100) / 100)}` : ""} · ${lane.buckets.length * 10} active minutes`;
}

const GROUP_HEIGHT = 28;

/** The lane names, which stay put while the tracks beside them scroll; a group's title runs on over the empty track row above its lanes. */
function LaneLabels({ groups, labelWidth, selected, onSelect, theme }: ThemeProps & { groups: readonly LaneGroup[]; labelWidth: number; selected: string | null; onSelect(id: string): void }) {
  const accent = toneColor(theme, "accent");
  return <View style={{ width: labelWidth, paddingTop: 30, zIndex: 1 }}>
    {groups.map((group) => <View key={group.key} role="list" accessibilityLabel={group.title}>
      <View style={{ height: GROUP_HEIGHT, paddingBottom: 4, flexDirection: "row", alignItems: "flex-end", gap: 8, width: 640 }}>
        <Text numberOfLines={1} style={{ ...kicker(theme), color: group.current ? accent : theme.colors.foregroundMuted }}>{group.title}</Text>
        {group.current && <View style={{ marginBottom: -2 }}><Pill theme={theme} tone="accent" label="Current" /></View>}
      </View>
      {group.lanes.map((lane) => <View key={lane.id} role="listitem"><Pressable role="button" accessibilityState={{ selected: selected === lane.id }} accessibilityLabel={`${lane.label}${lane.task ? `, ${tokenLabel(lane.task.status, "status not recorded")}` : ""}: ${lane.buckets.length ? laneSummary(lane) : "no turns recorded"}`} onPress={() => onSelect(lane.id)}
        style={{ height: LANE_HEIGHT, flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 }}>
        {lane.task && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(theme, lane.task.status) }} />}
        <Text numberOfLines={1} style={{ ...text(theme, 12, selected === lane.id ? "700" : "500", !lane.buckets.length), ...figures }}>{lane.label}</Text>
      </Pressable></View>)}
    </View>)}
  </View>;
}

/** Thousands of blocks: drawn again only when the lanes, the scale, the selection or the live line change. */
const Tracks = memo(function Tracks({ groups, scale, selected, onSelect, live, theme }: ThemeProps & { groups: readonly LaneGroup[]; scale: Scale; selected: string | null; onSelect(id: string): void; live: boolean }) {
  const maxTurns = Math.max(1, ...groups.flatMap((group) => group.lanes.flatMap((lane) => lane.buckets.map((bucket) => bucket.turns))));
  const accent = toneColor(theme, "accent");
  return <View importantForAccessibility="no-hide-descendants" style={{ position: "relative", width: scale.width }}>
    <Axis scale={scale} theme={theme} />
    {groups.map((group) => {
      const times = group.lanes.flatMap((lane) => lane.buckets.map((bucket) => Date.parse(bucket.at)));
      const band = group.wave && times.length ? { left: scale.x(Math.min(...times)), right: scale.x(Math.max(...times) + ACTIVITY_BUCKET_MS) } : null;
      const bandColor = toneColor(theme, group.current ? "accent" : "success");
      return <View key={group.key}>
        <View style={{ height: GROUP_HEIGHT }} />
        <View style={{ position: "relative" }}>
          {band && <View style={{ position: "absolute", left: band.left, width: Math.max(2, band.right - band.left), top: -2, bottom: -2, borderRadius: 6, borderLeftWidth: 2, borderColor: tint(theme, bandColor, 0.6), backgroundColor: tint(theme, bandColor, 0.07) }} />}
          {group.lanes.map((lane) => <Pressable key={lane.id} accessible={false} onPress={() => onSelect(lane.id)}><Track lane={lane} scale={scale} maxTurns={maxTurns} selected={selected === lane.id} theme={theme} /></Pressable>)}
        </View>
      </View>;
    })}
    {scale.segments.slice(1).map((segment) => <View key={segment.start} pointerEvents="none" style={{ position: "absolute", left: segment.x - BREAK_PX, width: BREAK_PX, top: 30, bottom: 0, alignItems: "center" }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 14, fontWeight: "700" }}>≈</Text>
      <View style={{ flex: 1, width: BREAK_PX - 14, borderRadius: 3, backgroundColor: tint(theme, theme.colors.foregroundMuted, 0.1) }} />
    </View>)}
    {live && <View pointerEvents="none" style={{ position: "absolute", left: scale.x(scale.end) - 2, top: 26, bottom: 0, width: 2, backgroundColor: accent }}><View style={{ position: "absolute", top: -9, left: -9 }}><Pulse color={accent} size={7} /></View></View>}
  </View>;
});

function Heatmap({ activity, theme, compact }: ThemeProps & { activity: readonly UsageActivity[]; compact: boolean }) {
  const rows = heatmapRows(activity);
  const max = Math.max(1, ...rows.flatMap((row) => row.hours));
  const cell = compact ? 11 : 20;
  const accent = toneColor(theme, "accent");
  return <Section theme={theme} title="When the agents worked" overline="Turns per hour, local time" gap={10}>
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
      <View role="table" accessibilityLabel="Turns per hour of each day" style={{ gap: 3 }}>
        <View style={{ flexDirection: "row", gap: 3, marginLeft: 112 }}>{Array.from({ length: 24 }, (_, hour) => <Text key={hour} style={{ ...text(theme, 10, "400", true), width: cell, textAlign: "center" }}>{hour % 6 === 0 ? `${hour}h` : ""}</Text>)}</View>
        {rows.map((row) => <View key={row.day} role="row" style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text role="rowheader" numberOfLines={1} style={{ ...text(theme, 11, "500", true), ...figures, width: 109 }}>{row.day}</Text>
          {row.hours.map((value, hour) => <View key={hour} role="cell" accessibilityLabel={`${hour}h: ${plural(value, "turn")}`} style={{ width: cell, height: cell, borderRadius: 4, backgroundColor: value ? accent : surface(theme, 2), opacity: value ? 0.22 + 0.78 * Math.sqrt(value / max) : 1 }} />)}
          <Text style={{ ...text(theme, 11, "500", true), ...figures, marginLeft: 8, width: 140 }}>{integer(row.turns)} turns{row.cost === null ? "" : ` · ${money(Math.round(row.cost * 100) / 100)}`}</Text>
        </View>)}
      </View>
    </ScrollView>
  </Section>;
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
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ workspaceId: string; lane: string } | null>(null);
  const now = useNow(60_000);
  const scroller = useRef<NativeScrollView | null>(null);
  const scrolled = useRef(false);
  const path = state.snapshot?.path;
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  const activity = value?.activity ?? [];
  const labelWidth = compact ? 74 : 110;
  const trackWidth = Math.max(compact ? 520 : 640, width - labelWidth - (compact ? 20 : 32));
  const groups = useMemo(() => path ? laneGroups(path, activity) : [], [path, activity]);
  const scale = useMemo(() => buildScale(activity.map((bucket) => Date.parse(bucket.at)), trackWidth), [activity, trackWidth]);
  const selected = picked?.workspaceId === state.workspaceId ? groups.flatMap((group) => group.lanes).find((lane) => lane.id === picked.lane) ?? null : null;
  const selectedId = selected?.id ?? null;
  const select = useCallback((lane: string) => setPicked(selectedId === lane ? null : { workspaceId: state.workspaceId, lane }), [selectedId, state.workspaceId]);
  const peak = peakParallel(activity);
  const pole = longPole(value?.tasks ?? []);
  const active = scale ? scale.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0) : 0;
  const notice = usageNotice(usage);
  return <BoardFrame title="Timeline" description="A flight recorder of this workspace: every host turn on one time axis, one lane per task agent." subject="timeline" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={timelineAlerts(usage)} notes={timelineNotes()}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : !scale ? <Section theme={theme} title="No activity to draw">
      <Text style={text(theme, 13, "400", true)}>{notice ?? "No host turn in this workspace has a timestamp yet."}</Text>
    </Section> : <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat theme={theme} size={22} label="Span" value={duration((scale.end - scale.start) / 1000)} detail={`${clockTime(scale.start)} → ${clockTime(scale.end)}`} />
        <Stat theme={theme} size={22} label="Active" value={duration(active / 1000)} detail={`${plural(scale.segments.length - 1, "idle break")} folded`} />
        <Stat theme={theme} size={22} label="Peak parallel" value={peak ? plural(peak.agents, "task agent") : "—"} detail={peak ? `at ${clockTime(peak.at)}` : null} />
        <Stat theme={theme} size={22} label="Long pole" value={pole?.task.id ?? "—"} detail={pole ? `${duration(pole.span / 1000)} first to last turn · ${money(pole.task.cost)}` : null} />
      </View>
      {selected && <Section theme={theme} tone="accent" padding={16} gap={6}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Text style={text(theme, 16, "700")}>{selected.label}</Text>
          {selected.task && <Pill theme={theme} label={tokenLabel(selected.task.status, "Status not recorded")} />}
          <Text numberOfLines={2} style={{ ...text(theme, 13, "400", true), flex: 1 }}>{selected.title ?? ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Close ${selected.label}`} onPress={() => setPicked(null)} style={{ minHeight: 32, justifyContent: "center" }}><Text style={text(theme, 12, "600", true)}>Close</Text></Pressable>
        </View>
        <Text style={{ ...text(theme, 13), ...figures }}>{laneSummary(selected)}{selected.buckets.length ? ` · ${clockTime(selected.buckets[0].at)} → ${clockTime(Date.parse(selected.buckets[selected.buckets.length - 1].at) + ACTIVITY_BUCKET_MS)}` : ""}</Text>
      </Section>}
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ borderRadius: 16, padding: compact ? 10 : 16, backgroundColor: surface(theme) }}>
        <View style={{ flexDirection: "row" }}>
          <LaneLabels groups={groups} labelWidth={labelWidth} selected={selectedId} onSelect={select} theme={theme} />
          {/* The newest work is on the right; a history wider than the panel opens there. */}
          <ScrollView ref={scroller} horizontal nestedScrollEnabled style={{ flex: 1 }} onContentSizeChange={() => { if (!scrolled.current) { scrolled.current = true; scroller.current?.scrollToEnd({ animated: false }); } }}>
            <Tracks groups={groups} scale={scale} selected={selectedId} onSelect={select} live={now - scale.end < LIVE_MS} theme={theme} />
          </ScrollView>
        </View>
      </View>
      <Heatmap activity={activity} theme={theme} compact={compact} />
    </>}
  </BoardFrame>;
}
