import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PathWarning } from "../shared/path.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { dateLabel } from "./overview-components.js";

/** Layout and wording shared by the GSD Path tabs. */

export type ThemeProps = { theme: BoardTheme };
export const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
export const smallStyle = (theme: BoardTheme, muted = true) => ({ ...textStyle(theme, muted), fontSize: 12, lineHeight: 18 });
export const borderColor = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A recorded token as words: "in-progress" reads "In progress", "pull-request" reads "Pull request". */
export const tokenLabel = (value: string | null, missing = "Not recorded") => value ? `${value[0].toUpperCase()}${value.slice(1).replace(/-/g, " ")}` : missing;

export function Card({ title, source, children, theme, attention = false }: ThemeProps & { title: string; source?: string; children: ReactNode; attention?: boolean }) {
  return <View style={{ minWidth: 0, padding: 20, gap: 16, borderRadius: 12, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <View style={{ gap: 4 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>
      {source && <Text style={{ ...textStyle(theme, true), fontSize: 11, letterSpacing: 0.3 }}>{source}</Text>}
    </View>
    {children}
  </View>;
}

export function Badge({ label, theme, attention = false }: ThemeProps & { label: string; attention?: boolean }) {
  return <Text style={{ color: attention ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : borderColor(theme) }}>{label}</Text>;
}

export function Count({ label, value, theme, attention = false }: ThemeProps & { label: string; value: number; attention?: boolean }) {
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 120, flexGrow: 1, padding: 12, gap: 3, borderRadius: 8, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Text style={smallStyle(theme)}>{label}</Text><Text style={{ ...textStyle(theme), fontWeight: "600", fontSize: 18 }}>{value}</Text>
  </View>;
}

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

/** Header, refresh control and freshness notices around one GSD Path tab. */
export function PathFrame({ title, description, subject, state, onRefresh, theme, compact, children }: ThemeProps & { title: string; description: string; subject: string; state: BoardViewState; onRefresh(): void; compact: boolean; children: ReactNode }) {
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, gap: 20, paddingBottom: 32 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ gap: 4, flex: 1, minWidth: 0 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>{title}</Text><Text style={textStyle(theme, true)}>{description}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? `Refreshing ${subject}` : `Refresh ${subject}`} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={{ ...textStyle(theme), fontWeight: "500" }}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading {subject}…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh {subject}. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Project files may have changed. Refresh to update {subject}.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      {children}
      <Text style={smallStyle(theme)}>Last refresh: {dateLabel(state.snapshot?.observedAt ?? null)}</Text>
    </>}
  </ScrollView>;
}

/** The setup notices every GSD Path tab shows instead of evidence. */
export function SetupNotice({ setup, theme }: ThemeProps & { setup: "not-started" | "unsupported" | "unavailable" }) {
  if (setup === "not-started") return <Card title="No milestone started" theme={theme}><Text style={textStyle(theme, true)}>GSD Path is installed in this workspace, but no milestone has written .project/STATE.md yet.</Text></Card>;
  if (setup === "unsupported") return <Card title="Unsupported GSD Path format" theme={theme} attention><Text style={textStyle(theme, true)}>The state file names a pipeline format this observer does not read. Nothing else is shown, so no field is guessed.</Text></Card>;
  return <Card title="Project evidence unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable GSD Path state was found for this workspace.</Text></Card>;
}
