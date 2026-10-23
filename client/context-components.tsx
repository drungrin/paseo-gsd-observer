import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BoardContextPhase } from "../shared/context.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { BoardFrame, borderColor, Card, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { PhaseHeading, PhasePicker } from "./core-components.js";
import { Stat, surface, text, toneColor } from "./ui-kit.js";

/** One ID column per group, wide enough for its longest ID ("D-01..D-04", "D-12.1-01"), so the wording stays aligned. */
const decisionIdWidth = (group: BoardContextPhase["decisionGroups"][number]) => Math.min(150, Math.max(52, 9 * Math.max(...group.decisions.map((decision) => decision.id.length))));

function LineList({ lines, theme }: { lines: readonly string[]; theme: BoardTheme }) {
  return <View style={{ gap: 8 }}>{lines.map((line, index) => <View key={`${index}:${line.slice(0, 20)}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}>
    <Text style={textStyle(theme, true)}>•</Text><Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{line}</Text>
  </View>)}</View>;
}

function PhaseBriefing({ phase, theme, compact, sourceOpen, onToggleSource }: { phase: BoardContextPhase; theme: BoardTheme; compact: boolean; sourceOpen: boolean; onToggleSource(): void }) {
  if (phase.observation !== "observed") return <Card title={`Phase ${phase.id} · ${phase.title}`} source="CONTEXT.md" theme={theme} attention={phase.observation === "unavailable"}>
    <Text style={textStyle(theme, true)}>{phase.observation === "unavailable" ? "Context could not be read safely for this phase." : "No context observed for this phase."}</Text>
  </Card>;
  const shown = phase.decisionGroups.reduce((count, group) => count + group.decisions.length, 0);
  return <View style={{ gap: 16 }}>
    <PhaseHeading theme={theme} source="CONTEXT.md" id={phase.id} title={phase.title} facts={["Context observed", phase.gatheredAt ? `Gathered ${phase.gatheredAt}` : null, phase.recordedStatus ? `Document status: ${phase.recordedStatus}, as recorded when gathered (not live phase progress)` : null]} />
    {phase.amendmentsObserved && <Text role="alert" style={{ ...smallStyle(theme, false), color: toneColor(theme, "warning") }}>Later amendments are recorded; earlier decision excerpts may have been superseded. Review the source before relying on them.</Text>}
    {(JSON.stringify(phase).includes("[omitted]") || phase.excerptsLimited) && <View style={{ gap: 2 }}>
      {JSON.stringify(phase).includes("[omitted]") && <Text style={smallStyle(theme)}>Absolute paths and links are shown as [omitted].</Text>}
      {phase.excerptsLimited && <Text role="alert" style={smallStyle(theme)}>Some context sections could not be safely extracted or were shortened.</Text>}
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Stat theme={theme} label="Decisions" value={String(phase.decisionCount)} detail={`${shown} shown as excerpts`} />
      <Stat theme={theme} label="Discretion" value={String(phase.discretion.length)} detail="shown as excerpts" />
      <Stat theme={theme} label="Deferred ideas" value={String(phase.deferred.length)} detail="shown as excerpts" />
      <Stat theme={theme} label="Specific ideas" value={String(phase.specifics.length)} detail="shown as excerpts" />
    </View>
    <Card title="Phase boundary" theme={theme}>{phase.boundary.length ? phase.boundary.map((line, index) => <Text key={index} style={textStyle(theme)}>{line}</Text>) : <Text style={textStyle(theme, true)}>No safe boundary excerpt available.</Text>}</Card>
    <Card title={`Decisions · ${shown} of ${phase.decisionCount} excerpts`} theme={theme}>
      {phase.decisionGroups.filter((group) => group.decisions.length).length ? phase.decisionGroups.filter((group) => group.decisions.length).map((group) => <View key={group.title} style={{ gap: 9, paddingTop: 5 }}>
        <Text style={{ ...text(theme, 13, "700"), color: toneColor(theme, "accent") }}>{group.title}</Text>
        {group.decisions.map((decision, index) => <View key={`${index}:${decision.id}`} style={{ flexDirection: compact ? "column" : "row", gap: compact ? 3 : 12, paddingVertical: 6, borderTopWidth: 1, borderColor: borderColor(theme) }}>
          <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : decisionIdWidth(group) }}>{decision.id}</Text>
          <Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{decision.title && <Text style={{ fontWeight: "600" }}>{decision.title} </Text>}{decision.text}</Text>
        </View>)}
      </View>) : <Text style={textStyle(theme, true)}>No numbered decisions could be safely extracted.</Text>}
    </Card>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", gap: 16 }}>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", gap: 16 }}>
        {phase.discretion.length > 0 && <Card title="Implementation discretion" theme={theme}><LineList lines={phase.discretion} theme={theme} /></Card>}
        {phase.specifics.length > 0 && <Card title="Specific ideas" theme={theme}><LineList lines={phase.specifics} theme={theme} /></Card>}
      </View>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", gap: 16 }}>
        {phase.deferred.length > 0 && <Card title="Deferred ideas" theme={theme}><LineList lines={phase.deferred} theme={theme} /></Card>}
        {(phase.referencesObserved || phase.insights.length > 0) && <Card title="References and existing code insights" theme={theme}>
          {phase.referencesObserved && <Text style={textStyle(theme, true)}>Canonical references recorded; file locations are not included in these excerpts.</Text>}
          {phase.insights.map((section) => <View key={section.title} style={{ gap: 6 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text><LineList lines={section.lines} theme={theme} /></View>)}
        </Card>}
      </View>
    </View>
    <Card title="Document sections" theme={theme}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${sourceOpen ? "Hide" : "Show"} safe source excerpts for phase ${phase.id}`} accessibilityState={{ expanded: sourceOpen }} aria-expanded={sourceOpen} onPress={onToggleSource} style={{ minHeight: 36, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 14, borderRadius: 999, backgroundColor: surface(theme, 2) }}><Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>{sourceOpen ? "Hide excerpts" : "Show excerpts"}</Text></Pressable>
      {sourceOpen && <View style={{ gap: 12 }}>
        <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Selected safe excerpts in source order; not the full CONTEXT.md. Locations, commands, and unsafe or lengthy lines are withheld.</Text>
        {phase.sourceSections.filter((section) => section.lines.length).map((section) => <View key={section.title} style={{ gap: 6 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text>{section.lines.map((line, index) => <Text key={index} style={textStyle(theme)}>{line}</Text>)}</View>)}
        {!phase.sourceSections.some((section) => section.lines.length) && <Text style={textStyle(theme, true)}>No further safe source excerpts available.</Text>}
      </View>}
    </Card>
  </View>;
}

const contextSummary = (phase: BoardContextPhase) => phase.observation === "unavailable" ? "unreadable" : phase.observation === "not_observed" ? "no context" : phase.decisionCount ? plural(phase.decisionCount, "decision") : "observed";

/** The caveats behind the context tab. */
export const contextNotes = () => [
  "Recorded context decisions are not independent verification of implementation.",
  "The document status is what CONTEXT.md recorded when it was gathered, not live phase progress.",
];

export function ContextView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const [openSource, setOpenSource] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const context = state.snapshot?.overview?.context;
  const defaultId = context?.phases.find((phase) => phase.current)?.id ?? context?.phases[0]?.id;
  const selectedId = selection?.workspaceId === state.workspaceId && context?.phases.some((phase) => phase.id === selection.phaseId) ? selection.phaseId : defaultId;
  const selected = context?.phases.find((phase) => phase.id === selectedId);
  return <BoardFrame title="Context" description="What each phase decided before planning: its boundary, decisions, discretion and deferred ideas." subject="context" state={state} onRefresh={onRefresh} theme={theme} compact={compact}
    alerts={context?.limited ? ["Some context evidence or safe excerpts may be incomplete."] : []} notes={contextNotes()}>
    {context?.availability === "available" ? <>
      {context.phases.length > 0 ? <>
        <PhasePicker label="Context phases" selected={selectedId ?? null} onSelect={(id) => setSelection({ workspaceId: state.workspaceId, phaseId: id })} theme={theme} phases={context.phases.map((phase) => ({
          id: phase.id, current: phase.current, tone: phase.observation === "unavailable" || (phase.observation === "observed" && phase.amendmentsObserved) ? "warning" : null, detail: contextSummary(phase),
          description: phase.observation === "observed" ? `context observed${phase.amendmentsObserved ? ", later amendments recorded" : ""}` : phase.observation === "unavailable" ? "context unavailable" : "no context observed",
        }))} />
        {selected && <PhaseBriefing phase={selected} theme={theme} compact={compact} sourceOpen={openSource?.workspaceId === state.workspaceId && openSource.phaseId === selected.id} onToggleSource={() => setOpenSource(openSource?.workspaceId === state.workspaceId && openSource.phaseId === selected.id ? null : { workspaceId: state.workspaceId, phaseId: selected.id })} />}
      </> : <Text style={textStyle(theme, true)}>No current-milestone phases declared in the roadmap.</Text>}
    </> : <Card title="Context unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></Card>}
  </BoardFrame>;
}
