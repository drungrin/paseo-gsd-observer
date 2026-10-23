import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BoardPath, PathMilestone } from "../shared/path.js";
import type { UsageSlot } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { PathFrame, plural, SetupNotice, TaskBar, tokenLabel, warningAlerts, type ThemeProps } from "./path-components.js";
import { usageAlerts, usageNotice } from "./path-usage-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { integer, money, slotSummary, tokens } from "./usage-format.js";
import { figures, line, Pill, Pulse, Section, shortDate, surface, text, tint, toneColor, type Tone } from "./ui-kit.js";

/** The badges describing one milestone, in reading order. */
export function milestoneFacts(milestone: PathMilestone): string[] {
  return [
    ...(milestone.shipped ? [`Shipped ${milestone.shipped}`] : []),
    ...(milestone.tasksTotal !== null ? [`${milestone.tasksDone ?? 0} of ${plural(milestone.tasksTotal, "task")} done`] : []),
    ...(milestone.depends.length ? [`Depends on ${milestone.depends.join(", ")}`] : []),
    ...(milestone.archived && !milestone.shipped ? ["Archive recorded"] : []),
    ...(milestone.integrated ? ["Integrated commit recorded"] : []),
  ];
}

type MilestoneState = "shipped" | "current" | "abandoned" | "pending";
/** Where a milestone stands, as the roadmap records it; a recorded ship date wins over any status. */
export const milestoneState = (milestone: PathMilestone): MilestoneState => milestone.shipped || milestone.status === "shipped" ? "shipped" : milestone.current ? "current" : milestone.status === "abandoned" ? "abandoned" : "pending";

const stateWords: Record<MilestoneState, string> = { shipped: "recorded as shipped", current: "current", abandoned: "recorded as abandoned", pending: "pending" };

function Strip({ milestones, theme }: ThemeProps & { milestones: readonly PathMilestone[] }) {
  return <View accessible accessibilityRole="image" accessibilityLabel={milestones.map((milestone) => `${milestone.id} ${stateWords[milestoneState(milestone)]}`).join(", ")} style={{ flexDirection: "row", gap: 3, height: 12 }}>
    {milestones.map((milestone) => {
      const state = milestoneState(milestone);
      return <View key={milestone.id} style={{ flex: 1, borderRadius: 3, backgroundColor: state === "shipped" ? toneColor(theme, "success") : state === "current" ? toneColor(theme, "accent") : state === "abandoned" ? tint(theme, toneColor(theme, "danger"), 0.5) : surface(theme, 2) }} />;
    })}
  </View>;
}

function Node({ state, theme }: ThemeProps & { state: MilestoneState }) {
  if (state === "current") return <Pulse color={toneColor(theme, "accent")} size={12} />;
  const tone: Tone = state === "shipped" ? "success" : state === "abandoned" ? "danger" : "neutral";
  return <View style={{ width: 31, height: 31, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: state === "pending" ? 12 : 18, height: state === "pending" ? 12 : 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: state === "pending" ? theme.colors.surface0 : toneColor(theme, tone), borderWidth: state === "pending" ? 2 : 0, borderColor: line(theme) }}>
      {state !== "pending" && <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.surface0 }}>{state === "shipped" ? "✓" : "✕"}</Text>}
    </View>
  </View>;
}

function Row({ milestone, path, slot, maxCost, first, last, theme, compact, open, onToggle }: ThemeProps & { milestone: PathMilestone; path: BoardPath; slot: UsageSlot | undefined; maxCost: number; first: boolean; last: boolean; compact: boolean; open: boolean; onToggle(): void }) {
  const state = milestoneState(milestone);
  const lookahead = path.next && path.next.milestone === milestone.slug ? path.next : null;
  const above = first ? "transparent" : state === "pending" || state === "abandoned" ? line(theme) : tint(theme, toneColor(theme, "success"), 0.6);
  const below = last ? "transparent" : state === "shipped" ? tint(theme, toneColor(theme, "success"), 0.6) : line(theme);
  const current = state === "current";
  return <View role="listitem" style={{ flexDirection: "row", gap: 14 }}>
    <View style={{ width: 31, alignItems: "center" }}>
      <View style={{ width: 2, height: 14, backgroundColor: above }} />
      <Node state={state} theme={theme} />
      <View style={{ width: 2, flex: 1, backgroundColor: below }} />
    </View>
    <Pressable role="button" accessibilityLabel={`${milestone.id} ${milestone.slug ?? "name not recorded"}, ${stateWords[state]}${slot?.turns ? `, ${slotSummary(slot)}` : ""}`} accessibilityState={{ expanded: open || current }} onPress={onToggle} style={{ flex: 1, minWidth: 0, marginVertical: 6, padding: current ? 18 : 12, gap: 6, borderRadius: 14, backgroundColor: current ? tint(theme, toneColor(theme, "accent"), 0.11) : open ? surface(theme) : "transparent" }}>
      <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 4 : 14, alignItems: compact ? "flex-start" : "center" }}>
        <Text style={{ ...text(theme, 12, "700", !current && state !== "shipped"), ...figures, width: compact ? undefined : 48, ...(current ? { color: toneColor(theme, "accent") } : {}) }}>{milestone.id}</Text>
        <Text numberOfLines={1} style={{ ...text(theme, current ? 18 : 14, current ? "700" : "500", state === "pending" || state === "abandoned"), flex: 1, textDecorationLine: state === "abandoned" ? "line-through" : "none" }}>{milestone.slug ?? "Name not recorded"}</Text>
        {lookahead && <Pill theme={theme} tone="accent" label={`Planning ahead · ${tokenLabel(lookahead.phase).toLowerCase()}`} />}
        {state === "shipped" && milestone.tasksTotal !== null && <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{milestone.tasksDone ?? 0} of {plural(milestone.tasksTotal, "task")} done</Text>}
        {state === "shipped" && <Pill theme={theme} tone="success" glyph="✓" label={milestone.shipped ? `Shipped ${shortDate(milestone.shipped)}` : "Shipped"} />}
        {current && <Pill theme={theme} tone="accent" label={`In ${tokenLabel(path.state.phase).toLowerCase()}`} strong />}
        {slot?.turns ? <View style={{ width: compact ? undefined : 170, gap: 3 }}>
          <Text style={{ ...text(theme, 12, "600"), ...figures, textAlign: compact ? "left" : "right" }}>{slotSummary(slot)}</Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: surface(theme, 2), overflow: "hidden" }}><View style={{ height: "100%", width: `${maxCost && slot.cost ? Math.max(3, 100 * slot.cost / maxCost) : 3}%`, backgroundColor: toneColor(theme, current ? "accent" : "success") }} /></View>
        </View> : null}
      </View>
      {milestone.goal && <Text numberOfLines={current || open ? undefined : 1} style={{ ...text(theme, 13, "400", true), marginLeft: compact ? 0 : 62 }}>{milestone.goal}</Text>}
      {current && path.tasks.counts.total > 0 && <View style={{ marginLeft: compact ? 0 : 62, gap: 6, marginTop: 4 }}>
        <TaskBar path={path} theme={theme} height={8} />
        <Text style={{ ...text(theme, 12, "500", true), ...figures }}>{path.tasks.counts.done} of {plural(path.tasks.counts.total, "task")} done · {plural(path.tasks.waves.length, "wave")}{slot?.tokens ? ` · ${tokens(slot.tokens)} tokens` : ""}</Text>
      </View>}
      {(open || current) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: compact ? 0 : 62 }}>
        {milestoneFacts(milestone).filter((fact) => !fact.startsWith("Shipped ")).map((fact) => <Pill key={fact} theme={theme} label={fact} />)}
        {current && <Pill theme={theme} label={`Status · ${tokenLabel(milestone.status)}`} />}
      </View>}
    </Pressable>
  </View>;
}

