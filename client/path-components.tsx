import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardPath, PathWarning } from "../shared/path.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { dateLabel } from "./overview-components.js";
import { Disclosure, FadeIn, figures, kicker, Pulse, RelativeTime, SegmentBar, surface, tint, toneColor, type Tone } from "./ui-kit.js";

/** Layout and wording shared by the GSD Path tabs. */

export type ThemeProps = { theme: BoardTheme };
export const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
export const smallStyle = (theme: BoardTheme, muted = true) => ({ ...textStyle(theme, muted), fontSize: 12, lineHeight: 18 });
export const borderColor = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A recorded token as words: "in-progress" reads "In progress", "pull-request" reads "Pull request". */
export const tokenLabel = (value: string | null, missing = "Not recorded") => value ? `${value[0].toUpperCase()}${value.slice(1).replace(/-/g, " ")}` : missing;

/** A task status's tone. In progress is not the accent: Paseo's accent and success are both green in its default theme. */
export const statusTone = (status: string | null): Tone => status === "done" ? "success" : status === "failed" || status === "blocked" ? "danger" : "neutral";
/** Done in the success color, failed or blocked in danger, in progress in the bright foreground, pending faint. */
export const statusColor = (theme: BoardTheme, status: string | null) => status === "in-progress" ? theme.colors.foreground : statusTone(status) === "neutral" ? tint(theme, theme.colors.foregroundMuted, 0.35) : toneColor(theme, statusTone(status));
export const statusGlyph = (status: string | null) => status === "done" ? "✓" : status === "in-progress" ? "●" : status === "failed" || status === "blocked" ? "✕" : "○";

/** The milestone's tasks as one bar: done, in progress, failed or blocked, then pending. */
export function TaskBar({ path, theme, height = 12 }: ThemeProps & { path: BoardPath; height?: number }) {
  const { done, inProgress, pending, failed, blocked, other } = path.tasks.counts;
  return <SegmentBar theme={theme} height={height} label={`${done} done, ${inProgress} in progress, ${failed + blocked} failed or blocked, ${pending + other} pending`} segments={[
    { label: "done", value: done, color: statusColor(theme, "done") },
    { label: "in progress", value: inProgress, color: statusColor(theme, "in-progress") },
    { label: "failed or blocked", value: failed + blocked, color: statusColor(theme, "failed") },
    { label: "pending", value: pending + other, color: statusColor(theme, "pending") },
  ]} />;
}

/** The legend under a task bar; in progress and failed appear only when some task is. */
export function taskLegend(theme: BoardTheme, path: BoardPath) {
  const { done, inProgress, pending, failed, blocked, other } = path.tasks.counts;
  return [
    { color: statusColor(theme, "done"), label: `${done} done` },
    ...(inProgress ? [{ color: statusColor(theme, "in-progress"), label: `${inProgress} in progress` }] : []),
    ...(failed + blocked ? [{ color: statusColor(theme, "failed"), label: `${failed + blocked} failed or blocked` }] : []),
    { color: statusColor(theme, "pending"), label: `${pending + other} pending` },
  ];
}

export function Card({ title, source, children, theme, attention = false }: ThemeProps & { title: string; source?: string; children: ReactNode; attention?: boolean }) {
  const warning = toneColor(theme, "warning");
  return <View style={{ minWidth: 0, padding: 20, gap: 14, borderRadius: 16, overflow: "hidden", backgroundColor: attention ? tint(theme, warning, 0.09) : surface(theme) }}>
    {attention && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: warning }} />}
    <View style={{ gap: 2 }}>
      {source && <Text style={{ ...kicker(theme), textTransform: "none", letterSpacing: 0.2 }}>{source}</Text>}
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>
    </View>
    {children}
  </View>;
}

export function Badge({ label, theme, attention = false }: ThemeProps & { label: string; attention?: boolean }) {
  const color = attention ? toneColor(theme, "warning") : theme.colors.foregroundMuted;
  return <Text style={{ color, fontSize: 12, fontWeight: "500", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: "hidden", backgroundColor: attention ? tint(theme, color, 0.13) : surface(theme, 2) }}>{label}</Text>;
}

