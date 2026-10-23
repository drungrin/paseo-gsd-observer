import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>()));

import { expand } from "../helpers/react-native-mock";
import { BOARD_TABS, PATH_TABS, pathBadges, tabForKey, tabsFor } from "../../client/board-tabs";
import type { BoardViewState } from "../../client/board-components";
import { liveStatus } from "../../client/board-frame";
import { needsFor, overviewNotes, PathOverviewView, stationsFor } from "../../client/path-overview-components";
import { PathQuestionsView, questionsNotes } from "../../client/path-questions-components";
import { ledgerNotes, ledgerRow, PathLedgerView } from "../../client/path-ledger-components";
import { milestoneFacts, milestoneState, PathRoadmapView, roadmapNotes } from "../../client/path-roadmap-components";
import { cycleTitle, latestCycles, panelSummary, PathReviewsView, recoveryTitle, reviewsNotes } from "../../client/path-reviews-components";
import { defaultTask, PathTasksView, relatedTasks, TaskList, taskFacts, tasksNotes } from "../../client/path-tasks-components";
import { buildScale, heatmapRows, laneGroups, longPole, PathTimelineView, peakParallel, timelineNotes } from "../../client/path-timeline-components";
import { ago, tint, toneColor } from "../../client/ui-kit";
import type { BoardPath, PathReviewSet, PathTask, PathWaveReview } from "../../shared/path";
import type { BoardUsage } from "../../shared/usage";
import { createUsageState, type UsageViewState } from "../../client/usage-controller";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const task = (overrides: Partial<PathTask> = {}): PathTask => ({ id: "T001", title: "Pin the runtime version", status: "done", wave: 1, deps: [], supersedes: [], repo: "web", files: 2, idConflict: false, ...overrides });
const cycle = (overrides: Partial<PathWaveReview> = {}): PathWaveReview => ({ wave: 1, cycle: 1, lens: null, verdict: "pass", depth: "full", tasksReviewed: 2, tasks: [{ id: "T001", verdict: "pass" }, { id: "T002", verdict: "pass" }], superseded: false, panel: null, ...overrides });
const reviewSet = (overrides: Partial<PathReviewSet> = {}): PathReviewSet => ({ waves: [], planPanel: null, final: null, gaps: [], patchFindings: false, otherFiles: [], ...overrides });
const pathData = (overrides: Partial<BoardPath> = {}): BoardPath => ({
  setup: "started",
  state: { availability: "available", project: "acme-orchestrator", milestone: "invoice-evidence", phase: "build", status: "active", branch: "feature/milestone-001", defaultBranch: "main", integration: "pull-request", integrationDefault: "direct", shipped: false,
    lastEvent: { date: "2026-10-09", phase: "build", text: "owner ruling on storage: separate bucket", shortened: true } },
  timeline: { availability: "available", logEntries: 12, entries: [
    { phase: "define", since: "2026-10-04", latest: "2026-10-04", visits: 1, current: false },
    { phase: "plan", since: "2026-10-06", latest: "2026-10-08", visits: 2, current: false },
    { phase: "build", since: "2026-10-07", latest: "2026-10-09", visits: 2, current: true },
  ] },
  roadmap: { availability: "available", counts: { total: 3, shipped: 1, active: 1, pending: 1, abandoned: 0, other: 0 }, milestones: [
    { id: "M000", slug: "billing-foundation", status: "shipped", goal: null, depends: [], archived: true, integrated: true, current: false, shipped: "2026-09-30", tasksDone: 12, tasksTotal: 12, waveCount: 3 },
    { id: "M001", slug: "invoice-evidence", status: "active", goal: "An authorized user registers an invoice.", depends: ["M000"], archived: false, integrated: false, current: true, shipped: null, tasksDone: null, tasksTotal: null, waveCount: null },
    { id: "M002", slug: "invoice-validation", status: "pending", goal: null, depends: ["M001"], archived: false, integrated: false, current: false, shipped: null, tasksDone: null, tasksTotal: null, waveCount: null },
  ] },
  next: { milestone: "invoice-validation", phase: "research", status: "active" },
  tasks: { availability: "available", planObserved: true, currentWave: 1, limited: false, unassigned: [],
    counts: { total: 4, done: 1, inProgress: 1, pending: 1, failed: 0, blocked: 1, other: 0 },
    waves: [
      { number: 1, name: "risk burn-down", goal: "Prove the storage assumptions first.", goalShortened: true, inPlan: true, current: true, tasks: [task(), task({ id: "T002", title: null, status: "in-progress", deps: ["T001"], idConflict: true })] },
      { number: 2, name: "walking skeleton", goal: null, goalShortened: false, inPlan: true, current: false, tasks: [task({ id: "T003", status: "pending", wave: 2, supersedes: ["T001"], repo: null, files: 0 })] },
      { number: 3, name: null, goal: null, goalShortened: false, inPlan: false, current: false, tasks: [task({ id: "T004", status: "blocked", wave: 3 })] },
    ] },
  reviews: { availability: "available", limited: false,
    current: reviewSet({
      waves: [
        cycle({ verdict: "blocked", superseded: true, tasks: [{ id: "T001", verdict: "pass" }, { id: "T002", verdict: "fail" }], panel: { families: ["gpt", "muse"], actionable: 2, warnings: 1, conflicts: 0, familyFiles: ["gpt", "muse"] } }),
        cycle({ cycle: 2, tasksReviewed: 3 }),
        cycle({ wave: 2, cycle: 1, lens: "adversarial", depth: "deep", verdict: "blocked", tasks: [{ id: "T003", verdict: "fail" }], tasksReviewed: 1 }),
      ],
      planPanel: { families: ["gpt"], actionable: 0, warnings: 1, conflicts: 0, familyFiles: [] },
      final: { verdict: "blocked", criteria: [{ id: "SC1", text: "Invoices are kept immutably", verdict: "met" }, { id: "SC2", text: null, verdict: "not-met" }] },
      gaps: [{ number: 1, verdict: "pass", risk: "project Verify" }], patchFindings: true, otherFiles: ["reviewer-notes.md"],
    }),
    recoveries: [{ base: "0f1e2d3", date: "2026-10-08", kind: "plan", reviews: reviewSet({ waves: [cycle({ verdict: "pass" })] }) }] },
  questions: { availability: "available", limited: false, counts: { answers: 5, pending: 2, closed: 2 }, pending: [
    { id: "A001", date: "2026-10-05", topic: "storage account", question: "Which storage account keeps the invoice files?", status: "needs-user", owner: "user", target: ".project/intent/INTENT.md" },
    { id: "A002", date: null, topic: null, question: null, status: "final", owner: null, target: null },
  ] },
  warnings: ["roadmap-malformed", "task-id-conflict"],
  ...overrides,
});
const state = (path: BoardPath | null = pathData()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-10-22T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, flavor: "gsd-path", ...(path ? { path } : {}),
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const usageData = (overrides: Partial<BoardUsage> = {}): BoardUsage => ({ workspaceId: "selected", observedAt: "2026-10-23T00:00:00.000Z", availability: "available", complete: true, limited: false, pricing: "configured", sessions: 43,
  totals: { turns: 1234, prompts: 1200, tokensIn: 12_300_000, tokensCached: 456_700_000, tokensOut: 2_100_000, cost: 123.45, pricedTurns: 1234, durationS: 20_000, timedTurns: 1233 },
  models: [{ model: "claude-sonnet-5-5", host: "claude", turns: 800, tokens: 300_000_000, cost: 50.25 }, { model: "example-model-1.0", host: "claude", turns: 40, tokens: 5_000_000, cost: null }],
  milestones: [{ id: "M001", turns: 1240, tokens: 1_060_000_000, cost: 124.6 }, { id: "M000", turns: 12, tokens: 2_000_000, cost: 1.5 }],
  unpriced: ["example-model-1.0"],
  tasks: [{ id: "T001", turns: 300, tokens: 90_000_000, cost: 40.5, durationS: 3_600, first: "2026-10-07T09:00:05.000Z", last: "2026-10-07T13:20:00.000Z" }, { id: "T002", turns: 120, tokens: 30_000_000, cost: 12.25, durationS: 1_200, first: "2026-10-07T09:10:00.000Z", last: "2026-10-07T10:00:00.000Z" }],
  plans: [], phases: [],
  activity: [
    { lane: "orchestrator", at: "2026-10-07T08:50:00.000Z", turns: 4, cost: 0.5 },
    { lane: "T001", at: "2026-10-07T09:00:00.000Z", turns: 10, cost: 1.25 }, { lane: "T002", at: "2026-10-07T09:10:00.000Z", turns: 6, cost: 0.75 }, { lane: "T001", at: "2026-10-07T09:10:00.000Z", turns: 12, cost: 1.5 },
    { lane: "T001", at: "2026-10-07T13:20:00.000Z", turns: 2, cost: 0.25 }, { lane: "subagents", at: "2026-10-07T13:20:00.000Z", turns: 3, cost: null },
  ],
  activityLimited: false, ...overrides });
const usageView = (usage: BoardUsage | null = usageData(), overrides: Partial<UsageViewState> = {}): UsageViewState => ({ ...createUsageState(), usage, ...overrides });
const overview = (path?: BoardPath | null, compact = false, usage = usageView(), agent: Parameters<typeof PathOverviewView>[0]["agent"] = null, onNavigate = vi.fn()) => {
  const tree = expand(PathOverviewView({ state: state(path), usage, agent, theme, compact, onRefresh: vi.fn(), onNavigate }));
  return { tree, content: text(tree), onNavigate };
};
const tasksView = (path?: BoardPath, compact = false, usage = usageView()) => expand(PathTasksView({ state: state(path), usage, theme, compact, onRefresh: vi.fn() }));
const label = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));

