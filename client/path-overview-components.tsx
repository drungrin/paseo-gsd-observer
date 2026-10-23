import { Text, View } from "react-native";
import type { BoardPath } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import { ProgressMeter } from "./overview-components.js";
import { borderColor, Card, Count, PATH_WARNING_COPY, PathFrame, plural, SetupNotice, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./path-components.js";
import { UsageCard } from "./path-usage-components.js";
import type { UsageViewState } from "./usage-controller.js";

function Field({ label, value, detail, theme }: ThemeProps & { label: string; value: string; detail?: string | null }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
    <Text style={{ ...textStyle(theme, true), width: 96 }}>{label}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ ...textStyle(theme), fontWeight: "500" }}>{value}</Text>{detail && <Text style={{ ...textStyle(theme, true), fontSize: 13 }}>{detail}</Text>}</View>
  </View>;
}

function StateCard({ path, theme }: ThemeProps & { path: BoardPath }) {
  const { state, roadmap } = path;
  if (state.availability !== "available") return <Card title="State" source=".project/STATE.md" theme={theme}><Text style={textStyle(theme)}>State unavailable</Text><Text style={textStyle(theme, true)}>No readable pipeline state was found. Tasks and the roadmap can still be shown independently.</Text></Card>;
  const milestone = roadmap.milestones.find((entry) => entry.current);
  const event = state.lastEvent;
  return <Card title="State" source=".project/STATE.md" theme={theme}>
    <View style={{ gap: 14 }}>
      <Field label="Project" value={state.project ?? "Not recorded"} theme={theme} />
      <Field label="Milestone" value={state.milestone ?? "Not recorded"} detail={milestone ? `${milestone.id} in the roadmap` : null} theme={theme} />
      <Field label="Phase" value={tokenLabel(state.phase)} detail={`Status: ${tokenLabel(state.status)}`} theme={theme} />
      <Field label="Integration" value={tokenLabel(state.integration)} detail={state.integrationDefault && state.integrationDefault !== state.integration ? `Project default: ${tokenLabel(state.integrationDefault)}` : null} theme={theme} />
      <Field label="Branch" value={state.branch ?? "Not bound"} detail={state.defaultBranch ? `Ships onto ${state.defaultBranch}` : null} theme={theme} />
    </View>
    {state.shipped && <Text role="alert" style={textStyle(theme)}>Recorded as shipped. Integration is not verified by this observer.</Text>}
    {state.status === "blocked" && <Text role="alert" style={textStyle(theme)}>The pipeline is recorded as blocked.</Text>}
    <View style={{ gap: 7, paddingTop: 16, borderTopWidth: 1, borderColor: borderColor(theme) }}>
      <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "600" }}>Latest log entry</Text>
      {event ? <>
        <Text style={smallStyle(theme)}>{event.date}{event.phase ? ` · ${tokenLabel(event.phase)}` : ""}</Text>
        <Text style={textStyle(theme, true)}>{event.text ?? "This entry has no safely displayable wording."}</Text>
        {event.text && event.shortened && <Text style={smallStyle(theme)}>Some wording was shortened or withheld for safe display.</Text>}
      </> : <Text style={textStyle(theme, true)}>No log entries recorded.</Text>}
    </View>
    <Text style={smallStyle(theme)}>Recorded pipeline state, not verified by the GSD Path runtime.</Text>
  </Card>;
}

function TimelineCard({ path, theme }: ThemeProps & { path: BoardPath }) {
  const { timeline } = path;
  return <Card title="Phase history" source=".project/STATE.md log" theme={theme}>
    {timeline.availability === "available" ? <>
      {timeline.entries.length ? <View role="list" accessibilityLabel="Phases entered in this milestone" style={{ gap: 4 }}>
        {timeline.entries.map((entry) => <View key={entry.phase} role="listitem" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: entry.current ? theme.colors.accent : "transparent", backgroundColor: entry.current ? theme.colors.surface2 ?? theme.colors.surface0 : "transparent" }}>
          <Text style={{ ...textStyle(theme), fontWeight: entry.current ? "600" : "400" }}>{tokenLabel(entry.phase)}{entry.current ? " · Current" : ""}</Text>
          <Text style={smallStyle(theme)}>{entry.since === entry.latest ? entry.since : `${entry.since} – ${entry.latest}`}{entry.visits > 1 ? ` · entered ${entry.visits} times` : ""}</Text>
        </View>)}
      </View> : <Text style={textStyle(theme, true)}>The log has no entries for this milestone yet.</Text>}
      <Text style={smallStyle(theme)}>Phases this milestone has entered, from {plural(timeline.logEntries, "log entry", "log entries")}. Entering a phase is not a passed gate.</Text>
    </> : <Text style={textStyle(theme, true)}>The phase history could not be read from the log.</Text>}
  </Card>;
}

