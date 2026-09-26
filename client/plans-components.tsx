import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { PhaseChecks } from "./phase-checks.js";

type Plans = BoardOverview["plans"];
type Phase = Plans["phases"][number];
type Plan = Phase["entries"][number];

const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 20, flexShrink: 1 });

export function planEvidenceLabel(plan: Plan): string[] {
  return [
    plan.roadmapConflict ? "Conflicting roadmap checkmarks" : plan.roadmapChecked === null ? "Not listed in roadmap" : plan.roadmapChecked ? "Roadmap checked" : "Roadmap unchecked",
    plan.planObserved ? "Plan file observed" : "No readable plan file observed",
    plan.summaryObserved ? "Summary observed" : "No readable summary observed",
  ];
}

function PlanRow({ plan, phaseId, expanded, onToggle, theme, compact }: { plan: Plan; phaseId: string; expanded: boolean; onToggle(): void; theme: BoardTheme; compact: boolean }) {
  const evidence = planEvidenceLabel(plan);
  const accessibleTitle = (plan.title ?? "title not observed").replace(/[.!?]+$/, "");
  return <View style={{ borderTopWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Plan ${plan.id}: ${accessibleTitle}. ${plan.wave === null ? "Wave not recorded" : `Wave ${plan.wave}`}. ${evidence.join(". ")}. ${expanded ? "Hide details" : "Show details"}.`} accessibilityState={{ expanded }} onPress={onToggle} style={{ minHeight: 52, flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: compact ? 5 : 12, paddingHorizontal: compact ? 14 : 18, paddingVertical: 9 }}>
      <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : 110 }}>Plan {plan.id}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text style={textStyle(theme, !plan.title)} numberOfLines={compact ? undefined : 2}>{plan.title ?? "Title not observed"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
          {evidence.map((label) => <Text key={label} style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>{label}</Text>)}
        </View>
      </View>
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{plan.wave === null ? "Wave not recorded" : `Wave ${plan.wave}`} · {expanded ? "Hide details" : "Show details"}</Text>
    </Pressable>
    {expanded && <View accessibilityLabel={`Plan ${phaseId}-${plan.number} details`} style={{ gap: 8, marginHorizontal: compact ? 14 : 18, marginBottom: 12, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface2 ?? theme.colors.surface0 }}>
      <Text style={{ ...textStyle(theme), fontWeight: "600" }}>Plan evidence</Text>
      <Text style={textStyle(theme, true)}>{plan.objective ?? "Objective not observed in the plan file."}</Text>
      {plan.objective?.includes("[omitted]") && <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Location-like text omitted from this excerpt.</Text>}
      {plan.summaryObserved && <View style={{ gap: 4 }}>
        <Text style={{ ...textStyle(theme), fontWeight: "600" }}>Summary, as recorded</Text>
        <Text style={textStyle(theme, true)}>{plan.summaryExcerpt ?? (plan.summaryExcerptLimited ? "No safe summary introduction available." : "No introductory prose recorded before the next heading.")}</Text>
        {plan.summaryExcerptLimited && plan.summaryExcerpt && <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Some summary wording was withheld or shortened for safe display.</Text>}
      </View>}
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Roadmap checkmarks and observed summaries are separate facts; neither proves verification.</Text>
    </View>}
  </View>;
}

function PhaseGroup({ phase, expanded, onToggle, expandedPlanId, onTogglePlan, theme, compact }: { phase: Phase; expanded: boolean; onToggle(): void; expandedPlanId: string | null; onTogglePlan(id: string): void; theme: BoardTheme; compact: boolean }) {
  const checked = phase.entries.filter((entry) => entry.roadmapChecked === true).length;
  const summaries = phase.entries.filter((entry) => entry.summaryObserved).length;
  const declared = phase.declaredPlans === null ? "total not confirmed" : `${phase.declaredPlans} declared`;
  return <View style={{ minWidth: 0, borderRadius: 10, borderWidth: 1, borderColor: phase.current ? theme.colors.accent : theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Phase ${phase.id}: ${phase.title}. ${phase.current ? "Current phase. " : ""}${checked} roadmap checked. ${declared}. ${summaries} summaries observed. ${expanded ? "Hide plans" : "Show plans"}.`} accessibilityState={{ expanded }} onPress={onToggle} style={{ minHeight: 56, padding: compact ? 14 : 18, flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text style={{ ...textStyle(theme), fontWeight: "600", fontSize: 16 }}>Phase {phase.id} · {phase.title}{phase.current ? " · Current" : ""}</Text>
        <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{checked} roadmap checked · {declared} · {summaries} summaries observed</Text>
      </View>
      <Text style={{ ...textStyle(theme), fontSize: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>{expanded ? "Hide plans  ⌃" : "Show plans  ⌄"}</Text>
    </Pressable>
    {expanded && <>
      <PhaseChecks phase={phase} theme={theme} compact={compact} />
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", paddingHorizontal: compact ? 14 : 18, paddingVertical: 12 }}>Plans in this phase</Text>
      {phase.entries.length ? <View role="list" accessibilityLabel={`Plans for phase ${phase.id}`}>
        {phase.entries.map((entry) => <View key={entry.id} role="listitem"><PlanRow plan={entry} phaseId={phase.id} expanded={expandedPlanId === entry.id} onToggle={() => onTogglePlan(entry.id)} theme={theme} compact={compact} /></View>)}
      </View> : <View style={{ padding: compact ? 14 : 18, borderTopWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}><Text style={textStyle(theme, true)}>No plan files or roadmap plan entries observed for this phase.</Text></View>}
    </>}
  </View>;
}

export function PlansView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [selected, setSelected] = useState<{ workspaceId: string; phaseId: string | null } | null>(null);
  const [openPlan, setOpenPlan] = useState<{ workspaceId: string; id: string } | null>(null);
  const plans = state.snapshot?.overview?.plans;
  const defaultPhase = plans?.phases.find((phase) => phase.current)?.id ?? plans?.phases[0]?.id;
  const selectedId = selected?.workspaceId === state.workspaceId && (selected.phaseId === null || plans?.phases.some((phase) => phase.id === selected.phaseId)) ? selected.phaseId : defaultPhase;
  const expandedPlanId = openPlan?.workspaceId === state.workspaceId ? openPlan.id : null;
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 20 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Plans</Text><Text style={textStyle(theme, true)}>Current-milestone plan files and roadmap annotations.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing plans" : "Refresh plans"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={{ ...textStyle(theme), fontWeight: "500" }}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading plans…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh plans. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Planning files may have changed. Refresh to update plans.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      {plans?.availability === "available" ? <>
        <View style={{ flexDirection: compact ? "column" : "row", gap: 12 }}>
          {[{ label: "Plan files observed", value: plans.observedPlans }, { label: "Matching summaries observed", value: plans.observedSummaries }].map((fact) => <View key={fact.label} style={{ flex: 1, minWidth: 0, gap: 4, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={{ ...textStyle(theme), fontSize: 22, fontWeight: "600" }}>{fact.value}</Text><Text style={{ ...textStyle(theme, true), fontSize: 12 }}>{fact.label}</Text></View>)}
        </View>
        <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>A summary file is observed evidence, not a verified completion.</Text>
        {plans.limited && <Text role="alert" style={textStyle(theme, true)}>Some plan or summary evidence could not be fully read; counts may be partial.</Text>}
        {plans.phases.length ? plans.phases.map((phase) => <PhaseGroup key={phase.id} phase={phase} expanded={phase.id === selectedId} onToggle={() => setSelected({ workspaceId: state.workspaceId, phaseId: selectedId === phase.id ? null : phase.id })} expandedPlanId={expandedPlanId} onTogglePlan={(id) => setOpenPlan(expandedPlanId === id ? null : { workspaceId: state.workspaceId, id })} theme={theme} compact={compact} />) : <Text style={textStyle(theme, true)}>No phases declared in this milestone.</Text>}
      </> : <View style={{ padding: 20, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}><Text style={textStyle(theme)}>Plans unavailable</Text><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></View>}
    </>}
  </ScrollView>;
}