describe("GSD Path tabs", () => {
  it("lists each pipeline's own tabs, and only Overview before a workspace is read", () => {
    expect(tabsFor(undefined).map((tab) => tab.id)).toEqual(["overview"]);
    expect(tabsFor("gsd-core")).toBe(BOARD_TABS);
    expect(tabsFor("gsd-path").map((tab) => tab.label)).toEqual(["Overview", "Tasks", "Timeline", "Reviews", "Roadmap", "Questions", "Ledger"]);
    expect(tabForKey("overview", "ArrowRight", PATH_TABS)).toBe("tasks");
    expect(tabForKey("ledger", "ArrowRight", PATH_TABS)).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft", PATH_TABS)).toBe("ledger");
    expect(tabForKey("overview", "End", PATH_TABS)).toBe("ledger");
  });

  it("puts task progress, open review blocks, roadmap progress and pending questions beside their tabs", () => {
    expect(pathBadges(pathData())).toEqual({
      tasks: { label: "1/4", tone: "danger" }, reviews: { label: "1 blocked", tone: "danger" }, roadmap: { label: "1/3" }, questions: { label: "2", tone: "warning" },
    });
    const calm = pathData();
    calm.tasks = { ...calm.tasks, counts: { ...calm.tasks.counts, done: 4, inProgress: 0, pending: 0, blocked: 0 } };
    calm.reviews = { ...calm.reviews, current: reviewSet() };
    calm.questions = { ...calm.questions, pending: [], counts: { answers: 5, pending: 0, closed: 5 } };
    expect(pathBadges(calm)).toEqual({ tasks: { label: "4/4", tone: "success" }, roadmap: { label: "1/3" } });
    expect(pathBadges(pathData({ setup: "not-started" }))).toEqual({});
    expect(pathBadges(undefined)).toEqual({});
  });

  it("says whether the panel follows the files", () => {
    expect(liveStatus(state())).toEqual({ tone: "success", label: "Live · last read ", live: true });
    expect(liveStatus({ ...state(), statusFailed: true })).toEqual({ tone: "warning", label: "Cannot reach the plugin · retrying", live: false });
    const stale = state();
    expect(liveStatus({ ...stale, snapshot: { ...stale.snapshot!, freshness: "stale" } })).toMatchObject({ tone: "warning", label: "Files changed · updating" });
    expect(liveStatus({ ...stale, snapshot: { ...stale.snapshot!, warnings: ["observation-limited"] } })).toMatchObject({ tone: "warning", label: "Not following changes · refresh to update", live: false });
    expect(liveStatus({ ...stale, error: "Could not refresh evidence." })).toMatchObject({ tone: "danger", label: "Out of date" });
  });
});

