import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: vi.fn((value: unknown) => [value, vi.fn()]) };
});

import { BOARD_TABS, PATH_TABS, tabForKey, tabsFor } from "../../client/board-tabs";
import type { BoardViewState } from "../../client/board-components";
import { PathOverviewView } from "../../client/path-overview-components";
import { PathQuestionsView } from "../../client/path-questions-components";
import { ledgerRow, PathLedgerView } from "../../client/path-ledger-components";
import { milestoneFacts, PathRoadmapView } from "../../client/path-roadmap-components";
import { cycleTitle, panelSummary, PathReviewsView, recoveryTitle } from "../../client/path-reviews-components";
import { PathTasksView, taskFacts } from "../../client/path-tasks-components";
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
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Node;
  if (typeof value.type === "function") return expand((value.type as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const usageData = (overrides: Partial<BoardUsage> = {}): BoardUsage => ({ workspaceId: "selected", observedAt: "2026-10-23T00:00:00.000Z", availability: "available", complete: true, limited: false, pricing: "configured", sessions: 43,
  totals: { turns: 1234, prompts: 1200, tokensIn: 12_300_000, tokensCached: 456_700_000, tokensOut: 2_100_000, cost: 123.45, pricedTurns: 1234, durationS: 20_000, timedTurns: 1233 },
  models: [{ model: "claude-sonnet-5-5", host: "claude", turns: 800, tokens: 300_000_000, cost: 50.25 }, { model: "example-model-1.0", host: "claude", turns: 40, tokens: 5_000_000, cost: null }],
  milestones: [{ id: "M001", turns: 1240, tokens: 1_060_000_000, cost: 124.6 }, { id: "M000", turns: 12, tokens: 2_000_000, cost: 1.5 }],
  unpriced: ["example-model-1.0"], ...overrides });
const usageView = (usage: BoardUsage | null = usageData(), overrides: Partial<UsageViewState> = {}): UsageViewState => ({ ...createUsageState(), usage, ...overrides });
const overview = (path?: BoardPath | null, compact = false, usage = usageView()) => text(expand(PathOverviewView({ state: state(path), usage, theme, compact, onRefresh: vi.fn() })));
const tasksView = (path?: BoardPath, compact = false) => expand(PathTasksView({ state: state(path), theme, compact, onRefresh: vi.fn() }));

describe("GSD Path tabs", () => {
  it("lists each pipeline's own tabs, and only Overview before a workspace is read", () => {
    expect(tabsFor(undefined).map((tab) => tab.id)).toEqual(["overview"]);
    expect(tabsFor("gsd-core")).toBe(BOARD_TABS);
    expect(tabsFor("gsd-path").map((tab) => tab.label)).toEqual(["Overview", "Roadmap", "Tasks", "Reviews", "Questions", "Ledger"]);
    expect(tabForKey("overview", "ArrowRight", PATH_TABS)).toBe("roadmap");
    expect(tabForKey("ledger", "ArrowRight", PATH_TABS)).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft", PATH_TABS)).toBe("ledger");
    expect(tabForKey("overview", "End", PATH_TABS)).toBe("ledger");
  });
});

describe("GSD Path overview", () => {
  it("shows recorded state, phase history, task progress, the lookahead milestone and host usage", () => {
    const content = overview();
    for (const expected of [
      "acme-orchestrator", "invoice-evidence", "M001 in the roadmap", "Status: Active", "Pull request", "Project default: Direct", "feature/milestone-001", "Ships onto main",
      "2026-10-09 · Build", "owner ruling on storage: separate bucket", "Some wording was shortened or withheld for safe display.",
      "Recorded pipeline state, not verified by the GSD Path runtime.",
      "Build · Current", "2026-10-06 – 2026-10-08 · entered 2 times", "Phases this milestone has entered, from 12 log entries. Entering a phase is not a passed gate.",
      "1 of 4 tasks recorded done", "25%", "Current wave · 1 · risk burn-down",
      "Planned ahead: Research · Active",
      "Some roadmap milestone entries are ambiguous and were left out.",
      "Wave 2 · cycle 1 · Blocked", "Final review", "2 pending follow-ups",
      // The daemon's ten figures, written the way its dashboard writes them.
      "Cost$123.45", "Turns1,234", "Prompts1,200", "Tokens in12.3M", "Cached456.7M", "Tokens out2.1M", "Cache hit97%", "Agent time5h 33m", "Cost / turn$0.10", "Time / turn16s",
      "claude-sonnet-5-5", "800", "300.0M", "$50.25", "example-model-1.0",
      "No price is configured for example-model-1.0: tokens counted, cost excluded.",
    ]) expect(content).toContain(expected);
    // The roadmap has its own tab now.
    expect(content).not.toContain("M001 · invoice-evidence");
    expect(content).not.toContain("Recorded as shipped");
  });

  it("explains usage that is loading, missing, partial or unpriced", () => {
    expect(overview(pathData(), false, usageView(null))).toContain("Reading host session logs…");
    expect(overview(pathData(), false, usageView(null, { error: "x" }))).toContain("Host usage could not be read.");
    expect(overview(pathData(), false, usageView(usageData({ availability: "none" })))).toContain("No Claude Code or Codex session recorded a working directory inside this workspace.");
    const partial = overview(pathData(), false, usageView(usageData({ complete: false, pricing: "missing", unpriced: [], totals: { ...usageData().totals, cost: null, pricedTurns: 0, timedTurns: 0 } })));
    for (const expected of ["Still reading host session logs; the figures will grow.", "No price table was found in the GSD Path daemon's configuration, so costs are not shown.", "Cost—", "Agent time—", "Cost / turn—"]) expect(partial).toContain(expected);
  });

  it("says shipped and blocked only as recorded", () => {
    const shipped = pathData();
    shipped.state = { ...shipped.state, phase: "shipped", status: "done", shipped: true };
    expect(overview(shipped, true)).toContain("Recorded as shipped. Integration is not verified by this observer.");
    const blocked = pathData();
    blocked.state = { ...blocked.state, status: "blocked" };
    expect(overview(blocked)).toContain("The pipeline is recorded as blocked.");
  });

  it("shows setup notices instead of evidence", () => {
    expect(overview(pathData({ setup: "not-started" }))).toContain("GSD Path is installed in this workspace, but no milestone has written .project/STATE.md yet.");
    expect(overview(pathData({ setup: "unsupported" }))).toContain("The state file names a pipeline format this observer does not read.");
    expect(overview(null)).toContain("Project evidence unavailable");
  });
});

describe("GSD Path tasks", () => {
  it("opens the current wave with its goal and task facts, and flags waves missing from the plan", () => {
    const tree = tasksView();
    const content = text(tree);
    for (const expected of ["Waves from PLAN.md and the task files of the current milestone.", "Wave 1 · risk burn-down · Current", "1 of 2 tasks recorded done", "Prove the storage assumptions first.", "The goal was shortened for safe display.",
      "Pin the runtime version", "Member: web", "Depends on T001", "2 files", "Title not safely displayable", "The file records a different task id; the file name's id is shown.",
      "Wave 3", "Not in PLAN.md", "Some task files record an id that differs from their file name; the file name is shown."]) expect(content).toContain(expected);
    // Only the current wave is expanded.
    expect(content).not.toContain("Supersedes T001");
    const toggles = nodes(tree).filter((node) => node.type === "Pressable" && String(node.props?.accessibilityLabel ?? "").startsWith("Wave "));
    expect(toggles.map((node) => node.props?.accessibilityState)).toEqual([{ expanded: true }, { expanded: false }, { expanded: false }]);
    expect(String(toggles[2].props?.accessibilityLabel)).toContain("Not listed in the plan.");
  });

  it("lists task facts in reading order", () => {
    expect(taskFacts(task({ status: "in-progress", deps: ["T001", "T002"], supersedes: ["T000"], files: 1 }))).toEqual(["In progress", "Member: web", "Depends on T001, T002", "Supersedes T000", "1 file"]);
    expect(taskFacts(task({ status: null, repo: null, files: 0 }))).toEqual(["Status not recorded"]);
  });

  it("explains absent and unreadable tasks", () => {
    const absent = pathData();
    absent.tasks = { ...absent.tasks, availability: "absent", waves: [], counts: { total: 0, done: 0, inProgress: 0, pending: 0, failed: 0, blocked: 0, other: 0 } };
    expect(text(tasksView(absent, true))).toContain("No plan or task files yet. GSD Path writes them in the plan phase.");
    absent.tasks = { ...absent.tasks, availability: "unavailable" };
    expect(text(tasksView(absent))).toContain("The plan and task files could not be read safely.");
  });
});

const reviewsView = (path?: BoardPath, compact = false) => expand(PathReviewsView({ state: state(path), theme, compact, onRefresh: vi.fn() }));
const questionsView = (path?: BoardPath, compact = false) => text(expand(PathQuestionsView({ state: state(path), theme, compact, onRefresh: vi.fn() })));

describe("GSD Path reviews tab", () => {
  it("shows the final review, gaps, plan panel and wave cycles with superseded and failing ones marked", () => {
    const tree = reviewsView();
    const content = text(tree);
    for (const expected of [
      "Overall verdict: Blocked", "SC1 · Invoices are kept immutably", "Met", "SC2 · Criterion not safely displayable", "Not met",
      "Gap 1 · project Verify", "Plan panel", "gpt · 0 actionable · 1 warning · 0 conflicts",
      "Wave 1", "Cycle 1", "Verdict: Blocked", "Superseded by a later cycle", "1 pass · 1 fail", "Failed: T002", "Panel: gpt, muse · 2 actionable · 1 warning · 0 conflicts · family files: gpt, muse",
      "Cycle 2", "3 tasks reviewed", "Cycle 1 · Adversarial lens", "Depth: Deep",
      "Patch findings are recorded in review/PATCH-FINDINGS.md.", "Other review files: reviewer-notes.md",
      "Show 1 review set set aside by build recovery",
    ]) expect(content).toContain(expected);
    // Set-aside reviews stay collapsed until asked for.
    expect(content).not.toContain("Recovery from 0f1e2d3");
    const toggle = nodes(tree).find((node) => node.type === "Pressable" && String(node.props?.accessibilityLabel).includes("set aside by build recovery"));
    expect(toggle?.props?.accessibilityState).toEqual({ expanded: false });
  });

  it("labels cycles, panels and recoveries in reading order", () => {
    expect(cycleTitle(cycle({ cycle: 3, lens: "contract" }))).toBe("Cycle 3 · Contract lens");
    expect(panelSummary({ families: [], actionable: null, warnings: 1, conflicts: null, familyFiles: [] })).toBe("Families not recorded · 1 warning");
    expect(recoveryTitle({ base: "0f1e2d3", date: "2026-10-08", kind: "plan", reviews: reviewSet() })).toBe("Recovery from 0f1e2d3 · 2026-10-08 · reopened Plan");
    expect(recoveryTitle({ base: "0f1e2d3", date: null, kind: null, reviews: reviewSet() })).toBe("Recovery from 0f1e2d3");
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

const roadmapView = (path: BoardPath = pathData(), usage = usageView(), compact = false) => text(expand(PathRoadmapView({ state: state(path), usage, theme, compact, onRefresh: vi.fn() })));

describe("GSD Path roadmap tab", () => {
  it("lists milestones with their recorded status, ship facts and usage", () => {
    const content = roadmapView();
    for (const expected of ["1 of 3 milestones recorded as shipped · 1 active", "M000", "billing-foundation", "Shipped 2026-09-30", "12 of 12 tasks done", "Integrated commit recorded",
      "M001", "invoice-evidence · Current", "An authorized user registers an invoice.", "Depends on M000", "Active", "$124.60 · 1,240 turns", "1.06B tokens", "$1.50 · 12 turns", "2.0M tokens",
      "Usage dated on or before a milestone's ship date counts toward it"]) expect(content).toContain(expected);
    expect(content).toContain("invoice-validation");
    expect(content).not.toContain("Usage not tied to a roadmap milestone");
  });

  it("reports usage outside the roadmap, while loading, and for a single-milestone project", () => {
    expect(roadmapView(pathData(), usageView(usageData({ milestones: [{ id: null, turns: 5, tokens: 1_500, cost: 0.25 }] })))).toContain("Usage not tied to a roadmap milestone: $0.25 · 5 turns · 2k tokens.");
    expect(roadmapView(pathData(), usageView(null))).toContain("Usage: Reading host session logs…");
    const single = roadmapView(pathData({ roadmap: { availability: "absent", milestones: [], counts: { total: 0, shipped: 0, active: 0, pending: 0, abandoned: 0, other: 0 } } }), usageView(), true);
    expect(single).toContain("This project runs a single milestone; no program roadmap is recorded.");
    expect(single).toContain("Usage in this workspace: $123.45 · 1,234 turns · 471.1M tokens.");
  });

  it("lists milestone facts in reading order", () => {
    const [shipped, current] = pathData().roadmap.milestones;
    expect(milestoneFacts(shipped)).toEqual(["Shipped 2026-09-30", "12 of 12 tasks done", "Integrated commit recorded"]);
    expect(milestoneFacts({ ...current, archived: true })).toEqual(["Depends on M000", "Archive recorded"]);
  });
});

const record = { at: "2026-10-01T09:30:15.250Z", agent: "claude · T004 · subagent", host: "claude" as const, model: "claude-sonnet-5-5", tokensIn: 1200, tokensCached: 34000, tokensOut: 450, durationS: 6.5, cost: 0.0123 };
const ledgerView = (usage: UsageViewState, onLoadLedger = vi.fn()) => { const tree = expand(PathLedgerView({ state: state(), usage, theme, onRefresh: vi.fn(), onLoadLedger })); return { tree, content: text(tree), onLoadLedger }; };

describe("GSD Path ledger tab", () => {
  it("loads nothing until asked, then lists turns newest first with a way to load more", () => {
    const idle = ledgerView(usageView());
    expect(idle.content).toContain("Load host turn ledger");
    const load = nodes(idle.tree).find((node) => node.props?.accessibilityLabel === "Load host turn ledger");
    (load?.props?.onPress as () => void)();
    expect(idle.onLoadLedger).toHaveBeenCalledWith(false);
    const loaded = ledgerView(usageView(usageData(), { ledger: { loaded: true, loading: false, error: null, complete: true, total: 450, records: [record] } }));
    for (const expected of ["Showing 1 of 450 turns, newest first.", "Time", "Agent", "Seconds", "2026-10-01T09:30:15.250Z", "claude · T004 · subagent", "1200", "34000", "450", "6.5", "0.0123", "Load 200 more"]) expect(loaded.content).toContain(expected);
    const more = nodes(loaded.tree).find((node) => node.props?.accessibilityLabel === "Load 200 more");
    (more?.props?.onPress as () => void)();
    expect(loaded.onLoadLedger).toHaveBeenCalledWith(true);
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
