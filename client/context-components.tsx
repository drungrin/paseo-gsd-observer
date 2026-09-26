import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardContextPhase } from "../shared/context.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });

function ContextCard({ title, children, theme }: { title: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ minWidth: 0, padding: 16, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>
    {children}
  </View>;
}

function LineList({ lines, theme }: { lines: readonly string[]; theme: BoardTheme }) {
  return <View style={{ gap: 8 }}>{lines.map((line, index) => <View key={`${index}:${line.slice(0, 20)}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}>
    <Text style={textStyle(theme, true)}>•</Text><Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{line}</Text>
  </View>)}</View>;
}

function PhaseBriefing({ phase, theme, compact, sourceOpen, onToggleSource }: { phase: BoardContextPhase; theme: BoardTheme; compact: boolean; sourceOpen: boolean; onToggleSource(): void }) {
  if (phase.observation !== "observed") return <ContextCard title={`Phase ${phase.id} · ${phase.title}`} theme={theme}>
    <Text style={textStyle(theme, true)}>{phase.observation === "unavailable" ? "Context could not be read safely for this phase." : "No context observed for this phase."}</Text>
  </ContextCard>;
  const shown = phase.decisionGroups.reduce((count, group) => count + group.decisions.length, 0);
  return <View style={{ gap: 16 }}>
    <View style={{ gap: 5 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 19, lineHeight: 25, fontWeight: "600" }}>Phase {phase.id} · {phase.title}</Text>
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Context observed{phase.gatheredAt ? ` · Gathered ${phase.gatheredAt}` : ""}{phase.decisionCount ? ` · ${phase.decisionCount} numbered decisions recorded` : ""}</Text>
      {phase.recordedStatus && <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Document status: {phase.recordedStatus} (recorded when gathered; not live phase progress).</Text>}
      {phase.amendmentsObserved && <Text role="alert" style={{ ...textStyle(theme, true), fontSize: 12 }}>Later amendments are recorded; earlier decision excerpts may have been superseded. Review the source before relying on them.</Text>}
      {JSON.stringify(phase).includes("[omitted]") && <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Location-like text is shown as [omitted].</Text>}
      {phase.excerptsLimited && <Text role="alert" style={{ ...textStyle(theme, true), fontSize: 12 }}>Some context sections could not be safely extracted or were shortened.</Text>}
    </View>
    <ContextCard title="Phase boundary" theme={theme}>{phase.boundary.length ? phase.boundary.map((line, index) => <Text key={index} style={textStyle(theme)}>{line}</Text>) : <Text style={textStyle(theme, true)}>No safe boundary excerpt available.</Text>}</ContextCard>
    <ContextCard title={`Decisions · ${shown} of ${phase.decisionCount} excerpts`} theme={theme}>
      {phase.decisionGroups.filter((group) => group.decisions.length).length ? phase.decisionGroups.filter((group) => group.decisions.length).map((group) => <View key={group.title} style={{ gap: 9, paddingTop: 5 }}>
        <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{group.title}</Text>
        {group.decisions.map((decision) => <View key={decision.id} style={{ flexDirection: compact ? "column" : "row", gap: compact ? 3 : 12, paddingVertical: 6, borderTopWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
          <Text style={{ ...textStyle(theme), fontWeight: "600", width: compact ? undefined : 52 }}>{decision.id}</Text><Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{decision.text}</Text>
        </View>)}
      </View>) : <Text style={textStyle(theme, true)}>No numbered decisions could be safely extracted.</Text>}
      <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Recorded context decisions are not independent verification of implementation.</Text>
    </ContextCard>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", gap: 16 }}>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", gap: 16 }}>
        {phase.discretion.length > 0 && <ContextCard title="Implementation discretion" theme={theme}><LineList lines={phase.discretion} theme={theme} /></ContextCard>}
        {phase.specifics.length > 0 && <ContextCard title="Specific ideas" theme={theme}><LineList lines={phase.specifics} theme={theme} /></ContextCard>}
      </View>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", gap: 16 }}>
        {phase.deferred.length > 0 && <ContextCard title="Deferred ideas" theme={theme}><LineList lines={phase.deferred} theme={theme} /></ContextCard>}
        {(phase.referencesObserved || phase.insights.length > 0) && <ContextCard title="References and existing code insights" theme={theme}>
          {phase.referencesObserved && <Text style={textStyle(theme, true)}>Canonical references recorded; file locations are not included in these excerpts.</Text>}
          {phase.insights.map((section) => <View key={section.title} style={{ gap: 6 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text><LineList lines={section.lines} theme={theme} /></View>)}
        </ContextCard>}
      </View>
    </View>
    <ContextCard title="Document sections" theme={theme}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${sourceOpen ? "Hide" : "Show"} safe source excerpts for phase ${phase.id}`} accessibilityState={{ expanded: sourceOpen }} aria-expanded={sourceOpen} onPress={onToggleSource} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}><Text style={textStyle(theme)}>{sourceOpen ? "Hide excerpts" : "Show excerpts"}</Text></Pressable>
      {sourceOpen && <View style={{ gap: 12 }}>
        <Text style={{ ...textStyle(theme, true), fontSize: 12 }}>Selected safe excerpts in source order; not the full CONTEXT.md. Locations, commands, and unsafe or lengthy lines are withheld.</Text>
        {phase.sourceSections.filter((section) => section.lines.length).map((section) => <View key={section.title} style={{ gap: 6 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text>{section.lines.map((line, index) => <Text key={index} style={textStyle(theme)}>{line}</Text>)}</View>)}
        {!phase.sourceSections.some((section) => section.lines.length) && <Text style={textStyle(theme, true)}>No further safe source excerpts available.</Text>}
      </View>}
    </ContextCard>
  </View>;
}

export function ContextView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const [openSource, setOpenSource] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const context = state.snapshot?.overview?.context;
  const defaultId = context?.phases.find((phase) => phase.current)?.id ?? context?.phases[0]?.id;
  const selectedId = selection?.workspaceId === state.workspaceId && context?.phases.some((phase) => phase.id === selection.phaseId) ? selection.phaseId : defaultId;
  const selected = context?.phases.find((phase) => phase.id === selectedId);
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 18 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Context</Text><Text style={textStyle(theme, true)}>Current-milestone phase decisions and source excerpts.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing context" : "Refresh context"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={textStyle(theme)}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading context…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh context. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Planning files may have changed. Refresh to update context.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      {context?.availability === "available" ? <>
        {context.limited && <Text role="alert" style={{ ...textStyle(theme, true), fontSize: 12 }}>Some context evidence or safe excerpts may be incomplete.</Text>}
        {context.phases.length > 0 ? <>
          <View accessibilityLabel="Context phases" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {context.phases.map((phase) => <Pressable key={phase.id} accessibilityRole="button" accessibilityLabel={`Phase ${phase.id}${phase.current ? ", current" : ""}: ${phase.observation === "observed" ? "context observed" : phase.observation === "unavailable" ? "context unavailable" : "no context observed"}`} accessibilityState={{ selected: phase.id === selectedId }} {...(Platform.OS === "web" ? { "aria-pressed": phase.id === selectedId } : {})} onPress={() => setSelection({ workspaceId: state.workspaceId, phaseId: phase.id })} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 7, borderWidth: 1, borderColor: phase.id === selectedId ? theme.colors.accent : theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: phase.id === selectedId ? theme.colors.surface2 ?? theme.colors.surface0 : theme.colors.surface1 ?? theme.colors.surface0 }}>
              <Text style={{ ...textStyle(theme), fontWeight: phase.id === selectedId ? "600" : "400" }}>Phase {phase.id}{phase.current ? " · Current" : ""}</Text>
            </Pressable>)}
          </View>
          {selected && <PhaseBriefing phase={selected} theme={theme} compact={compact} sourceOpen={openSource?.workspaceId === state.workspaceId && openSource.phaseId === selected.id} onToggleSource={() => setOpenSource(openSource?.workspaceId === state.workspaceId && openSource.phaseId === selected.id ? null : { workspaceId: state.workspaceId, phaseId: selected.id })} />}
        </> : <Text style={textStyle(theme, true)}>No current-milestone phases declared in the roadmap.</Text>}
      </> : <ContextCard title="Context unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></ContextCard>}
    </>}
  </ScrollView>;
}