describe("GSD Path overview", () => {
  it("leads with the milestone, its pipeline, its waves and task progress", () => {
    const { content, tree } = overview();
    for (const expected of [
      "M001  ·  2 of 3 in the roadmap  ·  feature/milestone-001", "invoice-evidence", "An authorized user registers an invoice.",
      "25%", "1 of 4 tasks\nrecorded done", "1 done", "1 in progress", "1 failed or blocked", "1 pending",
      "● W1", "risk burn-down", "1/2", "○ W2", "walking skeleton", "○ W3", "Unnamed wave",
    ]) expect(content).toContain(expected);
    expect(String(label(tree, "Pipeline.")?.props?.accessibilityLabel)).toBe("Pipeline. inspect: not entered; define: entered Oct 4; research: not entered; decide: not entered; roadmap: not entered; plan: entered Oct 6, 2 times; build: current since Oct 7; ship: ahead");
    expect(content).toContain("plan ↺2");
    expect(content).not.toContain("Recorded as shipped");
  });

  it("lists what needs a person, and opens the tab each one is in", () => {
    const { content, tree, onNavigate } = overview();
    for (const expected of ["Needs you · 5", "A001 needs a follow-up · storage account", "Which storage account keeps the invoice files?", "A002 needs a follow-up",
      "T004 recorded as blocked", "Wave 2 review blocked at cycle 1", "Failing: T003", "Final review recorded as blocked"]) expect(content).toContain(expected);
    (label(tree, "T004 recorded as blocked")?.props?.onPress as () => void)();
    expect(onNavigate).toHaveBeenCalledWith("tasks");
    (label(tree, "Wave 1, risk burn-down")?.props?.onPress as () => void)();
    expect(onNavigate).toHaveBeenCalledTimes(2);
    const calm = pathData();
    calm.tasks = { ...calm.tasks, waves: calm.tasks.waves.slice(0, 2) };
    calm.reviews = { ...calm.reviews, current: reviewSet() };
    calm.questions = { ...calm.questions, pending: [], counts: { answers: 5, pending: 0, closed: 5 } };
    expect(overview(calm).content).toContain("Nothing needs you right now");
  });

  it("shows the latest log entry, the recorded facts, the lookahead milestone and where the money went", () => {
    const { content } = overview();
    for (const expected of [
      "Oct 9 · build", "owner ruling on storage: separate bucket", "Some wording was shortened or withheld for safe display.",
      "Project · acme-orchestrator", "Integration · Pull request", "Project default · Direct", "Ships onto main", "12 log entries",
      "Planned ahead", "invoice-validation", "Research · active",
      "Spent$123.45", "$0.10 per turn", "Agent time5h 33m", "16s per turn", "Turns1,234", "1,200 prompts · 43 session logs", "Cache hit97%", "471.1M tokens",
      "Where the money went", "456.7M cached reads", "12.3M new input", "2.1M output", "task agents spent 43%", "T001", "Pin the runtime version", "$40.50", "T002", "$12.25",
      "claude-sonnet-5-5", "800 turns", "$50.25",
    ]) expect(content).toContain(expected);
  });

  it("shows live agent status beside the recorded state, and puts an agent waiting for input first", () => {
    expect(overview(pathData(), false, usageView(), { status: "running", since: "2026-10-22T00:00:00.000Z" }).content).toContain("Agent running");
    expect(overview(pathData(), false, usageView(), { status: "done", since: null }).content).toContain("Agents idle");
    expect(needsFor(pathData(), { status: "needs_input", since: null })[0]).toEqual({ tone: "warning", title: "An agent in this workspace is waiting for your input", detail: null, tab: null });
    expect(overview(pathData(), false, usageView(), null).content).not.toContain("Agent running");
  });

  it("explains usage that is loading, missing or unpriced", () => {
    expect(overview(pathData(), false, usageView(null)).content).toContain("Reading host session logs…");
    expect(overview(pathData(), false, usageView(null, { error: "x" })).content).toContain("Host usage could not be read.");
    expect(overview(pathData(), false, usageView(usageData({ availability: "none" }))).content).toContain("No Claude Code or Codex session recorded a working directory inside this workspace.");
    const unpriced = overview(pathData(), false, usageView(usageData({ pricing: "missing", totals: { ...usageData().totals, cost: null, pricedTurns: 0, timedTurns: 0 } }))).content;
    for (const expected of ["Spent—", "No price table", "Agent time—"]) expect(unpriced).toContain(expected);
    expect(overview(pathData(), false, usageView(usageData({ totals: { ...usageData().totals, cost: null, pricedTurns: 0 } }))).content).toContain("No model has a price");
    // What changes how the figures read stays in view; how to read them is folded.
    const partial = overview(pathData(), false, usageView(usageData({ complete: false, limited: true, pricing: "missing" }), { error: "x" })).content;
    for (const expected of ["Still reading host session logs; the figures will grow.", "No price table was found in the GSD Path daemon's configuration, so costs are not shown.",
      "No price is configured for example-model-1.0: tokens counted, cost excluded.", "A session folder holds more entries than the observer walks, so these figures cover only part of it.",
      "Could not refresh host usage; the last figures are still displayed.", "Some roadmap milestone entries are ambiguous and were left out."]) expect(partial).toContain(expected);
    expect(overviewNotes()).toContain("Entering a phase is not a passed gate, and a done task is not a review verdict.");
  });

  it("says shipped and blocked only as recorded", () => {
    const shipped = pathData();
    shipped.state = { ...shipped.state, phase: "shipped", status: "done", shipped: true };
    const report = overview(shipped, true).content;
    // The milestone's own spend, not the workspace's.
    for (const expected of ["Milestone report card", "Recorded as shipped", "Took6 days", "Oct 4 → Oct 9", "Tasks4", "3 waves", "Review cycles3", "Spent$124.60", "1,240 turns"]) expect(report).toContain(expected);
    expect(overviewNotes()[0]).toContain("the observer does not verify them, nor the integration of a shipped milestone");
    const blocked = pathData();
    blocked.state = { ...blocked.state, status: "blocked" };
    expect(overview(blocked).content).toContain("The pipeline is recorded as blocked in build");
  });

  it("places each phase as entered, skipped, current or ahead, and an unknown phase before ship", () => {
    expect(stationsFor(pathData()).map((station) => `${station.phase}:${station.state}`)).toEqual(["inspect:skipped", "define:done", "research:skipped", "decide:skipped", "roadmap:skipped", "plan:done", "build:current", "ship:future"]);
    const unknown = pathData();
    unknown.state = { ...unknown.state, phase: "verify" };
    expect(stationsFor(unknown).map((station) => station.phase).slice(-2)).toEqual(["verify", "ship"]);
    const shipped = pathData();
    shipped.state = { ...shipped.state, phase: "shipped", shipped: true };
    expect(stationsFor(shipped).every((station) => station.state === "done" || station.state === "skipped")).toBe(true);
    const missing = pathData();
    missing.state = { ...missing.state, phase: null };
    expect(stationsFor(missing).filter((station) => station.state === "done").map((station) => station.phase)).toEqual(["define", "plan", "build"]);
  });

  it("shows setup notices instead of evidence", () => {
    expect(overview(pathData({ setup: "not-started" })).content).toContain("GSD Path is installed in this workspace, but no milestone has written .project/STATE.md yet.");
    expect(overview(pathData({ setup: "unsupported" })).content).toContain("The state file names a pipeline format this observer does not read.");
    expect(overview(null).content).toContain("Project evidence unavailable");
  });
});

