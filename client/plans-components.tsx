import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { UsagePlan } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, BoardFrame, borderColor, Card, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { PhasePicker } from "./core-components.js";
import { PhaseChecks } from "./phase-checks.js";
import { usageAlerts } from "./path-usage-components.js";
import { clockTime, figures, Flash, kicker, Legend, line, Pill, Section, SegmentBar, Stat, surface, text, tint, toneColor, Toggle, type Tone } from "./ui-kit.js";
import { createUsageState, type UsageViewState } from "./usage-controller.js";
import { duration, integer, money } from "./usage-format.js";

type Mode = "status" | "spend";

type Plans = BoardOverview["plans"];
type Phase = Plans["phases"][number];
type Plan = Phase["entries"][number];

/** How long a plan that just changed keeps its ring when the tab is opened after the change. */
const FLASH_MS = 6_000;

export function planEvidenceLabel(plan: Plan): string[] {
  return [
    plan.roadmapConflict ? "Conflicting roadmap checkmarks" : plan.roadmapChecked === null ? "Not listed in roadmap" : plan.roadmapChecked ? "Roadmap checked" : "Roadmap unchecked",
    plan.planObserved ? "Plan file observed" : "No readable plan file observed",
    plan.summaryObserved ? "Summary observed" : "No readable summary observed",
  ];
}

/** What a plan's files show: a summary written, a plan file only, or only a roadmap line. */
export type PlanState = "summary" | "planned" | "listed";
export const planState = (plan: Plan): PlanState => plan.summaryObserved ? "summary" : plan.planObserved ? "planned" : "listed";
const PLAN_STATE_WORDS: Record<PlanState, string> = { summary: "summary", planned: "plan file", listed: "roadmap only" };
const planColor = (theme: ThemeProps["theme"], state: PlanState) => state === "summary" ? toneColor(theme, "success") : state === "planned" ? theme.colors.foreground : tint(theme, theme.colors.foregroundMuted, 0.35);
const planGlyph = (state: PlanState) => state === "summary" ? "✓" : state === "planned" ? "●" : "○";

/** A phase's plans as counted for its chip and bar: summaries, plan files without one, and the rest of the declared total. */
export function phaseCounts(phase: Phase) {
  const summaries = phase.entries.filter((entry) => entry.summaryObserved).length;
  const planned = phase.entries.filter((entry) => entry.planObserved && !entry.summaryObserved).length;
  const total = Math.max(phase.declaredPlans ?? 0, phase.entries.length);
  return { summaries, planned, rest: total - summaries - planned, total };
}

/** The plan the tab opens on: the selected phase's first plan without a summary, else its last. */
export const defaultPlan = (phase: Phase | undefined) => phase?.entries.find((entry) => !entry.summaryObserved) ?? phase?.entries.at(-1) ?? null;

function MilestoneBar({ plans, theme }: ThemeProps & { plans: Plans }) {
  const unconfirmed = plans.phases.filter((phase) => phase.declaredPlans === null).length;
  const counts = plans.phases.map(phaseCounts).reduce((sum, phase) => ({ summaries: sum.summaries + phase.summaries, planned: sum.planned + phase.planned, rest: sum.rest + phase.rest }), { summaries: 0, planned: 0, rest: 0 });
  return <View style={{ gap: 10 }}>
    <SegmentBar theme={theme} height={14} label={`${counts.summaries} plans with a summary, ${counts.planned} with a plan file only, ${counts.rest} declared or listed without a plan file`} segments={[
      { label: "summary", value: counts.summaries, color: planColor(theme, "summary") },
      { label: "planned", value: counts.planned, color: planColor(theme, "planned") },
      { label: "listed", value: counts.rest, color: planColor(theme, "listed") },
    ]} />
    <Legend theme={theme} items={[
      { color: planColor(theme, "summary"), label: `${counts.summaries} with a summary` },
      ...(counts.planned ? [{ color: planColor(theme, "planned"), label: `${counts.planned} plan file only` }] : []),
      ...(counts.rest ? [{ color: planColor(theme, "listed"), label: `${counts.rest} declared or listed, no plan file yet` }] : []),
    ]} />
    <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{plural(plans.observedPlans, "plan file")} observed · {plural(plans.observedSummaries, "matching summary", "matching summaries")} observed{unconfirmed ? ` · ${plural(unconfirmed, "phase")} without a confirmed plan total` : ""}</Text>
  </View>;
}

