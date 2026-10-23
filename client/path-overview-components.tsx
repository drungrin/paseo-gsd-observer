import { Pressable, Text, View } from "react-native";
import type { BoardPath } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import type { BoardTab } from "./board-tabs.js";
import { PathFrame, plural, SetupNotice, taskLegend, TaskBar, tokenLabel, warningAlerts, type ThemeProps } from "./path-components.js";
import { Heartbeat } from "./path-timeline-components.js";
import { USAGE_SOURCE, usageAlerts, usageNotice } from "./path-usage-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { duration, integer, money, tokens } from "./usage-format.js";
import { BarRow, FadeIn, figures, kicker, Legend, line, Pill, Pulse, RelativeTime, Section, SegmentBar, shortDate, Stat, surface, text, tint, toneColor, type Tone } from "./ui-kit.js";

/** Paseo's live state for the workspace's agents, which the files cannot tell. */
export type WorkspaceAgent = { status: "needs_input" | "failed" | "running" | "attention" | "done"; since: string | null } | null;

/** The GSD Path v2 phases in pipeline order; inspect runs on existing code only, roadmap only in program flow, research and decide when questions are open. */
export const PIPELINE = ["inspect", "define", "research", "decide", "roadmap", "plan", "build", "ship"] as const;
const OPTIONAL_PHASES = new Set<string>(["inspect", "research", "decide", "roadmap"]);

export type Station = { phase: string; state: "done" | "skipped" | "current" | "future"; since: string | null; visits: number };

/**
 * Each phase of the pipeline as the log records it: entered (with the date it was first entered and how often), the current one,
 * passed without being entered, or still ahead. A phase this edition does not know is placed just before ship.
 */
export function stationsFor(path: BoardPath): Station[] {
  const entered = new Map(path.timeline.entries.map((entry) => [entry.phase, entry]));
  const phase = path.state.phase;
  const shipped = path.state.shipped || phase === "shipped";
  const phases: string[] = [...PIPELINE];
  if (phase && !shipped && !phases.includes(phase)) phases.splice(phases.length - 1, 0, phase);
  const current = shipped ? phases.length : phase ? phases.indexOf(phase) : -1;
  return phases.map((name, index) => {
    const entry = entered.get(name);
    const state: Station["state"] = index === current ? "current" : current >= 0 && index < current ? entry ? "done" : "skipped" : entry ? "done" : "future";
    return { phase: name, state, since: entry?.since ?? null, visits: entry?.visits ?? 0 };
  });
}

export function PhaseTrack({ path, theme, compact }: ThemeProps & { path: BoardPath; compact: boolean }) {
  const stations = stationsFor(path);
  const status = path.state.status;
  const currentTone: Tone = status === "blocked" ? "danger" : status === "done" ? "success" : "accent";
  const done = toneColor(theme, "success");
  const reached = (station: Station) => station.state !== "future";
  const segment = (left: Station | undefined, right: Station | undefined) => left && right && reached(left) && reached(right) ? tint(theme, done, 0.55) : line(theme);
  const label = stations.map((station) => `${station.phase}: ${station.state === "done" ? `entered ${shortDate(station.since)}${station.visits > 1 ? `, ${station.visits} times` : ""}` : station.state === "current" ? `current${station.since ? ` since ${shortDate(station.since)}` : ""}` : station.state === "skipped" ? "not entered" : "ahead"}`).join("; ");
  return <View accessible accessibilityRole="image" accessibilityLabel={`Pipeline. ${label}`} style={{ flexDirection: "row" }}>
    {stations.map((station, index) => {
      const current = station.state === "current";
      const size = current ? 16 : station.state === "skipped" ? 8 : 11;
      const color = current ? toneColor(theme, currentTone) : station.state === "done" ? done : "transparent";
      return <View key={station.phase} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6 }}>
        <View style={{ height: 30, alignSelf: "stretch", flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, height: 2, backgroundColor: index ? segment(stations[index - 1], station) : "transparent" }} />
          <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
            {current && status !== "done" ? <Pulse color={color} size={size} /> : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: station.state === "future" || station.state === "skipped" ? 2 : 0, borderColor: line(theme), borderStyle: station.state === "skipped" ? "dashed" : "solid" }} />}
          </View>
          <View style={{ flex: 1, height: 2, backgroundColor: index < stations.length - 1 ? segment(station, stations[index + 1]) : "transparent" }} />
        </View>
        <Text numberOfLines={1} style={{ ...text(theme, compact ? 11 : 12, current ? "700" : "500", !current && station.state !== "done"), ...(current ? { color: toneColor(theme, currentTone) } : {}) }}>{station.phase}{station.visits > 1 ? ` ↺${station.visits}` : ""}</Text>
        <Text numberOfLines={1} style={{ ...text(theme, 11, "400", true), ...figures, marginTop: -6 }}>{station.since ? shortDate(station.since) : station.state === "skipped" ? OPTIONAL_PHASES.has(station.phase) ? "skipped" : "not entered" : " "}</Text>
      </View>;
    })}
  </View>;
}

