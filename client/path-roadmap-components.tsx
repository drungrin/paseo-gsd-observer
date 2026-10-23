import { Text, View } from "react-native";
import type { PathMilestone } from "../shared/path.js";
import type { UsageSlot, UsageTotals } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, Card, PATH_WARNING_COPY, PathFrame, plural, SetupNotice, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./path-components.js";
import { usageNotice } from "./path-usage-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { slotSummary, tokens } from "./usage-format.js";

const totalSlot = (totals: UsageTotals): UsageSlot => ({ turns: totals.turns, tokens: totals.tokensIn + totals.tokensCached + totals.tokensOut, cost: totals.cost });

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

function UsageColumn({ slot, theme }: ThemeProps & { slot: UsageSlot | undefined }) {
  const summary = slotSummary(slot);
  return <View style={{ minWidth: 150, alignItems: "flex-end", gap: 2 }}>
    <Text style={{ ...textStyle(theme), fontVariant: ["tabular-nums"] }}>{summary || "—"}</Text>
    {summary && slot && <Text style={{ ...smallStyle(theme), fontVariant: ["tabular-nums"] }}>{tokens(slot.tokens)} tokens</Text>}
  </View>;
}

function MilestoneRow({ milestone, slot, theme, compact }: ThemeProps & { milestone: PathMilestone; slot: UsageSlot | undefined; compact: boolean }) {
  const facts = milestoneFacts(milestone);
  return <View role="listitem" style={{ flexDirection: compact ? "column" : "row", gap: compact ? 8 : 16, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: milestone.current ? theme.colors.accent : "transparent", backgroundColor: milestone.current ? theme.colors.surface2 ?? theme.colors.surface0 : "transparent" }}>
    <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : 56 }}>{milestone.id}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <Text style={{ ...textStyle(theme), fontWeight: milestone.current ? "600" : "400" }}>{milestone.slug ?? "Name not recorded"}{milestone.current ? " · Current" : ""}</Text>
      {milestone.goal && <Text style={smallStyle(theme)}>{milestone.goal}</Text>}
      {facts.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{facts.map((fact) => <Badge key={fact} label={fact} theme={theme} />)}</View>}
    </View>
    <Text style={{ ...textStyle(theme), width: compact ? undefined : 96 }}>{tokenLabel(milestone.status)}</Text>
    <UsageColumn slot={slot} theme={theme} />
  </View>;
}

export function PathRoadmapView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const roadmap = path?.roadmap;
  const slots = new Map((usage.usage?.availability === "available" ? usage.usage.milestones : []).map((slot) => [slot.id, slot]));
  const unattributed = slots.get(null);
  const notice = usageNotice(usage);
  const warnings = path?.warnings.filter((warning) => warning.startsWith("roadmap-") || warning === "milestone-not-in-roadmap") ?? [];
  return <PathFrame title="Roadmap" description="Program milestones from ROADMAP.md, with host usage split at each milestone's ship date." subject="roadmap" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : roadmap?.availability === "available" ? <>
      <Text style={textStyle(theme, true)}>{roadmap.counts.shipped} of {plural(roadmap.counts.total, "milestone")} recorded as shipped{roadmap.counts.active ? ` · ${roadmap.counts.active} active` : ""}{roadmap.counts.abandoned ? ` · ${roadmap.counts.abandoned} abandoned` : ""}</Text>
      {notice && <Text accessibilityLiveRegion="polite" style={smallStyle(theme)}>Usage: {notice}</Text>}
      {usage.usage && !usage.usage.complete && <Text style={smallStyle(theme)}>Still reading host session logs; usage will grow.</Text>}
      {warnings.map((warning) => <Text key={warning} style={smallStyle(theme)}>{PATH_WARNING_COPY[warning]}</Text>)}
      {roadmap.milestones.length ? <View role="list" accessibilityLabel="Roadmap milestones" style={{ gap: 4 }}>
        {roadmap.milestones.map((milestone) => <MilestoneRow key={milestone.id} milestone={milestone} slot={slots.get(milestone.id)} theme={theme} compact={compact} />)}
      </View> : <Text style={textStyle(theme, true)}>No milestones are listed in this roadmap.</Text>}
      {unattributed?.turns ? <Text style={smallStyle(theme)}>Usage not tied to a roadmap milestone: {slotSummary(unattributed)} · {tokens(unattributed.tokens)} tokens.</Text> : null}
      <Text style={smallStyle(theme)}>Statuses as recorded in the roadmap, not verified integration. Usage dated on or before a milestone's ship date counts toward it; later usage counts toward the current milestone, as the GSD Path daemon splits it.</Text>
    </> : <Card title={roadmap?.availability === "absent" ? "No program roadmap" : "Roadmap unavailable"} theme={theme}>
      <Text style={textStyle(theme, true)}>{roadmap?.availability === "absent" ? "This project runs a single milestone; no program roadmap is recorded." : "The roadmap could not be read."}</Text>
      {roadmap?.availability === "absent" && usage.usage?.availability === "available" ? <Text style={smallStyle(theme)}>Usage in this workspace: {slotSummary(totalSlot(usage.usage.totals))} · {tokens(totalSlot(usage.usage.totals).tokens)} tokens.</Text> : null}
    </Card>}
  </PathFrame>;
}