function Tile({ plan, spend, maxCost, mode, selected, flash, onPress, theme }: ThemeProps & { plan: Plan; spend: UsagePlan | undefined; maxCost: number; mode: Mode; selected: boolean; flash: number | null; onPress(): void }) {
  const state = planState(plan);
  const color = planColor(theme, state);
  const accent = toneColor(theme, "accent");
  const warning = toneColor(theme, "warning");
  const title = (plan.title ?? "title not observed").replace(/[.!?]+$/, "");
  return <View role="listitem"><Flash signal={flash} color={accent} radius={12}>
    <Pressable role="button" accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} accessibilityLabel={`Plan ${plan.id}: ${title}. ${plan.wave === null ? "Wave not recorded" : `Wave ${plan.wave}`}. ${planEvidenceLabel(plan).join(". ")}.${spend?.cost != null ? ` ${money(spend.cost)}.` : ""}`} onPress={onPress}
      // React Native Web reports hover to the style callback; native platforms never set it.
      style={(pressable) => ({ width: 100, height: 64, padding: 9, justifyContent: "space-between", borderRadius: 12, backgroundColor: mode === "spend" ? spend?.cost ? tint(theme, accent, 0.07 + 0.55 * spend.cost / Math.max(maxCost, spend.cost)) : surface(theme, 2) : state === "summary" ? tint(theme, color, 0.16) : surface(theme, 2), borderWidth: selected || plan.roadmapConflict ? 2 : 1, borderColor: selected ? accent : plan.roadmapConflict ? warning : state === "listed" ? line(theme) : "transparent", borderStyle: state === "listed" || (plan.roadmapConflict && !selected) ? "dashed" : "solid", transform: [{ translateY: (pressable as { hovered?: boolean }).hovered ? -2 : 0 }] })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
        <Text numberOfLines={1} style={{ ...text(theme, 13, "700"), ...figures }}>{plan.id}</Text>
        <Text style={{ ...text(theme, 12, "700"), color: state === "listed" ? theme.colors.foregroundMuted : color }}>{planGlyph(state)}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...text(theme, 11, "500", true), ...figures }}>{mode === "spend" ? spend ? money(spend.cost) : "no turns" : plan.roadmapConflict ? "roadmap conflict" : PLAN_STATE_WORDS[state]}</Text>
    </Pressable>
  </Flash></View>;
}

/** A phase's plans grouped by the wave their plan files record; plans without one come last. */
export function planWaves(phase: Phase): { wave: number | null; plans: Plan[] }[] {
  const waves = new Map<number | null, Plan[]>();
  for (const plan of phase.entries) waves.set(plan.wave, [...waves.get(plan.wave) ?? [], plan]);
  return [...waves.entries()].sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left - right).map(([wave, plans]) => ({ wave, plans }));
}