export type Need = { tone: Tone; title: string; detail: string | null; tab: BoardTab | null };
const NEGATIVE_VERDICTS = new Set(["blocked", "fail", "failed", "not-met", "unverifiable"]);

/** What waits on a person: an agent asking for input, a blocked pipeline, open questions, failed tasks and blocking reviews. */
export function needsFor(path: BoardPath, agent: WorkspaceAgent = null): Need[] {
  const needs: Need[] = [];
  if (agent?.status === "needs_input") needs.push({ tone: "warning", title: "An agent in this workspace is waiting for your input", detail: null, tab: null });
  if (path.state.status === "blocked") needs.push({ tone: "danger", title: `The pipeline is recorded as blocked in ${tokenLabel(path.state.phase).toLowerCase()}`, detail: path.state.lastEvent?.text ?? null, tab: null });
  for (const question of path.questions.pending.slice(0, 3)) needs.push({ tone: "warning", title: `${question.id} needs a follow-up${question.topic ? ` · ${question.topic}` : ""}`, detail: question.question, tab: "questions" });
  if (path.questions.counts.pending > 3) needs.push({ tone: "warning", title: `${plural(path.questions.counts.pending - 3, "more question")} need a follow-up`, detail: null, tab: "questions" });
  const tasks = [...path.tasks.waves.flatMap((wave) => wave.tasks), ...path.tasks.unassigned].filter((task) => task.status === "failed" || task.status === "blocked");
  for (const task of tasks.slice(0, 4)) needs.push({ tone: "danger", title: `${task.id} recorded as ${task.status}`, detail: task.title, tab: "tasks" });
  if (tasks.length > 4) needs.push({ tone: "danger", title: `${plural(tasks.length - 4, "more task")} failed or blocked`, detail: null, tab: "tasks" });
  for (const review of path.reviews.current.waves.filter((entry) => !entry.superseded && NEGATIVE_VERDICTS.has(entry.verdict ?? ""))) {
    const failed = review.tasks.filter((task) => task.verdict === "fail").map((task) => task.id);
    needs.push({ tone: "danger", title: `Wave ${review.wave} review ${review.verdict} at cycle ${review.cycle}`, detail: failed.length ? `Failing: ${failed.join(", ")}` : null, tab: "reviews" });
  }
  const final = path.reviews.current.final;
  if (final && NEGATIVE_VERDICTS.has(final.verdict ?? "")) needs.push({ tone: "danger", title: `Final review recorded as ${final.verdict}`, detail: null, tab: "reviews" });
  return needs;
}

const AGENT_VIEW = {
  running: { tone: "accent", label: "Agent running" },
  needs_input: { tone: "warning", label: "Agent waiting for you" },
  attention: { tone: "warning", label: "Agent finished · needs a look" },
  failed: { tone: "danger", label: "Agent failed" },
  done: { tone: "neutral", label: "Agents idle" },
} as const;

