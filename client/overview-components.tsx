import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { AgentChip, BoardFrame, Needs, plural, type Need, type ThemeProps, type WorkspaceAgent } from "./board-frame.js";
import type { BoardTab, TabBadge } from "./board-tabs.js";
import { phaseStages, stagesLabel } from "./phase-checks.js";
import { phaseSummary as uatSummary } from "./uat-components.js";
import { phaseSummary as validationSummary } from "./validation-components.js";
import { phaseSummary as verificationSummary } from "./verification-components.js";
import { CORE_USAGE_SOURCE, ModelBars, TokenMix, usageAlerts, UsageFigures } from "./path-usage-components.js";
import { Heartbeat } from "./timeline-components.js";
import { BarRow, FadeIn, figures, kicker, Legend, line, Pill, RelativeTime, Section, SegmentBar, Stat, StationTrack, surface, text, tint, toneColor, Toggle, type Tone, type TrackStation } from "./ui-kit.js";
import { createUsageState, type UsageViewState } from "./usage-controller.js";
import { money } from "./usage-format.js";

export { dateLabel } from "./ui-kit.js";

type OverviewPhase = BoardOverview["roadmap"]["phases"][number];

export function statusLabel(status: string | null): string {
  if (!status) return "Not recorded";
  if (/^executing(?:\s|$)/i.test(status)) return "Executing";
  if (/^planning(?:\s|$)/i.test(status)) return "Planning";
  if (/^verifying(?:\s|$)/i.test(status)) return "Verifying";
  if (/^in[_ -]progress$/i.test(status)) return "In progress";
  if (/^complete(?:d)?$/i.test(status)) return "Complete";
  return status.replace(/_/g, " ");
}

const statusTone = (label: string): Tone => label === "Complete" ? "success" : label === "Executing" || label === "In progress" ? "accent" : label === "Verifying" ? "warning" : "neutral";

export function planCountLabel(phase: OverviewPhase): string {
  if (phase.totalPlans === null) return phase.completedPlans === null ? "Plans not declared" : `${phase.completedPlans} plans completed · total TBD`;
  return `${phase.completedPlans ?? "—"} / ${phase.totalPlans} plans`;
}

