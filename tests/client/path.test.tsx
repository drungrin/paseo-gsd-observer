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
import { cycleTitle, panelSummary, PathReviewsView, recoveryTitle } from "../../client/path-reviews-components";
import { PathTasksView, taskFacts } from "../../client/path-tasks-components";
import type { BoardPath, PathReviewSet, PathTask, PathWaveReview } from "../../shared/path";

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
  roadmap: { availability: "available", counts: { total: 2, shipped: 0, active: 1, pending: 1, abandoned: 0, other: 0 }, milestones: [
    { id: "M001", slug: "invoice-evidence", status: "active", goal: "An authorized user registers an invoice.", depends: [], archived: false, integrated: false, current: true },
    { id: "M002", slug: "invoice-validation", status: "pending", goal: null, depends: ["M001"], archived: false, integrated: false, current: false },
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
const overview = (path?: BoardPath | null, compact = false) => text(expand(PathOverviewView({ state: state(path), theme, compact, onRefresh: vi.fn() })));
const tasksView = (path?: BoardPath, compact = false) => expand(PathTasksView({ state: state(path), theme, compact, onRefresh: vi.fn() }));

describe("GSD Path tabs", () => {
  it("lists each pipeline's own tabs, and only Overview before a workspace is read", () => {
    expect(tabsFor(undefined).map((tab) => tab.id)).toEqual(["overview"]);
    expect(tabsFor("gsd-core")).toBe(BOARD_TABS);
    expect(tabsFor("gsd-path").map((tab) => tab.label)).toEqual(["Overview", "Tasks", "Reviews", "Questions"]);
    expect(tabForKey("overview", "ArrowRight", PATH_TABS)).toBe("tasks");
    expect(tabForKey("questions", "ArrowRight", PATH_TABS)).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft", PATH_TABS)).toBe("questions");
    expect(tabForKey("overview", "End", PATH_TABS)).toBe("questions");
  });
});

describe("GSD Path overview", () => {
  it("shows recorded state, phase history, task progress, the lookahead milestone and the roadmap", () => {
    const content = overview();
    for (const expected of [
      "acme-orchestrator", "invoice-evidence", "M001 in the roadmap", "Status: Active", "Pull request", "Project default: Direct", "feature/milestone-001", "Ships onto main",
      "2026-10-09 · Build", "owner ruling on storage: separate bucket", "Some wording was shortened or withheld for safe display.",
      "Recorded pipeline state, not verified by the GSD Path runtime.",
      "Build · Current", "2026-10-06 – 2026-10-08 · entered 2 times", "Phases this milestone has entered, from 12 log entries. Entering a phase is not a passed gate.",
      "1 of 4 tasks recorded done", "25%", "Current wave · 1 · risk burn-down",
      "Planned ahead: Research · Active",
      "0 of 2 milestones recorded as shipped", "M001 · invoice-evidence · Current", "Depends on M001",
      "Some roadmap milestone entries are ambiguous and were left out.",
      "Wave 2 · cycle 1 · Blocked", "Final review", "2 pending follow-ups",
    ]) expect(content).toContain(expected);
    expect(content).not.toContain("Recorded as shipped");
  });

  it("says shipped and blocked only as recorded, and explains a single-milestone project", () => {
    const shipped = pathData({ roadmap: { availability: "absent", milestones: [], counts: { total: 0, shipped: 0, active: 0, pending: 0, abandoned: 0, other: 0 } } });
    shipped.state = { ...shipped.state, phase: "shipped", status: "done", shipped: true };
    const content = overview(shipped, true);
    expect(content).toContain("Recorded as shipped. Integration is not verified by this observer.");
    expect(content).toContain("This project runs a single milestone; no program roadmap is recorded.");
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