function AgentChip({ agent, theme }: ThemeProps & { agent: WorkspaceAgent }) {
  if (!agent) return null;
  const view = AGENT_VIEW[agent.status];
  const color = toneColor(theme, view.tone);
  const moving = agent.status === "running" || agent.status === "needs_input";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2, minHeight: 28, paddingLeft: moving ? 0 : 10, paddingRight: 12, borderRadius: 999, backgroundColor: tint(theme, color, 0.14) }}>
    {moving ? <Pulse color={color} size={7} /> : <View style={{ width: 8, height: 8, marginRight: 6, borderRadius: 4, backgroundColor: color }} />}
    <Text style={{ ...text(theme, 12, "600"), color }}>{view.label}</Text>
    {agent.since && <RelativeTime theme={theme} value={agent.since} prefix=" · since " style={text(theme, 12, "400", true)} />}
  </View>;
}

function Hero({ path, usage, agent, theme, compact, onNavigate }: ThemeProps & { path: BoardPath; usage: UsageViewState; agent: WorkspaceAgent; compact: boolean; onNavigate(tab: BoardTab): void }) {
  const milestone = path.roadmap.milestones.find((entry) => entry.current);
  const position = milestone ? path.roadmap.milestones.indexOf(milestone) + 1 : null;
  const { counts, waves } = path.tasks;
  const percent = counts.total ? Math.round(100 * counts.done / counts.total) : null;
  const accent = toneColor(theme, path.state.shipped ? "success" : "accent");
  const activity = usage.usage?.activity ?? [];
  return <View style={{ borderRadius: 20, padding: compact ? 18 : 26, gap: 20, overflow: "hidden", backgroundColor: tint(theme, accent, 0.1) }}>
    <View style={{ position: "absolute", right: -120, top: -160, width: 420, height: 420, borderRadius: 210, backgroundColor: tint(theme, accent, 0.05) }} />
    <View style={{ position: "absolute", right: -40, top: -90, width: 220, height: 220, borderRadius: 110, backgroundColor: tint(theme, accent, 0.05) }} />
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 10 }}>
      <Text style={{ ...kicker(theme), color: accent }}>{[milestone?.id ?? "Current milestone", position ? `${position} of ${path.roadmap.counts.total} in the roadmap` : null, path.state.branch].filter(Boolean).join("  ·  ")}</Text>
      <AgentChip agent={agent} theme={theme} />
    </View>
    <View style={{ flexDirection: compact ? "column" : "row", gap: 24, alignItems: compact ? "stretch" : "flex-end" }}>
      <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <Text role="heading" style={{ ...text(theme, compact ? 24 : 30, "700"), letterSpacing: -0.5 }}>{path.state.milestone ?? milestone?.slug ?? "Milestone not recorded"}</Text>
        {milestone?.goal && <Text numberOfLines={compact ? 3 : 2} style={{ ...text(theme, 14, "400", true), maxWidth: 900 }}>{milestone.goal}</Text>}
      </View>
      {activity.length > 0 && <View style={{ width: compact ? undefined : 260 }}><Heartbeat activity={activity} theme={theme} /></View>}
    </View>
    <PhaseTrack path={path} theme={theme} compact={compact} />
    {percent !== null && <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 12 : 24, alignItems: compact ? "stretch" : "center" }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ ...text(theme, 44, "700"), ...figures, letterSpacing: -1, lineHeight: 50 }}>{percent}%</Text>
        <Text style={text(theme, 13, "400", true)}>{`${counts.done} of ${plural(counts.total, "task")}\nrecorded done`}</Text>
      </View>
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        <TaskBar path={path} theme={theme} />
        <Legend theme={theme} items={taskLegend(theme, path)} />
      </View>
    </View>}
    {waves.length > 0 && <View role="list" accessibilityLabel="Waves" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {waves.map((wave) => {
        const done = wave.tasks.filter((task) => task.status === "done").length;
        const finished = wave.tasks.length > 0 && done === wave.tasks.length;
        const color = wave.current ? toneColor(theme, "accent") : finished ? toneColor(theme, "success") : theme.colors.foregroundMuted;
        return <View key={wave.number} role="listitem"><Pressable role="button" accessibilityLabel={`Wave ${wave.number}${wave.name ? `, ${wave.name}` : ""}: ${done} of ${wave.tasks.length} done${wave.current ? ", current" : ""}. Open tasks.`} onPress={() => onNavigate("tasks")}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: wave.current ? color : "transparent", backgroundColor: wave.current ? tint(theme, color, 0.16) : surface(theme) }}>
          <Text style={{ ...text(theme, 12, "700"), color }}>{finished ? "✓" : wave.current ? "●" : "○"} W{wave.number}</Text>
          <Text numberOfLines={1} style={{ ...text(theme, 12, wave.current ? "600" : "400", !wave.current), maxWidth: 220 }}>{wave.name ?? "Unnamed wave"}</Text>
          <Text style={{ ...text(theme, 11, "500", true), ...figures }}>{done}/{wave.tasks.length}</Text>
        </Pressable></View>;
      })}
    </View>}
  </View>;
}