export function ProgressMeter({ percent, label, theme, large = false }: ThemeProps & { percent: number; label: string; large?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const value = Math.max(0, Math.min(100, percent));
  const color = toneColor(theme, value >= 100 ? "success" : "accent");
  return <Pressable role="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value, text: label }} tabIndex={0} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ minHeight: 24, justifyContent: "center", position: "relative", zIndex: hovered || focused ? 2 : 0 }}>
    <View style={{ height: large ? 8 : 5, borderRadius: 4, overflow: "hidden", backgroundColor: surface(theme, 2) }}>
      <View style={{ height: "100%", width: `${value}%`, borderRadius: 4, backgroundColor: color }} />
    </View>
    {(hovered || focused) && <View style={{ position: "absolute", bottom: "100%", left: 0, maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: surface(theme, 2) }}><Text style={text(theme, 12)}>{label}</Text></View>}
  </Pressable>;
}

const phaseStatus = (phase: OverviewPhase) => phase.completed ? "Complete" : phase.current ? "Current" : phase.completedPlans !== null && phase.completedPlans > 0 ? "In progress" : "Not started";

/** The milestone's phases as stations; a long roadmap shows the sixteen around the current phase. */
export function phaseStations(roadmap: BoardOverview["roadmap"], limit = 16): { stations: TrackStation[]; shown: number } {
  const phases = roadmap.phases;
  const current = Math.max(0, phases.findIndex((phase) => phase.current));
  const start = phases.length <= limit ? 0 : Math.min(Math.max(0, current - Math.floor(limit / 3)), phases.length - limit);
  const window = phases.slice(start, start + limit);
  return { shown: window.length, stations: window.map((phase) => ({ key: phase.id, label: phase.id, state: phase.completed ? "done" : phase.current ? "current" : "future",
    detail: phase.totalPlans !== null ? `${phase.completedPlans ?? "—"}/${phase.totalPlans}` : null })) };
}


type Flagged = { id: string; danger: boolean; text: string };
const listed = (items: readonly string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/** One line per kind of evidence: a single phase with its summary, several with their ids, the current one marked. */
function flaggedNeed(kind: string, tab: BoardTab, flagged: readonly Flagged[], current: string | null): Need | null {
  if (!flagged.length) return null;
  const tone = flagged.some((phase) => phase.danger) ? "danger" : "warning";
  if (flagged.length === 1) return { tone, title: `Phase ${flagged[0].id} ${kind} needs a look`, detail: flagged[0].text, tab };
  const ids = flagged.map((phase) => phase.id === current ? `${phase.id} (current)` : phase.id);
  const shown = ids.length > 8 ? [...ids.slice(0, 7), `${ids.length - 7} more`] : ids;
  return { tone, title: `${kind === "UAT" ? kind : `${kind[0].toUpperCase()}${kind.slice(1)}`} needs a look in ${flagged.length} phases`, detail: `Phases ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`, tab };
}

/** What waits on a person in a GSD Core milestone: an agent asking for input, UAT, verification and validation needing a look, open debug sessions. */
export function coreNeeds(overview: BoardOverview, agent: WorkspaceAgent = null): Need[] {
  const current = overview.state.phaseId;
  const uat = overview.uat.phases.map((phase) => ({ phase, summary: uatSummary(phase) })).filter(({ summary }) => summary.attention)
    .map(({ phase, summary }) => ({ id: phase.id, danger: phase.results.issue + phase.results.blocked > 0, text: summary.text }));
  const verification = overview.verification.phases.map((phase) => ({ phase, summary: verificationSummary(phase) })).filter(({ summary }) => summary.attention)
    .map(({ phase, summary }) => ({ id: phase.id, danger: phase.statusKind === "gaps_found" || phase.openGapCount > 0, text: summary.text }));
  const validation = overview.validation.phases.map((phase) => ({ phase, summary: validationSummary(phase) })).filter(({ summary }) => summary.attention)
    .map(({ phase, summary }) => ({ id: phase.id, danger: false, text: summary.text }));
  const { debug } = overview;
  const open = debug.counts.unresolved;
  const debugPartial = debug.availability === "available" && (!debug.countsComplete || debug.counts.unavailable > 0);
  // A source that could not be read may hold something that needs a person; say so rather than look calm.
  const unread: [string, BoardTab][] = ([["UAT", "uat", overview.uat], ["verification", "verification", overview.verification], ["validation", "validation", overview.validation], ["debug", "debug", debug]] as const)
    .filter(([, , source]) => source.availability !== "available").map(([name, tab]) => [name, tab]);
  if (debug.availability === "available" && debug.counts.unavailable > 0) unread.push(["some debug files", "debug"]);
  return [
    agent?.status === "needs_input" ? { tone: "warning", title: "An agent in this workspace is waiting for your input", detail: null, tab: null } satisfies Need : null,
    unread.length ? { tone: "warning", title: `${listed(unread.map(([name]) => name))} could not be read`, detail: "Anything recorded there is not shown here.", tab: unread[0][1] } satisfies Need : null,
    flaggedNeed("UAT", "uat", uat, current),
    flaggedNeed("verification", "verification", verification, current),
    flaggedNeed("validation", "validation", validation, current),
    open ? { tone: "warning", title: `${debugPartial ? "At least " : ""}${plural(open, "debug session")} not resolved`, detail: null, tab: "debug" } satisfies Need : null,
  ].filter((need): need is Need => need !== null);
}

/** Plan summaries, phases needing a look, pending TODOs and unresolved debug sessions, beside the GSD Core tabs they belong to. */
export function coreBadges(overview: BoardOverview | undefined): Partial<Record<BoardTab, TabBadge>> {
  if (!overview) return {};
  const flagged = <T,>(phases: readonly T[], summary: (phase: T) => { attention: boolean }) => phases.filter((phase) => summary(phase).attention).length;
  const uat = flagged(overview.uat.phases, uatSummary);
  const verification = flagged(overview.verification.phases, verificationSummary);
  const validation = flagged(overview.validation.phases, validationSummary);
  const uatDanger = overview.uat.phases.some((phase) => uatSummary(phase).attention && phase.results.issue + phase.results.blocked > 0);
  const gaps = overview.verification.phases.some((phase) => verificationSummary(phase).attention && (phase.statusKind === "gaps_found" || phase.openGapCount > 0));
  const { plans, todos, debug } = overview;
  const open = debug.availability === "available" ? debug.counts.unresolved : 0;
  const atLeast = (value: number, partial: boolean) => partial ? `≥${value}` : String(value);
  return {
    ...(plans.availability === "available" && plans.observedPlans ? { plans: { label: `${plans.observedSummaries}/${plans.observedPlans}`, tone: plans.observedSummaries >= plans.observedPlans && plans.phases.every((phase) => phase.declaredPlans !== null) ? "success" : "neutral" } } : {}),
    ...(uat ? { uat: { label: String(uat), tone: uatDanger ? "danger" : "warning" } } : {}),
    ...(verification ? { verification: { label: String(verification), tone: gaps ? "danger" : "warning" } } : {}),
    ...(validation ? { validation: { label: String(validation), tone: "warning" } } : {}),
    ...(todos.availability === "available" && todos.counts.pending ? { todos: { label: atLeast(todos.counts.pending, !todos.countsComplete) } } : {}),
    ...(open ? { debug: { label: atLeast(open, !debug.countsComplete || debug.counts.unavailable > 0), tone: "warning" } } : {}),
  };
}

function Hero({ overview, usage, agent, theme, compact }: ThemeProps & { overview: BoardOverview; usage: UsageViewState; agent: WorkspaceAgent; compact: boolean }) {
  const activity = usage.usage?.availability === "available" ? usage.usage.activity : [];
  const { state, roadmap, plans } = overview;
  const current = roadmap.phases.find((phase) => phase.current);
  const position = current ? roadmap.phases.indexOf(current) + 1 : null;
  const planPhase = plans.phases.find((phase) => phase.current) ?? plans.phases.find((phase) => phase.id === state.phaseId);
  const status = statusLabel(state.status);
  const accent = toneColor(theme, "accent");
  const { stations, shown } = phaseStations(roadmap, compact ? 7 : 16);
  const stages = phaseStages(planPhase, compact);
  const summaries = planPhase?.entries.filter((entry) => entry.summaryObserved).length ?? 0;
  const planTotal = Math.max(planPhase?.declaredPlans ?? 0, planPhase?.entries.length ?? 0);
  const ahead = roadmap.totalPhases - roadmap.completedPhases - (current && !current.completed ? 1 : 0);
  return <View style={{ borderRadius: 20, padding: compact ? 18 : 26, gap: 20, overflow: "hidden", backgroundColor: tint(theme, accent, 0.1) }}>
    <View style={{ position: "absolute", right: -120, top: -160, width: 420, height: 420, borderRadius: 210, backgroundColor: tint(theme, accent, 0.05) }} />
    <View style={{ position: "absolute", right: -40, top: -90, width: 220, height: 220, borderRadius: 110, backgroundColor: tint(theme, accent, 0.05) }} />
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 10 }}>
      <Text style={{ ...kicker(theme), color: accent }}>{[state.milestone ?? "Milestone", state.milestoneName, position ? `phase ${position} of ${roadmap.phases.length}` : null].filter(Boolean).join("  ·  ")}</Text>
      <AgentChip agent={agent} theme={theme} />
    </View>
    <View style={{ flexDirection: compact ? "column" : "row", gap: 24, alignItems: compact ? "stretch" : "flex-end" }}>
      <View style={{ gap: 8, flex: 1, minWidth: 0 }}>
        <Text role="heading" numberOfLines={2} style={{ ...text(theme, compact ? 24 : 30, "700"), letterSpacing: -0.5 }}>{state.phaseId ? `Phase ${state.phaseId}` : "Phase not recorded"}{state.phaseName ? ` · ${state.phaseName}` : ""}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <Pill theme={theme} tone={statusTone(status)} label={status} strong />
          {state.plan && <Text numberOfLines={1} style={{ ...text(theme, 13, "400", true), flexShrink: 1 }}>Plan: {state.plan}</Text>}
        </View>
      </View>
      {activity.length > 0 && <View style={{ width: compact ? undefined : 260 }}><Heartbeat activity={activity} theme={theme} /></View>}
    </View>
    {roadmap.availability === "available" && stations.length > 0 && <View style={{ gap: 6 }}>
      <Text style={kicker(theme)}>Milestone phases{shown < roadmap.phases.length ? ` · ${shown} of ${roadmap.phases.length}` : ""}</Text>
      <StationTrack theme={theme} compact={compact} stations={stations} label={`Phases. ${roadmap.phases.map((phase) => `${phase.id}: ${phaseStatus(phase).toLowerCase()}`).join("; ")}`} />
    </View>}
    {planPhase && <View style={{ gap: 6 }}>
      <Text style={kicker(theme)}>Phase {planPhase.id} so far</Text>
      <StationTrack theme={theme} compact={compact} stations={stages} label={stagesLabel(planPhase, stages)} />
    </View>}
    {roadmap.availability === "available" && roadmap.totalPhases > 0 && <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 12 : 24, alignItems: compact ? "stretch" : "center" }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ ...text(theme, 44, "700"), ...figures, letterSpacing: -1, lineHeight: 50 }}>{roadmap.percent === null ? "—" : `${roadmap.percent}%`}</Text>
        <Text style={text(theme, 13, "400", true)}>{`${roadmap.completedPhases} of ${plural(roadmap.totalPhases, "phase")}\nmarked complete`}</Text>
      </View>
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        {roadmap.percent !== null && <SegmentBar theme={theme} height={12} label={`${plural(roadmap.completedPhases, "phase")} marked complete, ${current && !current.completed ? "1 current, " : ""}${ahead} ahead`} segments={[
          { label: "complete", value: roadmap.completedPhases, color: toneColor(theme, "success") },
          { label: "current", value: current && !current.completed ? 1 : 0, color: theme.colors.foreground },
          { label: "ahead", value: ahead, color: tint(theme, theme.colors.foregroundMuted, 0.3) },
        ]} />}
        {roadmap.percent !== null && <Legend theme={theme} items={[
          { color: toneColor(theme, "success"), label: `${roadmap.completedPhases} complete` },
          ...(current && !current.completed ? [{ color: theme.colors.foreground, label: `phase ${current.id} current` }] : []),
          ...(ahead > 0 ? [{ color: tint(theme, theme.colors.foregroundMuted, 0.3), label: `${ahead} ahead` }] : []),
        ]} />}
        {planPhase && planTotal > 0 && <Text style={{ ...text(theme, 12, "400", true), ...figures }}>Phase {planPhase.id}: {summaries} of {plural(planTotal, "plan")} with a summary{planPhase.declaredPlans === null ? " · total not confirmed" : ""}</Text>}
      </View>
    </View>}
  </View>;
}