describe("GSD Path tasks", () => {
  it("shows every wave as tiles and opens on the task in progress, with what it needs and its spend", () => {
    const tree = tasksView();
    const content = text(tree);
    for (const expected of ["W1", "Current", "risk burn-down", "1 of 2 tasks recorded done · $52.75 · 1h 20m agent time", "Prove the storage assumptions first.",
      "W3", "Not in PLAN.md", "T002 · wave 1 · member web", "Title not safely displayable", "In progress", "The file records a different task id; the file name's id is shown.",
      "Needs", "T001", "Unblocks", "Spent$12.25", "Turns120", "Agent time20m", "Wall clock50m"]) expect(content).toContain(expected);
    const tile = label(tree, "T001, Done, Pin the runtime version");
    expect(tile?.props?.accessibilityLabel).toBe("T001, Done, Pin the runtime version, $40.50, needed by the selected task");
    expect(label(tree, "T002, In progress")?.props?.accessibilityState).toEqual({ selected: true });
  });

  it("finds the task to open first and each task's neighbours", () => {
    expect(defaultTask(pathData())?.id).toBe("T002");
    const quiet = pathData();
    quiet.tasks = { ...quiet.tasks, waves: quiet.tasks.waves.map((wave) => ({ ...wave, tasks: wave.tasks.map((entry) => ({ ...entry, status: entry.id === "T003" ? "pending" : "done" })) })) };
    expect(defaultTask(quiet)?.id).toBe("T003");
    const all = pathData().tasks.waves.flatMap((wave) => wave.tasks);
    expect([...relatedTasks(all[0], all)]).toEqual([["T002", "downstream"]]);
    expect([...relatedTasks(all[1], all)]).toEqual([["T001", "upstream"]]);
  });

  it("lists each wave's tasks with their facts in the list view", () => {
    const content = text(expand(TaskList({ path: pathData(), theme, compact: false })));
    for (const expected of ["Wave 1 · risk burn-down · Current", "Pin the runtime version", "Member: web", "Depends on T001", "2 files", "Supersedes T001", "Wave 3", "Not listed in PLAN.md."]) expect(content).toContain(expected);
  });

  it("lists task facts in reading order, and explains what the figures mean", () => {
    expect(taskFacts(task({ status: "in-progress", deps: ["T001", "T002"], supersedes: ["T000"], files: 1 }))).toEqual(["In progress", "Member: web", "Depends on T001, T002", "Supersedes T000", "1 file"]);
    expect(taskFacts(task({ status: null, repo: null, files: 0 }))).toEqual(["Status not recorded"]);
    const notes = tasksNotes(pathData());
    for (const expected of ["Statuses as the orchestrator recorded them in the task files; a done task is not a review verdict.", "Some wave goals were shortened for safe display."]) expect(notes).toContain(expected);
    expect(text(tasksView())).toContain("Some task files record an id that differs from their file name; the file name is shown.");
    expect(text(tasksView())).not.toContain("Some roadmap milestone entries are ambiguous");
    const unpriced = pathData();
    expect(text(expand(PathTasksView({ state: state(unpriced), usage: usageView(usageData({ tasks: usageData().tasks.map((entry) => ({ ...entry, cost: null })) })), theme, compact: false, onRefresh: vi.fn() })))).not.toContain("$0.00");
  });

  it("explains absent and unreadable tasks", () => {
    const absent = pathData();
    absent.tasks = { ...absent.tasks, availability: "absent", waves: [], counts: { total: 0, done: 0, inProgress: 0, pending: 0, failed: 0, blocked: 0, other: 0 } };
    expect(text(tasksView(absent, true))).toContain("No plan or task files yet. GSD Path writes them in the plan phase.");
    absent.tasks = { ...absent.tasks, availability: "unavailable" };
    expect(text(tasksView(absent))).toContain("The plan and task files could not be read safely.");
  });
});