function Needs({ needs, path, theme, onNavigate }: ThemeProps & { needs: readonly Need[]; path: BoardPath; onNavigate(tab: BoardTab): void }) {
  const success = toneColor(theme, "success");
  if (!needs.length) return <View accessible style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: tint(theme, success, 0.1) }}>
    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: tint(theme, success, 0.25) }}><Text style={{ ...text(theme, 15, "700"), color: success }}>✓</Text></View>
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={text(theme, 15, "600")}>Nothing needs you right now</Text>
      <Text style={text(theme, 13, "400", true)}>No open question, failed task or blocking review is recorded{path.state.shipped ? "." : ", and no agent is waiting for input."}</Text>
    </View>
  </View>;
  return <Section theme={theme} tone={needs.some((need) => need.tone === "danger") ? "danger" : "warning"} overline={`Needs you · ${needs.length}`} gap={4} padding={16}>
    <View role="list" accessibilityLabel="What needs you">
      {needs.map((need, index) => {
        const body = <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 8 }}>
          <View style={{ width: 8, height: 8, marginTop: 7, borderRadius: 4, backgroundColor: toneColor(theme, need.tone) }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={text(theme, 14, "600")}>{need.title}</Text>
            {need.detail && <Text numberOfLines={2} style={text(theme, 13, "400", true)}>{need.detail}</Text>}
          </View>
          {need.tab && <Text style={{ ...text(theme, 12, "600"), color: toneColor(theme, need.tone) }}>Open →</Text>}
        </View>;
        const tab = need.tab;
        return <View key={index} role="listitem">{tab ? <Pressable role="button" accessibilityLabel={`${need.title}. Open ${tab}.`} onPress={() => onNavigate(tab)}>{body}</Pressable> : body}</View>;
      })}
    </View>
  </Section>;
}

function Figures({ usage, theme }: ThemeProps & { usage: UsageViewState }) {
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  if (!value) return <Text accessibilityLiveRegion="polite" style={text(theme, 13, "400", true)}>{usageNotice(usage)}</Text>;
  const { totals } = value;
  const inputs = totals.tokensIn + totals.tokensCached;
  const hit = inputs ? totals.tokensCached / inputs : null;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    <Stat theme={theme} label="Spent" value={money(totals.cost)} detail={totals.cost !== null && totals.pricedTurns ? `${money(totals.cost / totals.pricedTurns)} per turn` : value.pricing === "missing" ? "No price table" : "No model has a price"} />
    <Stat theme={theme} label="Agent time" value={totals.timedTurns ? duration(totals.durationS) : "—"} detail={totals.timedTurns ? `${Math.round(totals.durationS / totals.timedTurns)}s per turn` : null} />
    <Stat theme={theme} label="Turns" value={integer(totals.turns)} detail={`${integer(totals.prompts)} prompts · ${plural(value.sessions, "session log")}`} />
    <Stat theme={theme} label="Cache hit" value={hit === null ? "—" : `${Math.round(100 * hit)}%`} detail={`${tokens(totals.tokensIn + totals.tokensCached + totals.tokensOut)} tokens`} tone={hit !== null && hit >= 0.8 ? "success" : undefined} />
  </View>;
}