function ProgressCard({ path, theme }: ThemeProps & { path: BoardPath }) {
  const { tasks } = path;
  if (tasks.availability !== "available") return <Card title="Task progress" source=".project/tasks" theme={theme}><Text style={textStyle(theme, true)}>{tasks.availability === "absent" ? "No plan or task files yet. GSD Path writes them in the plan phase." : "Tasks could not be read."}</Text></Card>;
  const percent = tasks.counts.total ? Math.round(tasks.counts.done / tasks.counts.total * 100) : null;
  const wave = tasks.waves.find((entry) => entry.current);
  return <Card title="Task progress" source=".project/tasks" theme={theme}>
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ ...textStyle(theme, true), flex: 1 }}>{tasks.counts.done} of {plural(tasks.counts.total, "task")} recorded done</Text>
        <Text style={{ ...textStyle(theme), fontSize: 30, lineHeight: 36, fontWeight: "600" }}>{percent === null ? "—" : `${percent}%`}</Text>
      </View>
      {percent !== null && <ProgressMeter large percent={percent} label={`${tasks.counts.done} of ${tasks.counts.total} tasks recorded done, ${percent}%`} theme={theme} />}
    </View>
    {wave && <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>Current wave · {wave.number}{wave.name ? ` · ${wave.name}` : ""}</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Count label="Pending" value={tasks.counts.pending} theme={theme} />
      <Count label="In progress" value={tasks.counts.inProgress} theme={theme} />
      <Count label="Failed or blocked" value={tasks.counts.failed + tasks.counts.blocked} theme={theme} attention={tasks.counts.failed + tasks.counts.blocked > 0} />
    </View>
    <Text style={smallStyle(theme)}>Statuses as the orchestrator recorded them; a done task is not a review verdict.</Text>
  </Card>;
}

/** The latest review verdicts and pending questions, so the overview shows what needs attention without opening every tab. */
function AttentionCard({ path, theme }: ThemeProps & { path: BoardPath }) {
  const { reviews, questions } = path;
  const latest = reviews.current.waves.filter((review) => !review.superseded && review.verdict).at(-1);
  const final = reviews.current.final;
  return <Card title="Reviews and questions" source=".project/review · .project/discuss" theme={theme} attention={latest?.verdict === "blocked" || final?.verdict === "blocked" || questions.counts.pending > 0}>
    <View style={{ gap: 10 }}>
      <Field label="Latest wave" value={latest ? `Wave ${latest.wave} · cycle ${latest.cycle} · ${tokenLabel(latest.verdict)}` : reviews.availability === "unavailable" ? "Reviews could not be read" : "No wave review recorded"} theme={theme} />
      <Field label="Final review" value={final ? tokenLabel(final.verdict) : "Not recorded"} theme={theme} />
      <Field label="Questions" value={questions.availability === "available" ? `${plural(questions.counts.pending, "pending follow-up")}` : questions.availability === "absent" ? "No discussion recorded" : "Could not be read"} theme={theme} />
    </View>
    <Text style={smallStyle(theme)}>Verdicts and answers as recorded; the Reviews and Questions tabs show the details.</Text>
  </Card>;
}

export function PathOverviewView({ state, usage, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const column = { flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" as const : 0, minWidth: 0, gap: 20 };
  return <PathFrame title="Project overview" description="GSD Path pipeline state, phase history, task progress and host usage for the selected workspace." subject="overview" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : <>
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: "stretch", gap: 20 }}>
        <View style={column}><StateCard path={path} theme={theme} /><TimelineCard path={path} theme={theme} /></View>
        <View style={column}>
          <ProgressCard path={path} theme={theme} />
          <AttentionCard path={path} theme={theme} />
          {path.next && <Card title="Next milestone" source=".project/next/STATE.md" theme={theme}>
            <Text style={textStyle(theme)}>{path.next.milestone ?? "Name not recorded"}</Text>
            <Text style={textStyle(theme, true)}>Planned ahead: {tokenLabel(path.next.phase)} · {tokenLabel(path.next.status)}</Text>
          </Card>}
        </View>
      </View>
      <UsageCard view={usage} theme={theme} />
      {path.warnings.length > 0 && <View style={{ gap: 4 }}>{path.warnings.map((warning) => <Text key={warning} style={smallStyle(theme)}>{PATH_WARNING_COPY[warning]}</Text>)}</View>}
    </>}
  </PathFrame>;
}
