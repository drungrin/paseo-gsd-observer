import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardDebug, DebugLocation, DebugNote, DebugSession, DebugStatusKind } from "../shared/debug.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

export type DebugStatusFilter = "attention" | "all" | "unresolved" | "open" | "diagnosed" | "awaiting-verification" | "blocked" | "resolved" | "reconciliation" | "unclassified";
export type DebugLocationFilter = "all" | DebugLocation;
type Selection = { workspaceId: string; status: DebugStatusFilter; location: DebugLocationFilter; expanded: readonly string[] };
const statusFilters: readonly DebugStatusFilter[] = ["attention", "all", "unresolved", "open", "diagnosed", "awaiting-verification", "blocked", "resolved", "reconciliation", "unclassified"];
const statusFilterLabels: Record<DebugStatusFilter, string> = { attention: "Needs attention", all: "All", unresolved: "Unresolved", open: "Open", diagnosed: "Diagnosed", "awaiting-verification": "Awaiting verification", blocked: "Blocked", resolved: "Resolved", reconciliation: "Needs reconciliation", unclassified: "Unclassified" };
const unresolvedKinds: ReadonlySet<DebugStatusKind> = new Set(["open", "diagnosed", "awaiting-verification", "blocked"]);
const locationFilters: readonly DebugLocationFilter[] = ["all", "active", "archived"];
const locationLabels: Record<DebugLocationFilter, string> = { all: "Any location", active: "Active directory", archived: "Resolved archive" };
const kindLabels: Record<DebugStatusKind, string> = { open: "Open", diagnosed: "Diagnosed", "awaiting-verification": "Awaiting human verification", blocked: "Blocked", resolved: "Resolved", other: "Unclassified status", unrecorded: "No recorded status" };
const goalLabels: Record<NonNullable<DebugSession["goal"]>, string> = { "diagnose-only": "Find root cause only (no fix)", "find-and-fix": "Find and fix" };
const colors = (theme: BoardTheme) => ({ border: theme.colors.border ?? theme.colors.foregroundMuted, surface: theme.colors.surface1 ?? theme.colors.surface0, warning: theme.colors.statusWarning ?? theme.colors.accent });
const body = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
const small = (theme: BoardTheme, muted = true) => ({ ...body(theme, muted), fontSize: 12, lineHeight: 18 });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const attentionKinds: ReadonlySet<DebugStatusKind> = new Set(["blocked", "awaiting-verification", "other", "unrecorded"]);

export const sessionName = (session: DebugSession) => session.title ?? session.slug ?? "Session name withheld";

export function matchingSessions(data: BoardDebug, status: DebugStatusFilter, location: DebugLocationFilter): DebugSession[] {
  return data.sessions.filter((session) => (location === "all" || session.location === location) && (
    status === "all" ? true
      : status === "attention" ? session.statusKind !== "resolved" || session.notes.length > 0
        : status === "unresolved" ? unresolvedKinds.has(session.statusKind)
        : status === "reconciliation" ? session.notes.length > 0
          : status === "unclassified" ? session.statusKind === "other" || session.statusKind === "unrecorded"
            : session.statusKind === status));
}

function noteText(note: DebugNote, session: DebugSession): string {
  if (note === "archived-unresolved") return session.statusKind === "unrecorded" ? "Moved to the resolved archive, but the file records no status." : "Moved to the resolved archive, but the recorded status is not resolved.";
  if (note === "resolved-not-archived") return "Recorded as resolved, but still in the active debug directory.";
  if (note === "resolution-status") return "A resolution section records a different status than the file's status line; reconcile before acting.";
  return "A file with the same name exists in the other location; neither record is preferred.";
}