function Spend({ usage, path, theme, onNavigate }: ThemeProps & { usage: UsageViewState; path: BoardPath; onNavigate(tab: BoardTab): void }) {
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  if (!value) return null;
  const { totals } = value;
  const titles = new Map([...path.tasks.waves.flatMap((wave) => wave.tasks), ...path.tasks.unassigned].map((task) => [task.id, task.title]));
  const costliest = value.tasks.filter((task) => task.cost !== null).sort((left, right) => (right.cost ?? 0) - (left.cost ?? 0)).slice(0, 5);
  const taskCost = value.tasks.reduce((sum, task) => sum + (task.cost ?? 0), 0);
  const models = value.models.filter((model) => model.cost).slice(0, 4);
  const topModel = Math.max(0, ...models.map((model) => model.cost ?? 0));
  const cached = tint(theme, toneColor(theme, "success"), 0.7);
  return <Section title="Where the money went" overline="Host session logs" theme={theme} gap={16}>
    <View style={{ gap: 8 }}>
      <Text style={kicker(theme)}>Token mix</Text>
      <SegmentBar theme={theme} height={14} label={`${tokens(totals.tokensCached)} cached reads, ${tokens(totals.tokensIn)} new input, ${tokens(totals.tokensOut)} output`} segments={[
        { label: "cached", value: totals.tokensCached, color: cached }, { label: "input", value: totals.tokensIn, color: toneColor(theme, "accent") }, { label: "output", value: totals.tokensOut, color: toneColor(theme, "warning") },
      ]} />
      <Legend theme={theme} items={[{ color: cached, label: `${tokens(totals.tokensCached)} cached reads` }, { color: toneColor(theme, "accent"), label: `${tokens(totals.tokensIn)} new input` }, { color: toneColor(theme, "warning"), label: `${tokens(totals.tokensOut)} output` }]} />
    </View>
    {costliest.length > 0 && <View style={{ gap: 10 }}>
      <Text style={kicker(theme)}>Costliest tasks{totals.cost ? ` · task agents spent ${Math.round(100 * taskCost / totals.cost)}%` : ""}</Text>
      {costliest.map((task) => <BarRow key={task.id} theme={theme} label={task.id} detail={titles.get(task.id)} value={task.cost ?? 0} max={costliest[0].cost ?? 0} figure={money(task.cost)} color={toneColor(theme, "accent")} onPress={() => onNavigate("tasks")} />)}
    </View>}
    {models.length > 0 && <View style={{ gap: 10 }}>
      <Text style={kicker(theme)}>Models</Text>
      {models.map((model) => <BarRow key={`${model.model}:${model.host}`} theme={theme} label={model.model ?? "unknown"} detail={`${integer(model.turns)} turns`} value={model.cost ?? 0} max={topModel} figure={money(model.cost)} color={tint(theme, theme.colors.foregroundMuted, 0.6)} />)}
    </View>}
  </Section>;
}

function Latest({ path, theme }: ThemeProps & { path: BoardPath }) {
  const { state } = path;
  const event = state.lastEvent;
  return <Section title="Latest" overline={event ? `${shortDate(event.date)}${event.phase ? ` · ${event.phase}` : ""}` : "STATE.md log"} aside={event ? <RelativeTime theme={theme} value={event.date} /> : undefined} theme={theme}>
    {event ? <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ width: 3, borderRadius: 2, backgroundColor: toneColor(theme, "accent") }} />
        <Text style={{ ...text(theme, 14), flex: 1 }}>{event.text ?? "This entry has no safely displayable wording."}</Text>
      </View>
      {event.text && event.shortened && <Text style={text(theme, 12, "400", true)}>Some wording was shortened or withheld for safe display.</Text>}
    </View> : <Text style={text(theme, 13, "400", true)}>No log entries recorded.</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {state.project && <Pill theme={theme} label={`Project · ${state.project}`} />}
      <Pill theme={theme} label={`Integration · ${tokenLabel(state.integration)}`} />
      {state.integrationDefault && state.integrationDefault !== state.integration && <Pill theme={theme} label={`Project default · ${tokenLabel(state.integrationDefault)}`} />}
      {state.defaultBranch && <Pill theme={theme} label={`Ships onto ${state.defaultBranch}`} />}
      <Pill theme={theme} label={plural(path.timeline.logEntries, "log entry", "log entries")} />
    </View>
    {path.next && <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: surface(theme, 2) }}>
      <Text style={kicker(theme)}>Planned ahead</Text>
      <Text style={text(theme, 13, "600")}>{path.next.milestone ?? "Next milestone"}</Text>
      <Text style={text(theme, 13, "400", true)}>{tokenLabel(path.next.phase)} · {tokenLabel(path.next.status).toLowerCase()}</Text>
    </View>}
  </Section>;
}

