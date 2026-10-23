import { Text } from "react-native";
import type { BoardPath, PathWarning } from "../shared/path.js";
import type { BoardTheme } from "./board-components.js";
import { Card, textStyle, type ThemeProps } from "./board-frame.js";
import { SegmentBar, tint, toneColor, type Tone } from "./ui-kit.js";

/** Statuses, warnings and notices of the GSD Path tabs. */

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

/** The setup notices every GSD Path tab shows instead of evidence. */
export function SetupNotice({ setup, theme }: ThemeProps & { setup: "not-started" | "unsupported" | "unavailable" }) {
  if (setup === "not-started") return <Card title="No milestone started" theme={theme}><Text style={textStyle(theme, true)}>GSD Path is installed in this workspace, but no milestone has written .project/STATE.md yet.</Text></Card>;
  if (setup === "unsupported") return <Card title="Unsupported GSD Path format" theme={theme} attention><Text style={textStyle(theme, true)}>The state file names a pipeline format this observer does not read. Nothing else is shown, so no field is guessed.</Text></Card>;
  return <Card title="Project evidence unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable GSD Path state was found for this workspace.</Text></Card>;
}