export function Count({ label, value, theme, attention = false }: ThemeProps & { label: string; value: number; attention?: boolean }) {
  const warn = attention && value > 0;
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 120, flexGrow: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 2, borderRadius: 12, backgroundColor: warn ? tint(theme, toneColor(theme, "warning"), 0.12) : surface(theme, 2) }}>
    <Text style={kicker(theme)}>{label}</Text>
    <Text style={{ ...textStyle(theme), ...figures, fontWeight: "700", fontSize: 22, lineHeight: 28, color: warn ? toneColor(theme, "warning") : theme.colors.foreground }}>{value}</Text>
  </View>;
}

/** The warnings a tab qualifies its evidence with, in the board's words; `evidence-limited` concerns every tab. */
export const warningAlerts = (path: BoardPath | undefined, belongs: (warning: PathWarning) => boolean) =>
  (path?.warnings ?? []).filter((warning) => warning === "evidence-limited" || belongs(warning)).map((warning) => PATH_WARNING_COPY[warning]);

export const PATH_WARNING_COPY: Record<PathWarning, string> = {
  "state-unavailable": "The state file could not be read.",
  "state-malformed": "The state file has no readable GSD Path frontmatter.",
  "log-unavailable": "The state file has no readable Log section; the phase history is not shown.",
  "roadmap-unavailable": "The roadmap could not be read.",
  "roadmap-malformed": "Some roadmap milestone entries are ambiguous and were left out.",
  "milestone-not-in-roadmap": "The milestone recorded in the state file is not listed in the roadmap.",
  "plan-unavailable": "The plan could not be read; waves come from the task files only.",
  "plan-malformed": "The plan has ambiguous wave sections; repeated waves were left out.",
  "tasks-unavailable": "Some task files could not be read safely.",
  "task-malformed": "Some task files have no readable frontmatter and are not shown.",
  "task-id-conflict": "Some task files record an id that differs from their file name; the file name is shown.",
  "task-duplicate": "More than one task file uses the same task id.",
  "next-unavailable": "The next milestone's state file could not be read.",
  "reviews-unavailable": "Some review files could not be read safely.",
  "reviews-malformed": "Some review files could not be parsed and are not shown.",
  "questions-unavailable": "The discussion answers file could not be read.",
  "questions-malformed": "Some discussion answers could not be shown safely.",
  "evidence-limited": "Only part of the project evidence could be read within the safe limits.",
};

/** Whether the panel is following the files: live, catching up with a change, not watching, or out of date. */
export function liveStatus(state: BoardViewState): { tone: Tone; label: string; live: boolean } {
  const snapshot = state.snapshot;
  if (state.statusFailed) return { tone: "warning", label: "Cannot reach the plugin · retrying", live: false };
  if (state.error || snapshot?.freshness === "refresh-failed") return { tone: "danger", label: "Out of date", live: false };
  if (snapshot?.freshness === "stale" || state.busy) return { tone: "warning", label: "Files changed · updating", live: true };
  if (snapshot?.warnings.includes("observation-limited")) return { tone: "warning", label: "Not following changes · refresh to update", live: false };
  return { tone: "success", label: "Live · last read ", live: true };
}

function LiveChip({ state, theme }: ThemeProps & { state: BoardViewState }) {
  const status = liveStatus(state);
  const color = toneColor(theme, status.tone);
  const style = { ...textStyle(theme), fontSize: 12, lineHeight: 16, fontWeight: "500" as const, color };
  // Not a live region: the relative time changes every minute. The change banner is what gets announced.
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2, minHeight: 28, paddingLeft: status.live ? 0 : 10, paddingRight: 12, borderRadius: 999, backgroundColor: tint(theme, color, 0.12) }}>
    {status.live ? <Pulse color={color} size={7} /> : <View style={{ width: 8, height: 8, marginRight: 6, borderRadius: 4, backgroundColor: color }} />}
    {status.tone === "success" ? <RelativeTime theme={theme} value={state.snapshot?.observedAt} prefix={status.label} style={style} /> : <Text style={style}>{status.label}</Text>}
  </View>;
}

/** How long "Just changed" stays up after an automatic refresh. */
const CHANGE_BANNER_MS = 8_000;

function ChangeBanner({ state, theme }: ThemeProps & { state: BoardViewState }) {
  const changes = state.changes;
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!changes) return;
    const timer = setTimeout(() => setHiddenAt(changes.at), Math.max(0, changes.at + CHANGE_BANNER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [changes]);
  if (!changes || hiddenAt === changes.at || Date.now() - changes.at > CHANGE_BANNER_MS) return null;
  const accent = toneColor(theme, "accent");
  return <FadeIn><View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: tint(theme, accent, 0.14) }}>
    <Pulse color={accent} size={6} />
    <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>Just changed: {changes.summary.slice(0, 4).join(" · ")}{changes.summary.length > 4 ? ` · ${changes.summary.length - 4} more` : ""}</Text>
  </View></FadeIn>;
}