function WaveGroup({ wave, plans, spend, maxCost, mode, selected, flash, onSelect, theme }: ThemeProps & { wave: number | null; plans: readonly Plan[]; spend: ReadonlyMap<string, UsagePlan>; maxCost: number; mode: Mode; selected: string | null; flash(id: string): number | null; onSelect(id: string): void }) {
  const summaries = plans.filter((plan) => plan.summaryObserved).length;
  const finished = summaries === plans.length;
  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
      <Text role="heading" style={{ ...text(theme, 15, "700"), ...figures, color: finished ? toneColor(theme, "success") : theme.colors.foreground }}>{wave === null ? "No wave" : `W${wave}`}</Text>
      <Text style={{ ...text(theme, 11, "400", true), ...figures }}>{summaries}/{plans.length}</Text>
    </View>
    <View role="list" accessibilityLabel={wave === null ? "Plans without a recorded wave" : `Plans in wave ${wave}, ${summaries} of ${plans.length} with a summary`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {plans.map((plan) => <Tile key={plan.id} plan={plan} spend={spend.get(plan.id)} maxCost={maxCost} mode={mode} selected={selected === plan.id} flash={flash(plan.id)} onPress={() => onSelect(plan.id)} theme={theme} />)}
    </View>
  </View>;
}

const evidenceTone = (label: string): Tone => label === "Conflicting roadmap checkmarks" ? "warning" : /^(Roadmap checked|Plan file observed|Summary observed)$/.test(label) ? "success" : "neutral";

function PlanDetail({ plan, spend, usage, theme }: ThemeProps & { plan: Plan; spend: UsagePlan | undefined; usage: boolean }) {
  const span = spend?.first && spend.last ? (Date.parse(spend.last) - Date.parse(spend.first)) / 1000 : null;
  const omitted = plan.title?.includes("[omitted]") || plan.objective?.includes("[omitted]");
  return <View accessibilityLabel={`Plan ${plan.id} details`} style={{ gap: 10, padding: 16, borderRadius: 14, backgroundColor: surface(theme, 2) }}>
    <View style={{ gap: 4 }}>
      <Text style={kicker(theme)}>{[`Plan ${plan.id}`, plan.wave === null ? "wave not recorded" : `wave ${plan.wave}`].join(" · ")}</Text>
      <Text role="heading" style={text(theme, 16, "600", !plan.title)}>{plan.title ?? "Title not observed"}</Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{planEvidenceLabel(plan).map((label) => <Pill key={label} theme={theme} tone={evidenceTone(label)} label={label} />)}</View>
    <Text style={text(theme, 13, "400", !plan.objective)}>{plan.objective ?? "Objective not observed in the plan file."}</Text>
    {plan.summaryObserved && <View style={{ gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderColor: toneColor(theme, "success") }}>
      <Text style={kicker(theme)}>Summary, as recorded</Text>
      <Text style={text(theme, 13, "400", true)}>{plan.summaryExcerpt ?? (plan.summaryExcerptLimited ? "No safe summary introduction available." : "No introductory prose recorded before the next heading.")}</Text>
      {plan.summaryExcerptLimited && plan.summaryExcerpt && <Text style={smallStyle(theme)}>Some summary wording was withheld or shortened for safe display.</Text>}
    </View>}
    {omitted && <Text style={smallStyle(theme)}>Absolute paths and links are shown as [omitted].</Text>}
    {spend ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Stat theme={theme} size={20} label="Spent" value={money(spend.cost)} />
      <Stat theme={theme} size={20} label="Turns" value={integer(spend.turns)} />
      <Stat theme={theme} size={20} label="Agent time" value={duration(spend.durationS)} />
      <Stat theme={theme} size={20} label="Wall clock" value={span === null ? "—" : duration(span)} detail={`${clockTime(spend.first)} → ${clockTime(spend.last)}`} />
    </View> : usage ? <Text style={smallStyle(theme)}>No executor session names this plan's file yet.</Text> : null}
  </View>;
}

function PlanRow({ plan, theme, compact }: ThemeProps & { plan: Plan; compact: boolean }) {
  return <View role="listitem" style={{ flexDirection: compact ? "column" : "row", gap: compact ? 5 : 12, paddingVertical: 10, borderTopWidth: 1, borderColor: borderColor(theme) }}>
    <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : 90 }}><Text style={{ color: planColor(theme, planState(plan)) }}>{planGlyph(planState(plan))}</Text>  {plan.id}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <Text style={textStyle(theme, !plan.title)}>{plan.title ?? "Title not observed"}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {[plan.wave === null ? "Wave not recorded" : `Wave ${plan.wave}`, ...planEvidenceLabel(plan)].map((label) => <Badge key={label} label={label} theme={theme} attention={label === "Conflicting roadmap checkmarks"} />)}
      </View>
    </View>
  </View>;
}

function PhasePanel({ phase, view, onView, mode, onMode, usage, selected, flash, onSelect, theme, compact }: ThemeProps & { phase: Phase; view: "tiles" | "list"; onView(view: "tiles" | "list"): void; mode: Mode; onMode(mode: Mode): void; usage: UsageViewState; selected: Plan | null; flash(id: string): number | null; onSelect(id: string): void; compact: boolean }) {
  const { summaries, total } = phaseCounts(phase);
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  const spend = new Map((value?.plans ?? []).map((plan) => [plan.id, plan]));
  const maxCost = Math.max(0, ...phase.entries.map((plan) => spend.get(plan.id)?.cost ?? 0));
  const phaseSpend = value?.phases.find((entry) => entry.id === phase.id);
  return <Section theme={theme} overline={`Phase ${phase.id}${phase.current ? " · current" : ""}`} title={phase.title} gap={16}
    aside={<Text style={{ ...text(theme, 13, "600", true), ...figures }}>{total ? `${summaries} of ${plural(total, "plan")} with a summary · ${phase.entries.filter((entry) => entry.roadmapChecked === true).length} roadmap checked${phase.declaredPlans === null ? " · total not confirmed" : ""}` : "No plans declared yet"}{phaseSpend?.cost != null ? ` · ${money(phaseSpend.cost)} spent` : ""}</Text>}>
    <PhaseChecks phase={phase} theme={theme} compact={compact} />
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingBottom: 6 }}>
        <Text style={kicker(theme)}>Plans in this phase</Text>
        {phase.entries.length > 0 && <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {view === "tiles" && value && <Toggle<Mode> theme={theme} label="Color plans by" value={mode} onChange={onMode} options={[{ value: "status", label: "Status" }, { value: "spend", label: "Spend" }]} />}
          <Toggle<"tiles" | "list"> theme={theme} label="Show plans as" value={view} onChange={onView} options={[{ value: "tiles", label: "Tiles" }, { value: "list", label: "List" }]} />
        </View>}
      </View>
      {!phase.entries.length ? <Text style={text(theme, 13, "400", true)}>No plan files or roadmap plan entries observed for this phase.</Text>
        : view === "list" ? <View role="list" accessibilityLabel={`Plans for phase ${phase.id}`}>{phase.entries.map((plan) => <PlanRow key={plan.id} plan={plan} theme={theme} compact={compact} />)}</View>
        : <>
          {selected && <PlanDetail plan={selected} spend={spend.get(selected.id)} usage={!!value} theme={theme} />}
          <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 14 }}>{planWaves(phase).map((wave) => <WaveGroup key={wave.wave ?? "none"} wave={wave.wave} plans={wave.plans} spend={spend} maxCost={maxCost} mode={mode} selected={selected?.id ?? null} flash={flash} onSelect={onSelect} theme={theme} />)}</View>
        </>}
    </View>
  </Section>;
}