function Card({ title, children, theme }: { title: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ minWidth: 0, padding: 16, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: colors(theme).border, backgroundColor: colors(theme).surface }}>
    <Text role="heading" style={{ ...body(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>
    {children}
  </View>;
}

function Fact({ label, value, theme, attention = false, lowerBound = false }: { label: string; value: number; theme: BoardTheme; attention?: boolean; lowerBound?: boolean }) {
  const shown = lowerBound ? `At least ${value}` : String(value);
  return <View accessible accessibilityLabel={`${label}: ${shown}`} style={{ flexBasis: 140, flexGrow: 1, padding: 12, gap: 3, borderRadius: 8, borderWidth: 1, borderColor: attention ? colors(theme).warning : colors(theme).border, backgroundColor: colors(theme).surface }}>
    <Text style={small(theme)}>{label}</Text><Text style={{ ...body(theme), fontWeight: "600", fontSize: 18 }}>{shown}</Text>
  </View>;
}

function FilterButton({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress(): void; theme: BoardTheme }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${label}`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: selected ? theme.colors.accent : colors(theme).border, backgroundColor: selected ? theme.colors.surface2 ?? theme.colors.surface0 : colors(theme).surface }}>
    <Text style={{ ...body(theme), fontWeight: selected ? "600" : "400" }}>{label}</Text>
  </Pressable>;
}

function Meta({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={small(theme)}><Text style={{ ...small(theme, false), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function Detail({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={body(theme, true)}><Text style={{ ...body(theme), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function Group({ title, children, theme }: { title: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ gap: 4 }}><Text role="heading" style={{ ...small(theme, false), fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</Text>{children}</View>;
}

/** Recorded wording only; nothing here re-runs, re-verifies or closes a session. */
export function SessionDetails({ session, theme }: { session: DebugSession; theme: BoardTheme }) {
  const dates = [session.createdAt && `Created ${session.createdAt}`, session.updatedAt && `Updated ${session.updatedAt}`, session.resolvedAt && `Resolved ${session.resolvedAt}`].filter(Boolean).join(" · ");
  const tallies = [
    session.evidenceCount !== null && plural(session.evidenceCount, "evidence entry", "evidence entries"),
    session.eliminatedCount !== null && plural(session.eliminatedCount, "eliminated hypothesis", "eliminated hypotheses"),
    session.filesChangedCount !== null && `${plural(session.filesChangedCount, "file")} listed as changed`,
  ].filter(Boolean).join(" · ");
  const symptoms = session.expected || session.actual;
  const focus = session.hypothesis || session.nextAction;
  const resolution = session.rootCause || session.fix || session.verification || session.verificationStructured;
  return <View style={{ gap: 10, paddingTop: 4 }}>
    {session.notes.map((note) => <Text key={note} role="alert" style={small(theme, false)}>{noteText(note, session)}</Text>)}
    <View style={{ gap: 2 }}>
      <Meta label="Session" value={session.title ? session.slug : null} theme={theme} />
      <Meta label="Goal" value={session.goal ? goalLabels[session.goal] : null} theme={theme} />
      <Meta label="Bug class" value={session.bugClass} theme={theme} />
      <Meta label="Related phase" value={session.phaseId} theme={theme} />
      {dates && <Text style={small(theme)}>{dates}</Text>}
    </View>
    <Detail label="Trigger" value={session.trigger} theme={theme} />
    {symptoms && <Group title="Symptoms" theme={theme}><Detail label="Expected" value={session.expected} theme={theme} /><Detail label="Observed" value={session.actual} theme={theme} /></Group>}
    {focus && <Group title="Focus, as last recorded" theme={theme}><Detail label="Hypothesis" value={session.hypothesis} theme={theme} /><Detail label="Next action" value={session.nextAction} theme={theme} /></Group>}
    {resolution && <Group title="Resolution, as recorded" theme={theme}>
      <Detail label="Root cause" value={session.rootCause} theme={theme} />
      <Detail label="Fix" value={session.fix} theme={theme} />
      <Detail label="Verification" value={session.verification} theme={theme} />
      {!session.verification && session.verificationStructured && <Text style={small(theme)}>Verification is recorded as a structured record; it is not summarized here.</Text>}
    </Group>}
    {tallies && <Text style={small(theme)}>{tallies}</Text>}
    {session.detailsWithheld && <Text style={small(theme)}>Details were withheld to keep the snapshot bounded.</Text>}
    {!session.detailsWithheld && !session.trigger && !symptoms && !focus && !resolution && <Text style={small(theme)}>No safe details were recorded for this session.</Text>}
    {session.excerptsLimited && <Text style={small(theme)}>Some wording was withheld or shortened for safe display.</Text>}
  </View>;
}

export function SessionRow({ session, expanded, onToggle, theme, compact }: { session: DebugSession; expanded: boolean; onToggle(): void; theme: BoardTheme; compact: boolean }) {
  const { border, surface, warning } = colors(theme);
  const name = sessionName(session);
  const reconcile = session.notes.length > 0;
  const attention = reconcile || attentionKinds.has(session.statusKind);
  const meta = [session.recordedStatus && `Recorded: ${session.recordedStatus}`, locationLabels[session.location], session.updatedAt && `Updated ${session.updatedAt}`].filter(Boolean).join(" · ");
  const recorded = session.recordedStatus ? ` Recorded: ${session.recordedStatus}.` : "";
  const label = `${name}. ${kindLabels[session.statusKind]}.${recorded} ${locationLabels[session.location]}.${reconcile ? " Needs reconciliation." : ""} ${expanded ? "Hide" : "Show"} details`;
  return <View style={{ minWidth: 0, borderRadius: 10, borderWidth: 1, borderColor: attention ? warning : border, backgroundColor: surface }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} {...(Platform.OS === "web" ? { "aria-expanded": expanded } : {})} onPress={onToggle}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text aria-hidden style={{ ...body(theme, true), width: 14 }}>{expanded ? "▾" : "▸"}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "flex-start" : "center", justifyContent: "space-between", gap: compact ? 3 : 10 }}>
          <Text style={{ ...body(theme), fontWeight: "600", flex: compact ? undefined : 1, minWidth: 0 }}>{name}</Text>
          <Text style={{ ...small(theme, !attention), fontWeight: "600" }}>{kindLabels[session.statusKind]}</Text>
        </View>
        <Text style={small(theme)}>{meta}</Text>
        {reconcile && <Text style={{ ...small(theme, false), fontWeight: "600" }}>Needs reconciliation</Text>}
      </View>
    </Pressable>
    {expanded && <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingLeft: compact ? 16 : 40 }}><SessionDetails session={session} theme={theme} /></View>}
  </View>;
}

export function DebugView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [selection, setSelection] = useState<Selection>({ workspaceId: state.workspaceId, status: "attention", location: "all", expanded: [] });
  const current = selection.workspaceId === state.workspaceId ? selection : { workspaceId: state.workspaceId, status: "attention" as const, location: "all" as const, expanded: [] };
  const set = (next: Partial<Selection>) => setSelection({ ...current, ...next });
  const toggle = (id: string) => set({ expanded: current.expanded.includes(id) ? current.expanded.filter((value) => value !== id) : [...current.expanded, id] });
  const data = state.snapshot?.overview?.debug;
  const listed = data ? matchingSessions(data, current.status, current.location) : [];
  const files = data ? data.counts.active + data.counts.archived : 0;
  // Unreadable files have no status, so every count below may be short.
  const lowerBound = !!data && (!data.countsComplete || data.counts.unavailable > 0);
  // Reader problems may name a whole directory, so unreadable counts are never presented as a number of sessions.
  const unreadable = data ? `${plural(data.counts.unavailable, "debug file or directory", "debug files or directories")} could not be read` : "";
  const unknownSessions = `${unreadable}, so sessions there may be missing and their status is unknown.`;
  const emptyMessage = !data ? "" : current.status === "attention" && current.location === "all"
    ? data.counts.unavailable ? `No readable session needs attention; ${unknownSessions}`
      : `No session needs attention: every readable session is recorded as resolved and placed consistently.${data.counts.resolved ? " Choose All to include resolved sessions." : ""}`
    : `No safe session rows match these filters.${data.counts.unavailable ? ` ${unknownSessions[0].toUpperCase()}${unknownSessions.slice(1)}` : ""}`;
  const { border, surface } = colors(theme);
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 16 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...body(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Debug</Text>
        <Text style={body(theme, true)}>GSD debug sessions in the active debug directory and its resolved archive. Read-only; statuses are as recorded in each file, not re-verified.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing debug sessions" : "Refresh debug sessions"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh}
        style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: border, backgroundColor: surface }}><Text style={body(theme)}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={body(theme, true)}>Loading debug sessions…</Text> : <>
      {state.error && <Text role="alert" style={body(theme)}>Could not refresh debug sessions. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={body(theme, true)}>Planning files may have changed. Refresh to update debug sessions.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={body(theme, true)}>{state.refreshAnnouncement}</Text>}
      {data?.availability === "available" ? <>
        {data.limited && <Text role="alert" style={small(theme)}>The debug inventory or its safe excerpts are incomplete; counts cover only observed files.</Text>}
        {data.counts.displayed > 0 ? <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Fact label="Unresolved" value={data.counts.unresolved} theme={theme} lowerBound={lowerBound} />
            <Fact label="Awaiting verification" value={data.counts.awaitingVerification} theme={theme} lowerBound={lowerBound} attention={data.counts.awaitingVerification > 0} />
            <Fact label="Blocked" value={data.counts.blocked} theme={theme} lowerBound={lowerBound} attention={data.counts.blocked > 0} />
            <Fact label="Unclassified" value={data.counts.unclassified} theme={theme} lowerBound={lowerBound} attention={data.counts.unclassified > 0} />
            <Fact label="Resolved" value={data.counts.resolved} theme={theme} lowerBound={lowerBound} />
            <Fact label="Needs reconciliation" value={data.counts.reconciliation} theme={theme} lowerBound={lowerBound} attention={data.counts.reconciliation > 0} />
          </View>
          <Text style={small(theme)}>{data.countsComplete ? "" : "At least "}{plural(files, "session file")} found ({data.counts.active} active, {data.counts.archived} archived) · {plural(data.counts.displayed, "safe row")} shown. Recorded statuses, not live checks.</Text>
          {data.counts.unavailable > 0 && <Text role="alert" style={small(theme, false)}>{unknownSessions[0].toUpperCase()}{unknownSessions.slice(1)}</Text>}
          {(data.counts.knowledgeBase > 0 || data.counts.notes > 0 || (data.archiveState === "absent" && data.directoryState === "observed")) && <Text style={small(theme)}>{[
            data.counts.knowledgeBase > 0 ? "The debug knowledge base is not a session and is not listed." : null,
            data.counts.notes > 0 ? `${plural(data.counts.notes, "other Markdown note")} in the debug directories ${data.counts.notes === 1 ? "is not a session and is" : "are not sessions and are"} not listed.` : null,
            data.archiveState === "absent" && data.directoryState === "observed" ? "No resolved archive directory was observed." : null,
          ].filter(Boolean).join(" ")}</Text>}
          <View style={{ gap: 7 }}><Text role="heading" style={{ ...body(theme), fontWeight: "600" }}>Recorded status</Text>
            <Text style={small(theme)}>Needs attention: not recorded as resolved, or recorded in a way that needs reconciliation.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {statusFilters.map((value) => <FilterButton key={value} label={statusFilterLabels[value]} selected={current.status === value} onPress={() => set({ status: value })} theme={theme} />)}
            </View>
          </View>
          <View style={{ gap: 7 }}><Text role="heading" style={{ ...body(theme), fontWeight: "600" }}>Location</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {locationFilters.map((value) => <FilterButton key={value} label={locationLabels[value]} selected={current.location === value} onPress={() => set({ location: value })} theme={theme} />)}
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <Text style={small(theme)}>{plural(listed.length, "session")} {listed.length === 1 ? "matches" : "match"} the current filters{data.counts.displayed < files ? "; some files have no safe row" : ""}.</Text>
            {listed.length ? listed.map((session) => <SessionRow key={session.id} session={session} expanded={current.expanded.includes(session.id)} onToggle={() => toggle(session.id)} theme={theme} compact={compact} />)
              : <Card title="No matching sessions" theme={theme}><Text style={body(theme, true)}>{emptyMessage}</Text></Card>}
          </View>
        </> : <Card title={data.counts.unavailable ? "Debug inventory incomplete" : data.directoryState === "absent" ? "No debug directory" : "No debug sessions"} theme={theme}>
          <Text style={body(theme, true)}>{data.counts.unavailable ? `${plural(data.counts.unavailable, "debug file or directory", "debug files or directories")} could not be safely read; no sessions are shown.`
            : data.directoryState === "absent" ? "No .planning/debug directory was observed for this workspace. Debug sessions are created by /gsd-debug."
              : data.directoryState === "observed" ? ["The observed debug directory has no session files.",
                data.counts.knowledgeBase > 0 ? "Its knowledge base is not a session." : null,
                data.counts.notes > 0 ? `${plural(data.counts.notes, "other Markdown note")} ${data.counts.notes === 1 ? "is not a session" : "are not sessions"}.` : null].filter(Boolean).join(" ")
                : "No debug files were observed; the directory state is unknown."}</Text>
        </Card>}
      </> : <Card title="Debug sessions unavailable" theme={theme}><Text style={body(theme, true)}>No readable planning inventory was found for this workspace.</Text></Card>}
    </>}
  </ScrollView>;
}