const timelineView = (path: BoardPath = pathData(), usage = usageView(), compact = false) => expand(PathTimelineView({ state: state(path), usage, theme, compact, onRefresh: vi.fn() }));

describe("GSD Path timeline", () => {
  it("draws every lane on one axis with its headline figures and the hours the agents worked", () => {
    process.env.TZ = "UTC";
    const tree = timelineView();
    const content = text(tree);
    for (const expected of ["Span", "4h 40m", "Oct 7, 08:50 → Oct 7, 13:30", "Active", "1 idle break folded", "Peak parallel", "2 task agents", "at Oct 7, 09:10",
      "Long pole", "T001", "4h 19m first to last turn · $40.50", "Orchestrator", "W1 · risk burn-down", "Current", "T002", "W2 · walking skeleton", "T003", "Other subagents", "Subagents",
      "When the agents worked", "37 turns · $4.25"]) expect(content).toContain(expected);
    expect(label(tree, "T001, Done:")?.props?.accessibilityLabel).toBe("T001, Done: 24 turns · $3.00 · 30 active minutes");
    expect(label(tree, "T003, Pending:")?.props?.accessibilityLabel).toBe("T003, Pending: no turns recorded");
  });

  it("folds idle gaps, keeps time moving forward, and puts lanes in pipeline order", () => {
    const start = Date.UTC(2026, 9, 7, 9);
    const scale = buildScale([start, start + 600_000, start + 6 * 3_600_000], 640)!;
    expect(scale.segments.map((segment) => [segment.start, segment.end])).toEqual([[start, start + 1_200_000], [start + 6 * 3_600_000, start + 6 * 3_600_000 + 600_000]]);
    expect(scale.x(start)).toBe(0);
    expect(scale.x(start + 600_000)).toBeGreaterThan(scale.x(start));
    expect(scale.x(start + 3 * 3_600_000)).toBe(scale.segments[1].x);
    expect(scale.x(scale.end)).toBeCloseTo(640);
    expect(buildScale([], 640)).toBeNull();
    const groups = laneGroups(pathData(), usageData().activity);
    expect(groups.map((group) => group.key)).toEqual(["orchestrator", "wave-1", "wave-2", "wave-3", "subagents"]);
    expect(groups[1].lanes.map((lane) => [lane.id, lane.buckets.length])).toEqual([["T001", 3], ["T002", 1]]);
    expect(laneGroups(pathData(), [{ lane: "T090", at: "2026-10-07T09:00:00.000Z", turns: 1, cost: null }]).map((group) => group.title)).toContain("Tasks outside the current plan");
  });

  it("widens a long history instead of squeezing it, so every stretch of work keeps its width", () => {
    // Fourteen days of three short sessions a day, on a track narrower than their breaks.
    const times = Array.from({ length: 14 * 3 }, (_, index) => Date.UTC(2026, 9, 1 + Math.floor(index / 3), 8 + 4 * (index % 3)));
    const scale = buildScale(times, 640)!;
    expect(scale.segments).toHaveLength(42);
    expect(scale.width).toBeGreaterThan(640);
    expect(scale.segments.every((segment) => segment.width > 0)).toBe(true);
    expect(scale.x(scale.end)).toBeCloseTo(scale.width);
    expect(scale.segments[41].x + scale.segments[41].width).toBeCloseTo(scale.width);
  });

  it("finds the peak of parallel task agents, the long pole and the turns per local hour", () => {
    process.env.TZ = "UTC";
    expect(peakParallel(usageData().activity)).toEqual({ agents: 2, at: "2026-10-07T09:10:00.000Z" });
    expect(longPole(usageData().tasks)?.task.id).toBe("T001");
    expect(longPole([])).toBeNull();
    const [row] = heatmapRows(usageData().activity);
    expect(row).toMatchObject({ day: "Wed, Oct 7", turns: 37, cost: 4.25 });
    expect(row.hours[9]).toBe(28);
    expect(row.hours[13]).toBe(5);
    expect(heatmapRows([{ lane: "T001", at: "2026-10-08T09:00:00.000Z", turns: 3, cost: null }])[0].cost).toBeNull();
  });

  it("explains a timeline with nothing to draw and the lane rules", () => {
    expect(text(timelineView(pathData(), usageView(usageData({ activity: [] }))))).toContain("No host turn in this workspace has a timestamp yet.");
    expect(text(timelineView(pathData(), usageView(null)))).toContain("Reading host session logs…");
    expect(text(timelineView(pathData(), usageView(usageData({ activityLimited: true }))))).toContain("More activity is recorded than the observer carries; the oldest is left out.");
    expect(timelineNotes()[0]).toContain("Each block is ten minutes of host turns");
  });
});

