import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

type OverviewPhase = BoardOverview["roadmap"]["phases"][number];
type ThemeProps = { theme: BoardTheme };
const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });

export function statusLabel(status: string | null): string {
  if (!status) return "Not recorded";
  if (/^executing(?:\s|$)/i.test(status)) return "Executing";
  if (/^planning(?:\s|$)/i.test(status)) return "Planning";
  if (/^verifying(?:\s|$)/i.test(status)) return "Verifying";
  if (/^in[_ -]progress$/i.test(status)) return "In progress";
  if (/^complete(?:d)?$/i.test(status)) return "Complete";
  return status.replace(/_/g, " ");
}

function dateLabel(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

export function planCountLabel(phase: OverviewPhase): string {
  if (phase.totalPlans === null) return phase.completedPlans === null ? "Plans not declared" : `${phase.completedPlans} plans completed · total TBD`;
  return `${phase.completedPlans ?? "—"} / ${phase.totalPlans} plans`;
}

function Card({ title, source, action, children, theme, compact }: ThemeProps & { title: string; source: string; action?: ReactNode; children: ReactNode; compact: boolean }) {
  return <View style={{ flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" : 0, minWidth: 0, padding: 20, gap: 20, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <View style={{ gap: 4 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text><Text style={{ ...textStyle(theme, true), fontSize: 11, letterSpacing: 0.3 }}>{source}</Text></View>
      {action}
    </View>
    {children}
  </View>;
}

function StateField({ label, value, detail, theme }: ThemeProps & { label: string; value: string; detail?: string | null }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
    <Text style={{ ...textStyle(theme, true), width: 84 }}>{label}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ ...textStyle(theme), fontWeight: "500" }}>{value}</Text>{detail && <Text style={{ ...textStyle(theme, true), fontSize: 13 }}>{detail}</Text>}</View>
  </View>;
}

function StateCard({ state, theme, compact }: ThemeProps & { state: BoardOverview["state"] | undefined; compact: boolean }) {
  return Card({ title: "State", source: "STATE.md", theme, compact, children: state?.availability === "available" ? <>
    <View style={{ gap: 18 }}>
      {StateField({ label: "Milestone", value: state.milestone ?? "Not recorded", detail: state.milestoneName, theme })}
      {StateField({ label: "Phase", value: state.phaseId ? `Phase ${state.phaseId}` : "Not recorded", detail: state.phaseName, theme })}
      {StateField({ label: "Status", value: statusLabel(state.status), theme })}
      {StateField({ label: "Plan", value: state.plan ?? "Not recorded", theme })}
    </View>
    <View style={{ gap: 7, paddingTop: 18, borderTopWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
      <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "600" }}>Last activity</Text>
      <Text style={textStyle(theme, true)}>{state.lastActivity ?? "No activity recorded."}</Text>
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>State updated: {dateLabel(state.updatedAt)}</Text>
    </View>
    <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Recorded planning state, not live execution status.</Text>
  </> : <View style={{ gap: 6 }}><Text style={textStyle(theme)}>State unavailable</Text><Text style={textStyle(theme, true)}>No readable project state was found. Roadmap progress can still be shown independently.</Text></View> });
}

export function ProgressMeter({ percent, label, theme, large = false }: ThemeProps & { percent: number; label: string; large?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const value = Math.max(0, Math.min(100, percent));
  return <Pressable role="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value, text: label }} tabIndex={0} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ minHeight: 24, justifyContent: "center", position: "relative", zIndex: hovered || focused ? 2 : 0 }}>
    <View style={{ height: large ? 7 : 4, position: "relative" }}>
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 4, backgroundColor: theme.colors.accent, opacity: 0.15 }} />
      <View style={{ height: "100%", width: `${value}%`, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: theme.colors.accent }} />
    </View>
    {(hovered || focused) && <View style={{ position: "absolute", bottom: "100%", left: 0, maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface0 }}><Text style={{ ...textStyle(theme), fontSize: 12 }}>{label}</Text></View>}
  </Pressable>;
}

function phaseStatus(phase: OverviewPhase): string {
  if (phase.completed) return "Complete";
  if (phase.current) return "Current";
  if (phase.completedPlans !== null && phase.completedPlans > 0) return "In progress";
  return "Not started";
}