function Figures({ overview, theme }: ThemeProps & { overview: BoardOverview }) {
  const { requirements, roadmap, plans, todos, debug } = overview;
  const debugPartial = !debug.countsComplete || debug.counts.unavailable > 0;
  const least = (value: number, partial: boolean) => partial ? `At least ${value}` : String(value);
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    <Stat theme={theme} label="Requirements" value={requirements.availability === "available" ? `${requirements.completed}/${requirements.total}` : "—"} detail={requirements.availability !== "available" ? "Not shown" : !requirements.total ? "None declared" : requirements.percent === null ? "Percentage withheld" : `${requirements.percent}% marked complete`} />
    <Stat theme={theme} label="Phases" value={roadmap.availability === "available" ? `${roadmap.completedPhases}/${roadmap.totalPhases}` : "—"} detail={roadmap.percent === null ? null : `${roadmap.percent}% marked complete`} />
    <Stat theme={theme} label="Plan summaries" value={plans.availability === "available" ? String(plans.observedSummaries) : "—"} detail={plans.availability === "available" ? `of ${plural(plans.observedPlans, "plan file")} observed` : null} />
    <Stat theme={theme} label="TODOs" size={todos.countsComplete ? 26 : 20} value={todos.availability === "available" ? least(todos.counts.pending, !todos.countsComplete) : "—"} detail={todos.availability === "available" ? `pending · ${todos.counts.backlog + todos.counts.deferred} in backlog` : null} />
    <Stat theme={theme} label="Debug" size={debugPartial ? 20 : 26} value={debug.availability === "available" ? least(debug.counts.unresolved, debugPartial) : "—"} detail={debug.availability === "available" ? `not resolved · ${debugPartial ? "at least " : ""}${plural(debug.counts.active + debug.counts.archived, "session file")}` : null} tone={debug.counts.unresolved ? "warning" : undefined} />
  </View>;
}