const reviewsView = (path?: BoardPath, compact = false) => expand(PathReviewsView({ state: state(path), theme, compact, onRefresh: vi.fn() }));
const questionsView = (path?: BoardPath, compact = false) => text(expand(PathQuestionsView({ state: state(path), theme, compact, onRefresh: vi.fn() })));

describe("GSD Path reviews tab", () => {
  it("shows each wave's cycles as a chain, with the final review, gaps and plan panel", () => {
    const tree = reviewsView();
    const content = text(tree);
    for (const expected of [
      "Review cycles3", "2 waves reviewed", "Sent back2", "Open blocks1", "waiting on fixes", "Final reviewBlocked",
      "Final review · review/FINAL.md", "✕ Blocked", "1 of 2 criteria recorded as met", "SC1  Invoices are kept immutably", "Met", "Criterion not safely displayable", "Not met",
      "Gap 1 · project Verify", "Plan review · review/PLAN-PANEL.md", "gpt", "0 actionable", "1 warning", "0 conflicts",
      "W1", "risk burn-down", "Pass after 2 cycles", "Cycle 1", "superseded", "Blocked", "2 tasks · full depth · 1 pass · 1 fail", "2 actionable", "Panel: gpt, muse · family files: gpt, muse", "T002",
      "Cycle 2", "3 tasks · full depth · 2 pass · 0 fail", "W2", "Blocked after 1 cycle", "Adversarial lens", "Cycle 1 · Adversarial lens", "1 task · deep depth · 0 pass · 1 fail", "T003",
      "Patch findings are recorded in review/PATCH-FINDINGS.md.", "Other review files: reviewer-notes.md", "1 review set set aside by build recovery",
    ]) expect(content).toContain(expected);
    expect(content).not.toContain("Recovery from 0f1e2d3");
    expect(label(tree, "Show 1 review set set aside by build recovery")?.props?.accessibilityState).toEqual({ expanded: false });
    expect(label(tree, "Cycle 1: blocked, superseded by a later cycle")?.props?.accessibilityLabel).toBe("Cycle 1: blocked, superseded by a later cycle. Panel: gpt, muse · 2 actionable · 1 warning · 0 conflicts");
  });

  it("labels cycles, panels and recoveries in reading order", () => {
    expect(cycleTitle(cycle({ cycle: 3, lens: "contract" }))).toBe("Cycle 3 · Contract lens");
    expect(panelSummary({ families: [], actionable: null, warnings: 1, conflicts: null, familyFiles: [] })).toBe("Families not recorded · 1 warning");
    expect(recoveryTitle({ base: "0f1e2d3", date: "2026-10-08", kind: "plan", reviews: reviewSet() })).toBe("Recovery from 0f1e2d3 · 2026-10-08 · reopened Plan");
    expect(recoveryTitle({ base: "0f1e2d3", date: null, kind: null, reviews: reviewSet() })).toBe("Recovery from 0f1e2d3");
    expect(reviewsNotes()[0]).toContain("only the latest is current");
    expect(latestCycles(pathData().reviews.current).map((review) => `${review.wave}:${review.cycle}`)).toEqual(["1:2", "2:1"]);
  });

  it("explains absent, empty and unreadable reviews", () => {
    const data = pathData();
    data.reviews = { availability: "absent", current: reviewSet(), recoveries: [], limited: false };
    expect(text(reviewsView(data, true))).toContain("No review folder yet. GSD Path writes reviews during build and ship.");
    data.reviews = { ...data.reviews, availability: "available" };
    expect(text(reviewsView(data))).toContain("No review files are recorded for the current milestone.");
    data.reviews = { ...data.reviews, availability: "unavailable" };
    expect(text(reviewsView(data))).toContain("The review files could not be read safely.");
  });
});