function PhaseRow({ phase, showTable, theme }: ThemeProps & { phase: OverviewPhase; showTable: boolean }) {
  const progress = phase.percent === null ? "—" : `${phase.percent}%`;
  return <View key={phase.id} role="listitem" style={{ gap: 4, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: phase.current ? theme.colors.accent : "transparent", backgroundColor: phase.current ? theme.colors.surface2 ?? theme.colors.surface0 : "transparent" }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <Text style={{ ...textStyle(theme), flex: 1, minWidth: 0, fontSize: 13, fontWeight: phase.current ? "600" : "400" }}>{phase.completed ? "✓" : "○"}  {phase.id} · {phase.title}</Text>
      <Text style={{ ...textStyle(theme), fontSize: 13, fontVariant: ["tabular-nums"] }}>{progress}</Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}><Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{planCountLabel(phase)}</Text><Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{phaseStatus(phase)}</Text></View>
    {!showTable && phase.percent !== null && <ProgressMeter percent={phase.percent} label={`Phase ${phase.id}: ${planCountLabel(phase)}, ${phase.percent}%`} theme={theme} />}
  </View>;
}

function RoadmapTable({ phases, theme }: ThemeProps & { phases: readonly OverviewPhase[] }) {
  const columns = ["Phase", "Plans", "Status", "Progress"];
  const widths = [210, 150, 120, 80];
  return <ScrollView horizontal nestedScrollEnabled style={{ flexGrow: 0 }}>
    <View role="table" accessibilityLabel="Roadmap progress data table" style={{ minWidth: 560, gap: 2 }}>
      <View role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
        {columns.map((column, index) => <Text key={column} role="columnheader" style={{ ...textStyle(theme, true), fontSize: 12, fontWeight: "600", width: widths[index] }}>{column}</Text>)}
      </View>
      {phases.map((phase) => <View key={phase.id} role="row" style={{ flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
        {[`${phase.id} · ${phase.title}`, planCountLabel(phase), phaseStatus(phase), phase.percent === null ? "—" : `${phase.percent}%`].map((value, index) => <Text key={index} role={index === 0 ? "rowheader" : "cell"} style={{ ...textStyle(theme, index !== 0), fontSize: 12, width: widths[index], paddingRight: 12 }}>{value}</Text>)}
      </View>)}
    </View>
  </ScrollView>;
}

function RoadmapCard({ roadmap, showTable, onToggleTable, theme, compact }: ThemeProps & { roadmap: BoardOverview["roadmap"] | undefined; showTable: boolean; onToggleTable(): void; compact: boolean }) {
  const action = <Pressable accessibilityRole="button" accessibilityLabel={showTable ? "Show progress bars" : "Show progress as a data table"} accessibilityState={{ selected: showTable }} onPress={onToggleTable} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, borderRadius: 7 }}><Text style={{ ...textStyle(theme), fontSize: 12 }}>{showTable ? "Chart view" : "Table view"}</Text></Pressable>;
  const current = roadmap?.phases.find((phase) => phase.current);
  return Card({ title: "Roadmap Progress", source: "ROADMAP.md", action: roadmap?.phases.length ? action : undefined, theme, compact, children: roadmap?.availability === "available" ? <>
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}><Text style={{ ...textStyle(theme, true), flex: 1 }}>{roadmap.completedPhases} of {roadmap.totalPhases} phases complete</Text><Text style={{ ...textStyle(theme), fontSize: 30, lineHeight: 36, fontWeight: "600" }}>{roadmap.percent === null ? "—" : `${roadmap.percent}%`}</Text></View>
      {!showTable && roadmap.percent !== null && <ProgressMeter large percent={roadmap.percent} label={`${roadmap.completedPhases} of ${roadmap.totalPhases} phases marked complete, ${roadmap.percent}%`} theme={theme} />}
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Based on phase checkboxes, not a verification verdict.</Text>
    </View>
    {current && <Text style={{ ...textStyle(theme), fontSize: 12, fontWeight: "500" }}>Current phase · {current.id}</Text>}
    {roadmap.phases.length ? showTable ? <RoadmapTable phases={roadmap.phases} theme={theme} /> : <View role="list" accessibilityLabel="Phase plan progress" style={{ gap: 3, marginHorizontal: -12 }}>{roadmap.phases.map((phase) => PhaseRow({ phase, showTable, theme }))}</View> : <Text style={textStyle(theme, true)}>No phases are listed in this roadmap.</Text>}
    {roadmap.phases.length > 0 && <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Each phase shows its declared plan progress. TBD totals are not treated as zero or included in an overall plan percentage.</Text>}
  </> : <View style={{ gap: 6 }}><Text style={textStyle(theme)}>Roadmap unavailable</Text><Text style={textStyle(theme, true)}>No readable phase checklist was found. State remains available independently.</Text></View> });
}