/**
 * Header, live status, refresh control and the notes around one GSD Path tab. `alerts` qualify what the tab shows (partial reads,
 * evidence left out) and stay visible; `notes` explain how to read it and are folded under "About these figures".
 */
export function PathFrame({ title, description, subject, state, onRefresh, theme, compact, alerts = [], notes = [], children }: ThemeProps & { title: string; description: string; subject: string; state: BoardViewState; onRefresh(): void; compact: boolean; alerts?: readonly string[]; notes?: readonly string[]; children: ReactNode }) {
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 28, gap: 18, paddingBottom: 40 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 12 }}>
      <View style={{ gap: 2, flex: 1, minWidth: 0 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 22, lineHeight: 28, fontWeight: "700" }}>{title}</Text><Text style={{ ...textStyle(theme, true), fontSize: 13 }}>{description}</Text></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <LiveChip state={state} theme={theme} />
        <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? `Refreshing ${subject}` : `Refresh ${subject}`} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, backgroundColor: surface(theme, 2) }}><Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
      </View>
    </View>
    <ChangeBanner state={state} theme={theme} />
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading {subject}…</Text> : <>
      {state.error && <Text role="alert" style={{ ...textStyle(theme), color: toneColor(theme, "danger") }}>Could not refresh {subject}. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={smallStyle(theme)}>{state.refreshAnnouncement}</Text>}
      {alerts.length > 0 && <View style={{ gap: 4 }}>{alerts.map((alert) => <View key={alert} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ width: 6, height: 6, marginTop: 7, borderRadius: 3, backgroundColor: toneColor(theme, "warning") }} />
        <Text style={{ ...smallStyle(theme, false), fontSize: 13, lineHeight: 20, flex: 1 }}>{alert}</Text>
      </View>)}</View>}
      {children}
      <Disclosure title="About these figures" notes={[...notes, `Last read ${dateLabel(state.snapshot?.observedAt ?? null)}. The panel reads the project files again when they change.`]} theme={theme} />
    </>}
  </ScrollView>;
}

/** The setup notices every GSD Path tab shows instead of evidence. */
export function SetupNotice({ setup, theme }: ThemeProps & { setup: "not-started" | "unsupported" | "unavailable" }) {
  if (setup === "not-started") return <Card title="No milestone started" theme={theme}><Text style={textStyle(theme, true)}>GSD Path is installed in this workspace, but no milestone has written .project/STATE.md yet.</Text></Card>;
  if (setup === "unsupported") return <Card title="Unsupported GSD Path format" theme={theme} attention><Text style={textStyle(theme, true)}>The state file names a pipeline format this observer does not read. Nothing else is shown, so no field is guessed.</Text></Card>;
  return <Card title="Project evidence unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable GSD Path state was found for this workspace.</Text></Card>;
}

export type TableColumn = { label: string; width: number; numeric?: boolean };

/** A scrollable data table: one row header, then cells; numeric columns align right in tabular figures. */
export function DataTable({ label, columns, rows, theme }: ThemeProps & { label: string; columns: readonly TableColumn[]; rows: readonly (readonly string[])[] }) {
  const cell = (column: TableColumn, header = false) => ({ ...smallStyle(theme, header), fontSize: header ? 12 : 13, fontWeight: header ? "600" as const : "400" as const, width: column.width, paddingHorizontal: 6, textAlign: column.numeric ? "right" as const : "left" as const, fontVariant: column.numeric ? ["tabular-nums" as const] : undefined });
  return <ScrollView horizontal nestedScrollEnabled style={{ flexGrow: 0 }}>
    <View role="table" accessibilityLabel={label} style={{ minWidth: columns.reduce((total, column) => total + column.width, 0) }}>
      <View role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: borderColor(theme) }}>
        {columns.map((column) => <Text key={column.label} role="columnheader" style={cell(column, true)}>{column.label}</Text>)}
      </View>
      {rows.map((row, index) => <View key={index} role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: borderColor(theme) }}>
        {row.map((value, column) => <Text key={column} role={column === 0 ? "rowheader" : "cell"} style={{ ...cell(columns[column]), color: theme.colors.foreground }}>{value}</Text>)}
      </View>)}
    </View>
  </ScrollView>;
}