describe("GSD Path questions tab", () => {
  it("lists pending follow-ups with their status, owner and target", () => {
    const content = questionsView();
    for (const expected of ["Pending follow-ups", "A001 · storage account", "Answered 2026-10-05", "Which storage account keeps the invoice files?", "Needs user", "Next owner: user", "Target artifact: .project/intent/INTENT.md",
      "A002", "The question is not safely displayable.", "Final"]) expect(content).toContain(expected);
    expect(questionsNotes()[0]).toContain("An answer is pending while its follow-up is required");
  });

  it("explains no pending answers and no discussion", () => {
    const data = pathData();
    data.questions = { availability: "available", pending: [], counts: { answers: 3, pending: 0, closed: 3 }, limited: false };
    expect(questionsView(data)).toContain("Every recorded answer is closed or needs no follow-up.");
    data.questions = { ...data.questions, availability: "absent" };
    expect(questionsView(data, true)).toContain("GSD Path writes discuss/ANSWERS.md when a discussion records an answer.");
    expect(questionsView(pathData({ setup: "not-started" }))).toContain("No milestone started");
  });
});

const roadmapView = (path: BoardPath = pathData(), usage = usageView(), compact = false) => expand(PathRoadmapView({ state: state(path), usage, theme, compact, onRefresh: vi.fn() }));

describe("GSD Path roadmap tab", () => {
  it("lines up the milestones as shipped, current and to come, with the usage of each", () => {
    const tree = roadmapView();
    const content = text(tree);
    for (const expected of ["1 / 3", "milestones recorded as shipped · 1 active · 1 to come", "$123.45 so far · 1,234 turns",
      "M000", "billing-foundation", "✓", "Shipped Sep 30", "$1.50 · 12 turns",
      "M001", "invoice-evidence", "In build", "An authorized user registers an invoice.", "$124.60 · 1,240 turns", "1 of 4 tasks done · 3 waves · 1.06B tokens", "Depends on M000", "Status · Active",
      "M002", "invoice-validation", "Planning ahead · research"]) expect(content).toContain(expected);
    expect(label(tree, "M000 recorded as shipped, M001")?.props?.accessibilityLabel).toBe("M000 recorded as shipped, M001 current, M002 pending");
    expect(label(tree, "M000 billing-foundation")?.props?.accessibilityLabel).toBe("M000 billing-foundation, recorded as shipped, $1.50 · 12 turns");
    expect(label(tree, "M001 invoice-evidence")?.props?.accessibilityState).toEqual({ expanded: true });
  });

  it("notes usage outside the roadmap, while loading, and for a single-milestone project", () => {
    expect(roadmapNotes(usageView(usageData({ milestones: [{ id: null, turns: 5, tokens: 1_500, cost: 0.25 }] })))).toContain("Usage not tied to a roadmap milestone: $0.25 · 5 turns · 2k tokens.");
    expect(roadmapNotes(usageView(null))).toContain("Usage: Reading host session logs…");
    expect(text(roadmapView())).toContain("Some roadmap milestone entries are ambiguous and were left out.");
    const single = text(roadmapView(pathData({ roadmap: { availability: "absent", milestones: [], counts: { total: 0, shipped: 0, active: 0, pending: 0, abandoned: 0, other: 0 } } }), usageView(), true));
    expect(single).toContain("This project runs one milestone at a time; no program roadmap is recorded.");
    expect(single).toContain("$123.45 · 1,234 turns in this workspace");
  });

  it("lists milestone facts in reading order and where each milestone stands", () => {
    const [shipped, current, next] = pathData().roadmap.milestones;
    expect(milestoneFacts(shipped)).toEqual(["Shipped 2026-09-30", "12 of 12 tasks done", "Integrated commit recorded"]);
    expect(milestoneFacts({ ...current, archived: true })).toEqual(["Depends on M000", "Archive recorded"]);
    expect([shipped, current, next, { ...next, status: "abandoned" }].map(milestoneState)).toEqual(["shipped", "current", "pending", "abandoned"]);
  });
});