function RequirementsCard({ requirements, theme, compact }: ThemeProps & { requirements: BoardOverview["requirements"] | undefined; compact: boolean }) {
  return Card({ title: "Requirements", source: "REQUIREMENTS.md", theme, compact, children: requirements?.availability === "available" ? <>
    <View style={{ gap: 8 }}>
      <Text style={{ ...textStyle(theme), fontSize: 20, fontWeight: "600" }}>{requirements.total} requirements</Text>
      {requirements.total === 0 ? <Text style={textStyle(theme, true)}>No requirements declared for this milestone.</Text> : <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <Text style={{ ...textStyle(theme, true), flex: 1 }}>{requirements.completed} of {requirements.total} marked complete</Text>
          <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{requirements.percent === null ? "—" : `${requirements.percent}%`}</Text>
        </View>
        {requirements.percent !== null && <ProgressMeter percent={requirements.percent} label={`${requirements.completed} of ${requirements.total} requirements marked complete, ${requirements.percent}%`} theme={theme} />}
        <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{requirements.total - requirements.completed} pending · {requirements.mapped === null ? "Phase mapping unavailable" : `${requirements.mapped} of ${requirements.total} mapped to phases`}</Text>
      </>}
    </View>
    <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Checklist status only; not independent verification of product behavior.</Text>
  </> : <View style={{ gap: 6 }}><Text style={textStyle(theme)}>Requirements unavailable</Text><Text style={textStyle(theme, true)}>No readable current-milestone requirements checklist was found.</Text></View> });
}

const warningCopy: Record<BoardOverview["warnings"][number], string> = {
  "state-unavailable": "State could not be read.",
  "roadmap-unavailable": "Roadmap could not be read.",
  "state-malformed": "Some state fields could not be read safely.",
  "roadmap-malformed": "The roadmap contains ambiguous phase declarations.",
  "roadmap-limited": "Only part of the roadmap could be read; overall progress is not shown.",
  "plan-count-conflict": "Some roadmap plan counts disagree. Conflicting plan percentages are not shown.",
  "phase-not-in-roadmap": "The phase recorded in State is not listed in this roadmap.",
  "requirements-unavailable": "Requirements could not be read.",
  "requirements-malformed": "The requirements checklist contains ambiguous entries.",
  "requirements-scope-unknown": "Requirements could not be tied to the current milestone.",
  "requirements-trace-conflict": "The requirements checklist and phase mapping disagree; affected values are withheld.",
  "requirements-limited": "The requirements file exceeded the safe observation limits.",
};

export function OverviewView({ state, onRefresh, theme, compact = false, showTable = false, onToggleTable = () => undefined }: {
  state: BoardViewState;
  onRefresh(): void;
  theme: BoardTheme;
  compact?: boolean;
  showTable?: boolean;
  onToggleTable?(): void;
}) {
  const overview = state.snapshot?.overview;
  const hasSnapshot = Boolean(state.snapshot);
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, gap: 20, paddingBottom: 32 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ gap: 4, flex: 1, minWidth: 0 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Project overview</Text><Text style={textStyle(theme, true)}>State, roadmap progress, and requirements for the selected workspace.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing overview" : "Refresh overview"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={{ ...textStyle(theme), fontWeight: "500" }}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !hasSnapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading project overview…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh the overview. {hasSnapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Planning files may have changed. Refresh to update these cards.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: "stretch", gap: 20 }}>
        <View style={{ flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" : 0, minWidth: 0, gap: 20 }}>
          {StateCard({ state: overview?.state, theme, compact: true })}
          {!compact && RequirementsCard({ requirements: overview?.requirements, theme, compact: true })}
        </View>
        <View style={{ flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" : 0, minWidth: 0 }}>
          {RoadmapCard({ roadmap: overview?.roadmap, showTable, onToggleTable, theme, compact: true })}
        </View>
        {compact && RequirementsCard({ requirements: overview?.requirements, theme, compact: true })}
      </View>
      {overview && overview.warnings.length > 0 && <View style={{ gap: 4 }}>{overview.warnings.map((warning) => <Text key={warning} style={{ ...textStyle(theme, true), fontSize: 12 }}>{warningCopy[warning]}</Text>)}</View>}
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Last refresh: {dateLabel(state.snapshot?.observedAt ?? null)}</Text>
    </>}
  </ScrollView>;
}