function ReportCard({ path, usage, theme }: ThemeProps & { path: BoardPath; usage: UsageViewState }) {
  // The shipped milestone's own share: usage after its ship date counts toward the next one.
  const id = path.roadmap.milestones.find((milestone) => milestone.current)?.id ?? null;
  const slot = usage.usage?.availability === "available" ? usage.usage.milestones.find((entry) => entry.id === id) : undefined;
  const first = path.timeline.entries[0]?.since ?? null;
  const last = path.timeline.entries.at(-1)?.latest ?? null;
  const days = first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1 : null;
  return <Section theme={theme} tone="success" overline="Milestone report card" title="Recorded as shipped">
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Stat theme={theme} label="Took" value={days ? plural(days, "day") : "—"} detail={first && last ? `${shortDate(first)} → ${shortDate(last)}` : null} />
      <Stat theme={theme} label="Tasks" value={integer(path.tasks.counts.total)} detail={plural(path.tasks.waves.length, "wave")} />
      <Stat theme={theme} label="Review cycles" value={integer(path.reviews.current.waves.length)} />
      <Stat theme={theme} label="Spent" value={money(slot?.cost ?? null)} detail={slot ? `${integer(slot.turns)} turns` : null} />
    </View>
  </Section>;
}

/** The caveats behind the overview, folded under "About these figures". */
export function overviewNotes(): string[] {
  return [
    "Phases, statuses and verdicts are as GSD Path recorded them in .project; the observer does not verify them, nor the integration of a shipped milestone.",
    "Entering a phase is not a passed gate, and a done task is not a review verdict.",
    "The agent status is Paseo's live state for this workspace; it is not read from the project files.",
    USAGE_SOURCE,
    "Spend per task counts the turns of subagents whose log names that task first. A shipped milestone's spend counts usage up to its ship date.",
  ];
}

/** What qualifies the overview: every evidence warning, and the usage qualifiers. */
export const overviewAlerts = (path: BoardPath | undefined, usage: UsageViewState) => [...warningAlerts(path, () => true), ...usageAlerts(usage)];

export function PathOverviewView({ state, usage, agent = null, onRefresh, onNavigate = () => undefined, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; agent?: WorkspaceAgent; onRefresh(): void; onNavigate?(tab: BoardTab): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const column = { flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: compact ? "auto" as const : 0, minWidth: 0, gap: 16 };
  return <PathFrame title="Overview" description="Where this milestone stands, what needs you, and what it has cost." subject="overview" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={overviewAlerts(path, usage)} notes={overviewNotes()}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : <>
      <FadeIn><Hero path={path} usage={usage} agent={agent} theme={theme} compact={compact} onNavigate={onNavigate} /></FadeIn>
      <FadeIn delay={80}><Needs needs={needsFor(path, agent)} path={path} theme={theme} onNavigate={onNavigate} /></FadeIn>
      {path.state.shipped && <ReportCard path={path} usage={usage} theme={theme} />}
      <FadeIn delay={140}><Figures usage={usage} theme={theme} /></FadeIn>
      <FadeIn delay={200}><View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "flex-start", gap: 16 }}>
        <View style={column}><Latest path={path} theme={theme} /></View>
        <View style={column}><Spend usage={usage} path={path} theme={theme} onNavigate={onNavigate} /></View>
      </View></FadeIn>
    </>}
  </PathFrame>;
}