const record = { at: "2026-10-01T09:30:15.250Z", agent: "claude · T004 · subagent", host: "claude" as const, model: "claude-sonnet-5-5", tokensIn: 1200, tokensCached: 34000, tokensOut: 450, durationS: 6.5, cost: 0.0123 };
const ledgerView = (usage: UsageViewState, onLoadLedger = vi.fn()) => { const tree = expand(PathLedgerView({ state: state(), usage, theme, onRefresh: vi.fn(), onLoadLedger })); return { tree, content: text(tree), onLoadLedger }; };

describe("GSD Path ledger tab", () => {
  it("shows the daemon's usage figures, loads no turn until asked, then lists turns newest first", () => {
    const idle = ledgerView(usageView());
    // The daemon's ten figures, written the way its dashboard writes them.
    for (const expected of ["Cost$123.45", "Turns1,234", "Prompts1,200", "Tokens in12.3M", "Cached456.7M", "Tokens out2.1M", "Cache hit97%", "Agent time5h 33m", "Cost / turn$0.10", "Time / turn16s",
      "claude-sonnet-5-5", "800", "300.0M", "$50.25", "example-model-1.0", "Load host turn ledger"]) expect(idle.content).toContain(expected);
    (label(idle.tree, "Load host turn ledger")?.props?.onPress as () => void)();
    expect(idle.onLoadLedger).toHaveBeenCalledWith(false);
    const loaded = ledgerView(usageView(usageData(), { ledger: { loaded: true, loading: false, error: null, complete: true, total: 450, records: [record] } }));
    for (const expected of ["Showing 1 of 450 turns, newest first.", "Time", "Agent", "Seconds", "2026-10-01T09:30:15.250Z", "claude · T004 · subagent", "1200", "34000", "450", "6.5", "0.0123", "Load 200 more"]) expect(loaded.content).toContain(expected);
    (label(loaded.tree, "Load 200 more")?.props?.onPress as () => void)();
    expect(loaded.onLoadLedger).toHaveBeenCalledWith(true);
    expect(ledgerNotes().at(-1)).toContain("Input counts new and cache-written tokens");
    expect(idle.content).toContain("No price is configured for example-model-1.0: tokens counted, cost excluded.");
  });

  it("writes turns as the daemon's ledger does", () => {
    expect(ledgerRow(record)).toEqual(["2026-10-01T09:30:15.250Z", "claude · T004 · subagent", "claude", "claude-sonnet-5-5", "1200", "34000", "450", "6.5", "0.0123"]);
    expect(ledgerRow({ ...record, at: null, model: null, durationS: null, cost: null })).toEqual(["—", "claude · T004 · subagent", "claude", "unknown", "1200", "34000", "450", "—", "—"]);
  });

  it("explains an empty ledger and a failed load", () => {
    expect(ledgerView(usageView(usageData(), { ledger: { loaded: true, loading: false, error: null, complete: true, total: 0, records: [] } })).content).toContain("No Claude Code or Codex session recorded a working directory inside this workspace.");
    expect(ledgerView(usageView(usageData(), { ledger: { loaded: false, loading: false, error: "Could not load the host turn ledger.", complete: true, total: 0, records: [] } })).content).toContain("Could not load the host turn ledger.");
  });
});

describe("board look", () => {
  it("tints theme colors without inventing any", () => {
    expect(tint(theme, "#316ec4", 0.12)).toBe("#316ec41f");
    expect(tint({ colors: { ...theme.colors, surface0: "#181b1a" } }, "#316ec4", 0.12)).toBe("#316ec429");
    expect(tint(theme, "#abc", 0.5)).toBe("#aabbcc80");
    expect(tint(theme, "#316ec4ff", 0.12)).toBe("#316ec41f");
    expect(tint(theme, "transparent")).toBe("transparent");
    // A dark accent is lifted to read on a dark surface; a light theme keeps it as it is.
    expect(toneColor({ colors: { ...theme.colors, surface0: "#181b1a", accent: "#20744a" } }, "accent")).toBe("#7eae96");
    expect(toneColor(theme, "accent")).toBe("#316ec4");
    expect(toneColor(theme, "danger")).toBe("#316ec4");
  });

  it("writes relative times", () => {
    const now = Date.parse("2026-10-22T12:00:00.000Z");
    expect(ago("2026-10-22T11:59:30.000Z", now)).toBe("just now");
    expect(ago("2026-10-22T11:48:00.000Z", now)).toBe("12m ago");
    expect(ago("2026-10-22T08:55:00.000Z", now)).toBe("3h 5m ago");
    expect(ago("2026-10-20T12:00:00.000Z", now)).toBe("2d ago");
    expect(ago("2026-10-22", now)).toBe("today");
    expect(ago("2026-10-21", now)).toBe("yesterday");
    expect(ago("2026-10-18", now)).toBe("4 days ago");
    // By the local calendar: early in the morning, yesterday is still yesterday.
    process.env.TZ = "America/Sao_Paulo";
    expect(ago("2026-10-21", Date.parse("2026-10-22T11:00:00.000Z"))).toBe("yesterday");
    process.env.TZ = "UTC";
    expect(ago(null, now)).toBe("never");
  });
});