/** Where this milestone's money went: its costliest phases and plans, the token mix and the models. */
function Spend({ overview, usage, theme, onNavigate }: ThemeProps & { overview: BoardOverview; usage: UsageViewState; onNavigate(tab: BoardTab): void }) {
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  if (!value) return null;
  const phases = overview.plans.availability === "available" ? overview.plans.phases : [];
  const titles = new Map(phases.map((phase) => [phase.id, phase.title]));
  const plans = new Map(phases.flatMap((phase) => phase.entries).map((plan) => [plan.id, plan.title]));
  const priced = <T extends { cost: number | null }>(items: readonly T[]) => items.filter((item) => item.cost !== null).sort((left, right) => (right.cost ?? 0) - (left.cost ?? 0));
  const milestonePhases = priced(value.phases.filter((phase) => titles.has(phase.id)));
  const milestonePlans = priced(value.plans.filter((plan) => plans.has(plan.id))).slice(0, 5);
  const spent = milestonePhases.reduce((sum, phase) => sum + (phase.cost ?? 0), 0);
  const total = value.totals.cost;
  return <Section title="Where the money went" overline="Host session logs" theme={theme} gap={16}>
    {milestonePhases.length > 0 && <View style={{ gap: 10 }}>
      <Text style={kicker(theme)}>This milestone's phases{total ? ` · ${money(Math.round(spent * 100) / 100)}, ${Math.round(100 * spent / total)}% of all spend` : ""}</Text>
      {milestonePhases.slice(0, 6).map((phase) => <BarRow key={phase.id} theme={theme} label={`Phase ${phase.id}`} detail={titles.get(phase.id)} value={phase.cost ?? 0} max={milestonePhases[0].cost ?? 0} figure={money(phase.cost)} color={toneColor(theme, "accent")} onPress={() => onNavigate("timeline")} />)}
    </View>}
    {milestonePlans.length > 0 && <View style={{ gap: 10 }}>
      <Text style={kicker(theme)}>Costliest plans</Text>
      {milestonePlans.map((plan) => <BarRow key={plan.id} theme={theme} label={plan.id} detail={plans.get(plan.id)} value={plan.cost ?? 0} max={milestonePlans[0].cost ?? 0} figure={money(plan.cost)} color={tint(theme, toneColor(theme, "accent"), 0.7)} onPress={() => onNavigate("plans")} />)}
    </View>}
    <TokenMix totals={value.totals} theme={theme} />
    <ModelBars usage={value} theme={theme} />
  </Section>;
}