/** The caveats behind the roadmap, with usage that no milestone claims. */
export function roadmapNotes(usage: UsageViewState): string[] {
  const unattributed = usage.usage?.availability === "available" ? usage.usage.milestones.find((slot) => slot.id === null) : undefined;
  const notice = usageNotice(usage);
  return [
    "Statuses and ship dates as recorded in the roadmap and the archive manifests, not verified integration.",
    "Usage dated on or before a milestone's ship date counts toward it; later usage counts toward the current milestone, as the GSD Path daemon splits it.",
    ...(notice ? [`Usage: ${notice}`] : []),
    ...(unattributed?.turns ? [`Usage not tied to a roadmap milestone: ${slotSummary(unattributed)} · ${tokens(unattributed.tokens)} tokens.`] : []),
  ];
}

export function PathRoadmapView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const [opened, setOpened] = useState<string | null>(null);
  const path = state.snapshot?.path;
  const roadmap = path?.roadmap;
  const slots = new Map((usage.usage?.availability === "available" ? usage.usage.milestones : []).map((slot) => [slot.id, slot]));
  const maxCost = Math.max(0, ...[...slots.values()].map((slot) => slot.cost ?? 0));
  const total = usage.usage?.availability === "available" ? usage.usage.totals : null;
  return <PathFrame title="Roadmap" description="The whole program: what shipped, where it stands, and what comes next." subject="roadmap" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={[...warningAlerts(path, (warning) => warning.startsWith("roadmap-") || warning === "milestone-not-in-roadmap"), ...usageAlerts(usage)]} notes={roadmapNotes(usage)}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : roadmap?.availability === "available" ? <>
      <Section theme={theme} gap={12}>
        <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "flex-start" : "baseline", gap: 12 }}>
          <Text style={{ ...text(theme, 34, "700"), ...figures, letterSpacing: -1 }}>{roadmap.counts.shipped}<Text style={text(theme, 20, "500", true)}> / {roadmap.counts.total}</Text></Text>
          <Text style={{ ...text(theme, 14, "400", true), flex: 1 }}>milestones recorded as shipped · {roadmap.counts.active} active · {roadmap.counts.pending} to come{roadmap.counts.abandoned ? ` · ${roadmap.counts.abandoned} abandoned` : ""}</Text>
          {total && <Text style={{ ...text(theme, 14, "600"), ...figures }}>{money(total.cost)} so far · {integer(total.turns)} turns</Text>}
        </View>
        <Strip milestones={roadmap.milestones} theme={theme} />
      </Section>
      {roadmap.milestones.length ? <View role="list" accessibilityLabel="Roadmap milestones">
        {roadmap.milestones.map((milestone, index) => <Row key={milestone.id} milestone={milestone} path={path} slot={slots.get(milestone.id)} maxCost={maxCost} first={index === 0} last={index === roadmap.milestones.length - 1} theme={theme} compact={compact} open={opened === milestone.id} onToggle={() => setOpened(opened === milestone.id ? null : milestone.id)} />)}
      </View> : <Text style={text(theme, 13, "400", true)}>No milestones are listed in this roadmap.</Text>}
    </> : <Section theme={theme} title={roadmap?.availability === "absent" ? "A single-milestone project" : "Roadmap unavailable"}>
      <Text style={text(theme, 13, "400", true)}>{roadmap?.availability === "absent" ? "This project runs one milestone at a time; no program roadmap is recorded." : "The roadmap could not be read."}</Text>
      {roadmap?.availability === "absent" && total ? <Text style={{ ...text(theme, 14, "600"), ...figures }}>{money(total.cost)} · {integer(total.turns)} turns in this workspace</Text> : null}
    </Section>}
  </PathFrame>;
}