/** The caveats behind the plans tab. */
export const plansNotes = () => [
  "A summary file is observed evidence, not a verified completion.",
  "Roadmap checkmarks and observed summaries are separate facts; neither proves verification.",
  "Stages come from the files each stage leaves; an observed file is not a passed gate. A stage without its file before an observed one reads as skipped.",
  "A plan's spend counts the turns of the GSD executor whose prompt names that plan's PLAN.md file first (on Codex, the plan file it opens first); a phase's spend adds its other GSD agents on Claude Code. Codex records those agents' tasks encrypted, so there they are not placed in a phase.",
];

export function PlansView({ state, usage = createUsageState(), onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage?: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("status");
  const [picked, setPicked] = useState<{ workspaceId: string; phaseId: string; planId: string | null } | null>(null);
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const plans = state.snapshot?.overview?.plans;
  const mine = picked?.workspaceId === state.workspaceId ? picked : null;
  const phase = plans?.phases.find((entry) => entry.id === mine?.phaseId) ?? plans?.phases.find((entry) => entry.current) ?? plans?.phases[0];
  const selected = phase?.entries.find((entry) => mine?.phaseId === phase.id && entry.id === mine.planId) ?? defaultPlan(phase);
  const changes = state.changes;
  const flash = (id: string) => changes && Date.now() - changes.at < FLASH_MS && changes.tasks.includes(id) ? changes.at : null;
  return <BoardFrame title="Plans" description="The current milestone's phases, the stages each has left files for, and its plans wave by wave." subject="plans" state={state} onRefresh={onRefresh} theme={theme} compact={compact}
    alerts={[...plans?.limited ? ["Some plan or summary evidence could not be fully read; counts may be partial."] : [], ...usageAlerts(usage)]} notes={plansNotes()}>
    {plans?.availability === "available" ? <>
      <MilestoneBar plans={plans} theme={theme} />
      {plans.phases.length ? <>
        <PhasePicker label="Phases" selected={phase?.id ?? null} onSelect={(id) => setPicked({ workspaceId: state.workspaceId, phaseId: id, planId: null })} theme={theme} phases={plans.phases.map((entry) => {
          const { summaries, total } = phaseCounts(entry);
          const confirmed = entry.declaredPlans !== null;
          return { id: entry.id, current: entry.current, tone: confirmed && total > 0 && summaries >= total ? "success" : null, detail: `${summaries}/${total || "?"}${confirmed || !total ? "" : " · total TBD"}`, percent: total ? summaries / total * 100 : 0,
            description: `${entry.title}. ${summaries} of ${total || "no"} plans with a summary${confirmed || !total ? "" : "; the total is not confirmed"}.` };
        })} />
        {phase && <PhasePanel phase={phase} view={view} onView={setView} mode={mode} onMode={setMode} usage={usage} selected={selected} flash={flash} onSelect={(id) => setPicked({ workspaceId: state.workspaceId, phaseId: phase.id, planId: id })} theme={theme} compact={compact} />}
      </> : <Text style={textStyle(theme, true)}>No phases declared in this milestone.</Text>}
    </> : <Card title="Plans unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></Card>}
  </BoardFrame>;
}