function Latest({ state, theme }: ThemeProps & { state: BoardOverview["state"] }) {
  return <Section title="Latest" overline="STATE.md" aside={state.updatedAt ? <RelativeTime theme={theme} value={state.updatedAt} prefix="updated " /> : undefined} theme={theme}>
    {state.availability === "available" ? <>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ width: 3, borderRadius: 2, backgroundColor: toneColor(theme, "accent") }} />
        <Text style={{ ...text(theme, 14), flex: 1 }}>{state.lastActivity ?? "No activity recorded."}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {state.milestone && <Pill theme={theme} label={`Milestone · ${state.milestone}`} />}
        <Pill theme={theme} label={`Status · ${statusLabel(state.status)}`} />
      </View>
    </> : <Text style={text(theme, 13, "400", true)}>No readable project state was found. Roadmap progress can still be shown independently.</Text>}
  </Section>;
}

function Requirements({ requirements, theme }: ThemeProps & { requirements: BoardOverview["requirements"] }) {
  return <Section title="Requirements" overline="REQUIREMENTS.md" theme={theme}>
    {requirements.availability !== "available" ? <Text style={text(theme, 13, "400", true)}>No readable current-milestone requirements checklist was found.</Text>
      : requirements.total === 0 ? <Text style={text(theme, 13, "400", true)}>No requirements declared for this milestone.</Text> : <>
        {requirements.percent !== null && <SegmentBar theme={theme} height={10} label={`${requirements.completed} of ${requirements.total} requirements marked complete`} segments={[
          { label: "complete", value: requirements.completed, color: toneColor(theme, "success") }, { label: "pending", value: requirements.total - requirements.completed, color: tint(theme, theme.colors.foregroundMuted, 0.3) },
        ]} />}
        <Text style={{ ...text(theme, 13, "400", true), ...figures }}>{requirements.percent === null ? "Percentage withheld · " : ""}{requirements.completed} of {requirements.total} marked complete · {requirements.total - requirements.completed} pending · {requirements.mapped === null ? "phase mapping unavailable" : `${requirements.mapped} of ${requirements.total} mapped to phases`}</Text>
      </>}
  </Section>;
}

function RoadmapTable({ phases, theme }: ThemeProps & { phases: readonly OverviewPhase[] }) {
  const columns = ["Phase", "Plans", "Status", "Progress"];
  const widths = [210, 150, 120, 80];
  return <ScrollView horizontal nestedScrollEnabled style={{ flexGrow: 0 }}>
    <View role="table" accessibilityLabel="Roadmap progress data table" style={{ minWidth: 560, gap: 2 }}>
      <View role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: line(theme) }}>
        {columns.map((column, index) => <Text key={column} role="columnheader" style={{ ...text(theme, 12, "600", true), width: widths[index] }}>{column}</Text>)}
      </View>
      {phases.map((phase) => <View key={phase.id} role="row" style={{ flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderColor: line(theme) }}>
        {[`${phase.id} · ${phase.title}`, planCountLabel(phase), phaseStatus(phase), phase.percent === null ? "—" : `${phase.percent}%`].map((value, index) => <Text key={index} role={index === 0 ? "rowheader" : "cell"} style={{ ...text(theme, 12, "400", index !== 0), width: widths[index], paddingRight: 12 }}>{value}</Text>)}
      </View>)}
    </View>
  </ScrollView>;
}

function PhaseRow({ phase, theme }: ThemeProps & { phase: OverviewPhase }) {
  const color = phase.completed ? toneColor(theme, "success") : phase.current ? toneColor(theme, "accent") : theme.colors.foregroundMuted;
  return <View role="listitem" style={{ gap: 3, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: phase.current ? tint(theme, toneColor(theme, "accent"), 0.1) : "transparent" }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <Text style={{ ...text(theme, 13, phase.current ? "600" : "400"), flex: 1, minWidth: 0 }}><Text style={{ ...text(theme, 13, "700"), color }}>{phase.completed ? "✓" : phase.current ? "●" : "○"}  {phase.id}</Text>  {phase.title}</Text>
      <Text style={{ ...text(theme, 13, "600"), ...figures }}>{phase.percent === null ? "—" : `${phase.percent}%`}</Text>
    </View>
    <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{planCountLabel(phase)} · {phaseStatus(phase)}</Text>
    {phase.percent !== null && !phase.completed && <ProgressMeter percent={phase.percent} label={`Phase ${phase.id}: ${planCountLabel(phase)}, ${phase.percent}%`} theme={theme} />}
  </View>;
}

/** The roadmap as rows; a long opening run of completed phases folds behind one line, since the hero already shows them. */
function PhaseList({ phases, theme }: ThemeProps & { phases: readonly OverviewPhase[] }) {
  const [open, setOpen] = useState(false);
  const lead = phases.findIndex((phase) => !phase.completed);
  const folded = (lead === -1 ? phases.length : lead) >= 4 && !open ? (lead === -1 ? phases.length : lead) : 0;
  return <View role="list" accessibilityLabel="Phase plan progress" style={{ gap: 2, marginHorizontal: -12 }}>
    {folded > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`Show ${plural(folded, "completed phase")}`} accessibilityState={{ expanded: false }} onPress={() => setOpen(true)} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12 }}>
      <Text style={text(theme, 13, "400", true)}><Text style={{ ...text(theme, 13, "700"), color: toneColor(theme, "success") }}>✓</Text>  {phases[0].id}–{phases[folded - 1].id} · {plural(folded, "phase")} complete  ▸</Text>
    </Pressable>}
    {phases.slice(folded).map((phase) => <PhaseRow key={phase.id} phase={phase} theme={theme} />)}
  </View>;
}

function Roadmap({ roadmap, showTable, onToggleTable, theme }: ThemeProps & { roadmap: BoardOverview["roadmap"]; showTable: boolean; onToggleTable(): void }) {
  return <Section title="Roadmap" overline="ROADMAP.md" theme={theme} aside={roadmap.phases.length ? <Toggle<"chart" | "table"> theme={theme} label="Show the roadmap as" value={showTable ? "table" : "chart"} onChange={(value) => { if ((value === "table") !== showTable) onToggleTable(); }} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} /> : undefined}>
    {roadmap.availability !== "available" ? <Text style={text(theme, 13, "400", true)}>No readable phase checklist was found. State remains available independently.</Text>
      : !roadmap.phases.length ? <Text style={text(theme, 13, "400", true)}>No phases are listed in this roadmap.</Text>
      : showTable ? <RoadmapTable phases={roadmap.phases} theme={theme} /> : <PhaseList phases={roadmap.phases} theme={theme} />}
  </Section>;
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

/** What qualifies the overview: the evidence warnings, in the board's words. */
export const coreOverviewAlerts = (overview: BoardOverview | undefined) => (overview?.warnings ?? []).map((warning) => warningCopy[warning]);

/** The caveats behind the overview, folded under "About these figures". */
export function coreOverviewNotes(): string[] {
  return [
    "Recorded planning state, not live execution status. Phase stages come from the files each stage leaves; an observed file is not a passed gate.",
    "Phase progress is based on roadmap checkboxes, not a verification verdict. Each phase shows its declared plan progress; TBD totals are not treated as zero.",
    "Requirements show checklist status only, not independent verification of product behavior.",
    "The agent status is Paseo's live state for this workspace; it is not read from the project files.",
    CORE_USAGE_SOURCE,
    "A plan's spend counts the turns of the executor whose prompt names that plan; a phase's spend adds its other GSD agents, on Claude Code only, since Codex records their tasks encrypted. Orchestrator turns and other subagents are not placed in a phase, so a milestone's phases spend less than the workspace.",
  ];
}

export function OverviewView({ state, usage = createUsageState(), onRefresh, theme, compact = false, showTable = false, onToggleTable = () => undefined, agent = null, onNavigate = () => undefined }: {
  state: BoardViewState;
  usage?: UsageViewState;
  onRefresh(): void;
  theme: BoardTheme;
  compact?: boolean;
  showTable?: boolean;
  onToggleTable?(): void;
  agent?: WorkspaceAgent;
  onNavigate?(tab: BoardTab): void;
}) {
  const overview = state.snapshot?.overview;
  const column = { flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" as const : 0, minWidth: 0, gap: 16 };
  return <BoardFrame title="Overview" description="Where this milestone stands, what needs you, and how far each phase has come." subject="overview" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={[...coreOverviewAlerts(overview), ...usageAlerts(usage)]} notes={coreOverviewNotes()}>
    {!overview ? <Section theme={theme} title="Project evidence unavailable"><Text style={text(theme, 13, "400", true)}>No readable planning state was found for this workspace.</Text></Section> : <>
      <FadeIn><Hero overview={overview} usage={usage} agent={agent} theme={theme} compact={compact} /></FadeIn>
      <FadeIn delay={80}><Needs needs={coreNeeds(overview, agent)} calm="No UAT issue, verification gap, validation escalation or open debug session is recorded, and no agent is waiting for input." theme={theme} onNavigate={onNavigate} /></FadeIn>
      <FadeIn delay={140}><View style={{ gap: 10 }}><Figures overview={overview} theme={theme} /><UsageFigures usage={usage} theme={theme} /></View></FadeIn>
      <FadeIn delay={200}><View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "flex-start", gap: 16 }}>
        <View style={column}><Latest state={overview.state} theme={theme} /><Requirements requirements={overview.requirements} theme={theme} /><Spend overview={overview} usage={usage} theme={theme} onNavigate={onNavigate} /></View>
        <View style={column}><Roadmap roadmap={overview.roadmap} showTable={showTable} onToggleTable={onToggleTable} theme={theme} /></View>
      </View></FadeIn>
    </>}
  </BoardFrame>;
}
