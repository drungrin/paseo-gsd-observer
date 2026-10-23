import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>()));

import { expand } from "../helpers/react-native-mock";
import { BoardTabs, tabForKey } from "../../client/board-tabs";
import { liveStatus, type WorkspaceAgent } from "../../client/board-frame";
import { coreNeeds, coreOverviewAlerts, coreOverviewNotes, OverviewView, phaseStations, planCountLabel, statusLabel } from "../../client/overview-components";
import { phaseStages, stagesLabel } from "../../client/phase-checks";
import type { BoardOverview } from "../../shared/overview";
import type { BoardUatPhase } from "../../shared/uat";
import type { BoardVerificationPhase } from "../../shared/verification";
import type { BoardValidationPhase } from "../../shared/validation";
import type { DebugSession } from "../../shared/debug";
import type { BoardViewState } from "../../client/board-components";
import { phaseChecks } from "../helpers/phase-checks";

const theme = { colors: { surface0: "#ffffff", surface1: "#f9fafb", surface2: "#f0f2f5", foreground: "#16181d", foregroundMuted: "#56606d", accent: "#2a78d6", accentForeground: "#ffffff", border: "#d9dfe6" } };
type RoadmapPhase = BoardOverview["roadmap"]["phases"][number];
const overview = (): BoardOverview => ({
  state: { availability: "available", milestone: "v2.0", milestoneName: "Contract management", phaseId: "59.3", phaseName: "Independent registrations and explicit confirmation", status: "Executing Phase 59.3", plan: "17 of 24", lastActivity: "2026-09-24 — resumed execution", updatedAt: "2026-09-25T01:33:27.753Z" },
  roadmap: { availability: "available", completedPhases: 2, totalPhases: 5, percent: 40, phases: [
    { id: "59.1", title: "Contract intake", completed: true, current: false, completedPlans: 4, totalPlans: 4, percent: 100 },
    { id: "59.2", title: "Contract foundation", completed: true, current: false, completedPlans: 6, totalPlans: 6, percent: 100 },
    { id: "59.3", title: "Contract management", completed: false, current: true, completedPlans: 18, totalPlans: 24, percent: 75 },
    { id: "60", title: "Billing", completed: false, current: false, completedPlans: 0, totalPlans: null, percent: null },
    { id: "61", title: "Reporting", completed: false, current: false, completedPlans: null, totalPlans: null, percent: null },
  ] },
  requirements: { availability: "available", completed: 15, total: 41, percent: 37, mapped: 41 },
  plans: { availability: "available", observedPlans: 4, observedSummaries: 2, limited: false, phases: [
    { id: "59.2", title: "Contract foundation", current: false, declaredPlans: 6, entries: [], checks: phaseChecks() },
    { id: "59.3", title: "Contract management", current: true, declaredPlans: 24, entries: [
      { id: "59.3-23", number: "23", title: "Supplier regression", objective: "Exercise existing supplier flows.", wave: 11, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-17", number: "17", title: "Independent registry help", objective: "Update the six help guides.", wave: 14, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-18", number: "18", title: "Browser certification", objective: "Validate the browser journeys.", wave: 15, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-24", number: "24", title: null, objective: null, wave: 17, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
    ], checks: phaseChecks(true) },
    { id: "60", title: "Billing", current: false, declaredPlans: null, entries: [], checks: phaseChecks() },
  ] },
  context: { availability: "available", phases: [], limited: false },
  validation: { availability: "available", phases: [], limited: false },
  uat: { availability: "available", phases: [], limited: false },
  verification: { availability: "available", phases: [], limited: false },
  todos: { availability: "available", directoryState: "absent", countsComplete: true, items: [], counts: { pending: 0, backlog: 0, deferred: 0, done: 0, completed: 0, root: 0, totalFiles: 0, distinctTasks: 0, unavailable: 0, duplicates: 0, conflicts: 0, displayed: 0 }, limited: false },
  parkingLot: { availability: "available", section: "absent", items: [], counts: { recorded: 0, parked: 0, absorbed: 0, promoted: 0, reconciliation: 0, other: 0, displayed: 0 }, limited: false },
  debug: { availability: "available", directoryState: "absent", archiveState: "absent", sessions: [], countsComplete: true, limited: false, counts: { active: 0, archived: 0, attention: 0, unresolved: 0, open: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 0, unclassified: 0, reconciliation: 0, unavailable: 0, knowledgeBase: 0, notes: 0, displayed: 0 } },
  warnings: [],
});
/** What the daemon sends for each document it could not read (server/overview.ts empty shapes). */
const unreadableState = (): BoardOverview["state"] => ({ availability: "unavailable", milestone: null, milestoneName: null, phaseId: null, phaseName: null, status: null, plan: null, lastActivity: null, updatedAt: null });
const unreadableRoadmap = (): BoardOverview["roadmap"] => ({ availability: "unavailable", phases: [], completedPhases: 0, totalPhases: 0, percent: null });
const unreadableRequirements = (): BoardOverview["requirements"] => ({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
const state = (value: BoardOverview | undefined = overview()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: { workspaceId: "selected", observedAt: "2026-09-25T01:34:00.000Z", freshness: "current", availability: "unknown", revision: 1, warnings: [], limited: false, overview: value } });

const uatPhase = (id: string, results: Partial<BoardUatPhase["results"]> = {}, overrides: Partial<BoardUatPhase> = {}): BoardUatPhase => ({
  id, title: `Phase ${id}`, current: false, observation: "observed", recordedStatus: "testing", startedAt: null, updatedAt: null, currentTest: null, testCount: 2,
  results: { pass: 2, issue: 0, pending: 0, skipped: 0, blocked: 0, other: 0, ...results }, sources: { automated: 2, human: 0, evidence: 0, other: 0, unrecorded: 0 },
  resolvedIssues: 0, gapCount: 0, openGapCount: 0, tests: [], summary: null, records: [], otherSections: [], excerptsLimited: false, ...overrides,
});
const verificationPhase = (id: string, overrides: Partial<BoardVerificationPhase> = {}): BoardVerificationPhase => ({
  id, title: `Phase ${id}`, current: false, observation: "observed", recordedStatus: "passed", statusKind: "passed", bodyStatus: null, verifiedAt: null, disposedAt: null, score: null,
  behaviorUnverified: null, overridesApplied: null, reVerification: null, gapCount: 0, openGapCount: 0, gaps: [], humanCount: 0, openHumanCount: 0, recordedHumanCount: 0, humanChecks: [],
  humanClosed: null, humanNote: null, behaviorCount: 0, behaviorItems: [], overrideCount: 0, overrides: [], coincidentalCount: 0, deferredCount: 0, decisionCoverage: null,
  truthTables: [], checks: [], gapsSummary: null, laterSections: [], otherFields: [], otherSections: [], excerptsLimited: false, ...overrides,
});
const validationPhase = (id: string, overrides: Partial<BoardValidationPhase> = {}): BoardValidationPhase => ({
  id, title: `Phase ${id}`, current: false, observation: "observed", recordedStatus: "validated", nyquistCompliant: true, wave0Complete: null, createdAt: null, updatedAt: null,
  otherStatuses: [], infrastructure: [], tables: [], manualNote: null, wave0: null, signOff: null, audits: [], auditCount: 0, sections: [], excerptsLimited: false, ...overrides,
});
const session = (statusKind: DebugSession["statusKind"]): DebugSession => ({
  id: "a1b2c3d4e5f6", location: "active", slug: "login-fails", title: null, statusKind, recordedStatus: null, goal: null, bugClass: null, phaseId: null, createdAt: null, updatedAt: null, resolvedAt: null,
  notes: [], trigger: null, expected: null, actual: null, hypothesis: null, nextAction: null, rootCause: null, fix: null, verification: null, verificationStructured: false,
  evidenceCount: null, eliminatedCount: null, filesChangedCount: null, detailsWithheld: false, excerptsLimited: false,
});
/** A milestone where UAT, verification, validation and debug each have something waiting on a person. */
const needy = (): BoardOverview => {
  const data = overview();
  data.uat.phases = [uatPhase("58"), uatPhase("59.1", { pass: 1, issue: 1 }), uatPhase("59.3", { pass: 1, pending: 1 }, { current: true })];
  data.verification.phases = [verificationPhase("59.1"), verificationPhase("59.2", { recordedStatus: "gaps_found", statusKind: "gaps_found", gapCount: 1, openGapCount: 1 })];
  data.validation.phases = [validationPhase("16", { recordedStatus: "draft", nyquistCompliant: false }), validationPhase("17")];
  data.debug.sessions = [session("open"), session("diagnosed"), session("resolved")];
  data.debug.counts = { ...data.debug.counts, active: 3, unresolved: 2, open: 1, diagnosed: 1, resolved: 1 };
  return data;
};
const roadmapOf = (count: number, current: number): BoardOverview["roadmap"] => {
  const phases: RoadmapPhase[] = Array.from({ length: count }, (_, index) => ({ id: String(index + 1), title: `Step ${index + 1}`, completed: index < current, current: index === current,
    completedPlans: index < current ? 2 : 0, totalPlans: index <= current ? 2 : null, percent: index < current ? 100 : index === current ? 0 : null }));
  const completed = Math.max(0, Math.min(current, count));
  return { availability: "available", phases, completedPhases: completed, totalPhases: count, percent: Math.round(completed / count * 100) };
};

type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const labelled = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));
const labels = (tree: unknown) => nodes(tree).map((node) => node.props?.accessibilityLabel).filter((value): value is string => typeof value === "string");
const stat = (tree: unknown, name: string) => labelled(tree, `${name}: `)?.props?.accessibilityLabel;
const progressbars = (tree: unknown) => nodes(tree).filter((node) => node.props?.role === "progressbar").map((node) => (node.props?.accessibilityValue as { now: number }).now);
const phaseRows = (tree: unknown) => nodes(nodes(tree).find((node) => node.props?.accessibilityLabel === "Phase plan progress")).filter((node) => node.props?.role === "listitem");
const view = ({ data = overview() as BoardOverview | undefined, viewState = state(data), compact = false, showTable = false, agent = null as WorkspaceAgent, onToggleTable = vi.fn(), onRefresh = vi.fn() } = {}) => {
  const onNavigate = vi.fn();
  const tree = expand(OverviewView({ state: viewState, theme, onRefresh, compact, showTable, onToggleTable, agent, onNavigate }));
  return { tree, content: text(tree), onNavigate, onToggleTable, onRefresh };
};

describe("Overview", () => {
  it("leads with the milestone, its current phase, the roadmap as stations and the current phase's stages", () => {
    const { tree, content } = view();
    for (const expected of [
      "Overview", "Where this milestone stands, what needs you, and how far each phase has come.",
      "v2.0  ·  Contract management  ·  phase 3 of 5", "Phase 59.3 · Independent registrations and explicit confirmation", "Executing", "Plan: 17 of 24",
      "Milestone phases", "Phase 59.3 so far", "40%", "2 of 5 phases\nmarked complete", "2 complete", "phase 59.3 current", "2 ahead", "Phase 59.3: 2 of 24 plans with a summary",
    ]) expect(content).toContain(expected);
    expect(content).not.toContain("Milestone phases · ");
    // The roadmap's own checkmarks, one station per phase, read out in full.
    expect(labelled(tree, "Phases.")?.props?.accessibilityLabel).toBe("Phases. 59.1: complete; 59.2: complete; 59.3: current; 60: not started; 61: not started");
    expect(labelled(tree, "2 phases marked complete")?.props?.accessibilityLabel).toBe("2 phases marked complete, 1 current, 2 ahead");
    // The current phase's stages come from the files each stage left: execute is next, not done, with 2 of 24 summaries.
    expect(labelled(tree, "Phase 59.3 stages.")?.props?.accessibilityLabel).toBe("Phase 59.3 stages. discuss: observed; research: observed; plan: observed, 4 plans; execute: next, 2/24 summaries; verify: ahead");
    expect(content).not.toContain("Current roadmap");
    expect(content).not.toContain("No observable GSD planning");
  });

  it("shows the headline figures, the latest state, requirements and the roadmap as separate sources", () => {
    const { tree, content } = view();
    expect([stat(tree, "Requirements"), stat(tree, "Phases"), stat(tree, "Plan summaries"), stat(tree, "TODOs"), stat(tree, "Debug")]).toEqual([
      "Requirements: 15/41, 37% marked complete", "Phases: 2/5, 40% marked complete", "Plan summaries: 2, of 4 plan files observed", "TODOs: 0, pending · 0 in backlog", "Debug: 0, not resolved · 0 session files",
    ]);
    for (const expected of [
      "STATE.mdLatest", "2026-09-24 — resumed execution", "Milestone · v2.0", "Status · Executing",
      "REQUIREMENTS.mdRequirements", "15 of 41 marked complete · 26 pending · 41 of 41 mapped to phases",
      "ROADMAP.mdRoadmap",
    ]) expect(content).toContain(expected);
    expect(labelled(tree, "15 of 41 requirements")?.props?.accessibilityLabel).toBe("15 of 41 requirements marked complete");
    expect(content.indexOf("STATE.mdLatest")).toBeLessThan(content.indexOf("REQUIREMENTS.mdRequirements"));
    expect(content.indexOf("REQUIREMENTS.mdRequirements")).toBeLessThan(content.indexOf("ROADMAP.mdRoadmap"));
    // Each phase keeps its declared plan progress; a TBD total is not a zero and an undeclared one is said as such.
    expect(phaseRows(tree).map(text)).toEqual([
      "✓  59.1  Contract intake100%4 / 4 plans · Complete",
      "✓  59.2  Contract foundation100%6 / 6 plans · Complete",
      "●  59.3  Contract management75%18 / 24 plans · Current",
      "○  60  Billing—0 plans completed · total TBD · Not started",
      "○  61  Reporting—Plans not declared · Not started",
    ]);
    // Only an open phase with a known percentage gets a bar; unknown percentages get none.
    expect(progressbars(tree)).toEqual([75]);
    expect(labelled(tree, "Phase 59.3:")?.props?.accessibilityLabel).toBe("Phase 59.3: 18 / 24 plans, 75%");
  });

  it("keeps State and Roadmap availability independent", () => {
    const data = overview();
    data.state = unreadableState();
    data.warnings = ["state-unavailable"];
    let { tree, content } = view({ data });
    expect(content).toContain("No readable project state was found. Roadmap progress can still be shown independently.");
    expect(content).toContain("State could not be read.");
    expect(content).toContain("Phase not recorded");
    expect(content).not.toContain("Phase 59.3 · ");
    expect(content).toContain("40%");
    expect(content).toContain("2 of 5 phases\nmarked complete");
    expect(stat(tree, "Phases")).toBe("Phases: 2/5, 40% marked complete");

    const second = overview();
    second.roadmap = unreadableRoadmap();
    second.warnings = ["roadmap-unavailable"];
    ({ tree, content } = view({ data: second }));
    expect(content).toContain("No readable phase checklist was found. State remains available independently.");
    expect(content).toContain("Roadmap could not be read.");
    expect(content).toContain("Phase 59.3 · Independent registrations and explicit confirmation");
    expect(content).toContain("v2.0  ·  Contract management");
    expect(content).not.toContain("phase 3 of 5");
    expect(content).not.toContain("Milestone phases");
    expect(content).not.toContain("40%");
    expect(content).not.toContain("phases\nmarked complete");
    expect(stat(tree, "Phases")).toBe("Phases: —");
    expect(labelled(tree, "Phases.")).toBeUndefined();
    expect(labelled(tree, "Show the roadmap as")).toBeUndefined();
  });

  it("keeps requirements independent and avoids percentages for unavailable or empty checklists", () => {
    const data = overview();
    data.requirements = unreadableRequirements();
    let { tree, content } = view({ data });
    expect(content).toContain("No readable current-milestone requirements checklist was found.");
    expect(stat(tree, "Requirements")).toBe("Requirements: —, Not shown");
    expect(labels(tree).some((value) => value.includes("requirements marked complete"))).toBe(false);
    expect(content).toContain("40%");
    expect(progressbars(tree)).toEqual([75]);

    data.requirements = { availability: "available", completed: 0, total: 0, percent: null, mapped: null };
    ({ tree, content } = view({ data }));
    expect(content).toContain("No requirements declared for this milestone.");
    expect(stat(tree, "Requirements")).toBe("Requirements: 0/0, None declared");
    expect(content).not.toContain("0 of 0 marked complete");
    expect(labels(tree).some((value) => value.includes("requirements marked complete"))).toBe(false);
    expect(progressbars(tree)).toEqual([75]);
  });

  it("provides a text data view with the same values and no progress marks", () => {
    const chart = view();
    const table = view({ showTable: true });
    const grid = labelled(table.tree, "Roadmap progress data table");
    expect(grid?.props?.role).toBe("table");
    const rows = nodes(grid).filter((node) => node.props?.role === "row");
    expect(rows).toHaveLength(6);
    expect(nodes(rows[0]).filter((node) => node.props?.role === "columnheader").map(text)).toEqual(["Phase", "Plans", "Status", "Progress"]);
    const cells = rows.slice(1).map((row) => nodes(row).filter((node) => node.props?.role === "rowheader" || node.props?.role === "cell").map(text));
    expect(cells).toEqual([
      ["59.1 · Contract intake", "4 / 4 plans", "Complete", "100%"],
      ["59.2 · Contract foundation", "6 / 6 plans", "Complete", "100%"],
      ["59.3 · Contract management", "18 / 24 plans", "Current", "75%"],
      ["60 · Billing", "0 plans completed · total TBD", "Not started", "—"],
      ["61 · Reporting", "Plans not declared", "Not started", "—"],
    ]);
    // The chart rows carry the same values as the table.
    const chartRows = phaseRows(chart.tree).map(text);
    cells.forEach(([, plans, status, progress], index) => {
      for (const value of [plans, status, progress]) expect(chartRows[index]).toContain(value);
    });
    expect(phaseRows(table.tree)).toEqual([]);
    expect(progressbars(table.tree)).toEqual([]);
    // The toggle reports a change only when the other view is picked.
    const radios = nodes(labelled(table.tree, "Show the roadmap as")).filter((node) => node.props?.accessibilityRole === "radio");
    expect(radios.map((radio) => [radio.props?.accessibilityLabel, (radio.props?.accessibilityState as { selected: boolean }).selected])).toEqual([["Chart", false], ["Table", true]]);
    (radios[1].props?.onPress as () => void)();
    expect(table.onToggleTable).not.toHaveBeenCalled();
    (radios[0].props?.onPress as () => void)();
    expect(table.onToggleTable).toHaveBeenCalledOnce();
  });

  it("folds a long opening run of completed phases behind one line, and never in the table", () => {
    const data = overview();
    data.roadmap = roadmapOf(6, 4);
    const folded = view({ data });
    const button = labelled(folded.tree, "Show 4 completed phases");
    expect(button?.props?.accessibilityRole).toBe("button");
    expect(button?.props?.accessibilityState).toEqual({ expanded: false });
    expect(text(button)).toBe("✓  1–4 · 4 phases complete  ▸");
    expect(phaseRows(folded.tree).map(text)).toEqual(["●  5  Step 50%0 / 2 plans · Current", "○  6  Step 6—0 plans completed · total TBD · Not started"]);
    expect(nodes(labelled(view({ data, showTable: true }).tree, "Roadmap progress data table")).filter((node) => node.props?.role === "row")).toHaveLength(7);

    data.roadmap = roadmapOf(6, 3);
    const short = view({ data });
    expect(labels(short.tree).some((value) => /completed phase/.test(value))).toBe(false);
    expect(phaseRows(short.tree)).toHaveLength(6);

    data.roadmap = roadmapOf(5, 5);
    expect(text(labelled(view({ data }).tree, "Show 5 completed phases"))).toBe("✓  1–5 · 5 phases complete  ▸");
  });

  it("holds existing content during refresh and labels stale evidence", () => {
    const current = state();
    current.busy = true;
    current.error = "refresh failed";
    current.snapshot!.freshness = "stale";
    current.refreshAnnouncement = "Overview refreshed.";
    const { tree, content } = view({ viewState: current });
    expect(content).toContain("40%");
    expect(content).toContain("Could not refresh overview. The last snapshot is still displayed.");
    expect(content).toContain("Overview refreshed.");
    expect(liveStatus(current)).toMatchObject({ tone: "danger", label: "Out of date", live: false });
    expect(content).toContain("Out of date");
    const refresh = labelled(tree, "Refreshing overview");
    expect(refresh?.props?.disabled).toBe(true);

    const stale = state();
    stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale)).toMatchObject({ tone: "warning", label: "Files changed · updating" });
    expect(view({ viewState: stale }).content).toContain("Files changed · updating");
    const failed = state();
    failed.snapshot!.freshness = "refresh-failed";
    expect(liveStatus(failed)).toMatchObject({ tone: "danger", label: "Out of date" });
    expect(view({ viewState: failed }).content).toContain("Out of date");
    expect(liveStatus(state())).toMatchObject({ tone: "success", live: true });
  });

  it("handles first load, no planning, and explicit refresh without manufacturing progress", () => {
    const onRefresh = vi.fn();
    const empty: BoardViewState = { workspaceId: "empty", snapshot: null, busy: true, error: null };
    expect(view({ viewState: empty }).content).toContain("Loading overview…");
    const idle = view({ viewState: { ...empty, busy: false }, onRefresh });
    expect(idle.content).toContain("Project evidence unavailable");
    expect(idle.content).toContain("No readable planning state was found for this workspace.");
    expect(idle.content).not.toContain("%");
    (labelled(idle.tree, "Refresh overview")?.props?.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(view({ viewState: { ...empty, busy: false, error: "unreachable" } }).content).toContain("Could not refresh overview. Try refreshing again.");

    // Every document unreadable: dashes, never a zero or a percentage.
    const data = overview();
    data.state = unreadableState();
    data.roadmap = unreadableRoadmap();
    data.requirements = unreadableRequirements();
    data.plans = { availability: "unavailable", phases: [], observedPlans: 0, observedSummaries: 0, limited: false };
    data.todos = { ...data.todos, availability: "unavailable" };
    data.debug = { ...data.debug, availability: "unavailable" };
    const { tree, content } = view({ data });
    expect([stat(tree, "Requirements"), stat(tree, "Phases"), stat(tree, "Plan summaries"), stat(tree, "TODOs"), stat(tree, "Debug")]).toEqual([
      "Requirements: —, Not shown", "Phases: —", "Plan summaries: —", "TODOs: —", "Debug: —",
    ]);
    expect(content).not.toContain("%");
    expect(content).not.toContain("0/0");
    expect(content).toContain("Phase not recorded");
    expect(content).not.toContain(" so far");
  });

  it("stacks columns in compact layouts and discloses conflicting counts", () => {
    const data = overview();
    data.warnings = ["plan-count-conflict"];
    const { tree, content } = view({ data, compact: true });
    const columns = nodes(tree).find((node) => (node.props?.style as { gap?: number })?.gap === 16 && nodes(node).some((child) => child.props?.accessibilityLabel === "Phase plan progress"));
    expect(columns?.props?.style).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
    expect(nodes(view({ data }).tree).find((node) => (node.props?.style as { gap?: number })?.gap === 16 && nodes(node).some((child) => child.props?.accessibilityLabel === "Phase plan progress"))?.props?.style).toMatchObject({ flexDirection: "row" });
    expect(content).toContain("Some roadmap plan counts disagree. Conflicting plan percentages are not shown.");
    expect(content.indexOf("STATE.mdLatest")).toBeLessThan(content.indexOf("REQUIREMENTS.mdRequirements"));
    expect(content.indexOf("REQUIREMENTS.mdRequirements")).toBeLessThan(content.indexOf("ROADMAP.mdRoadmap"));
    expect(labelled(tree, "Phase 59.3 stages.")?.props?.accessibilityLabel).toContain("execute: next, 2/24;");
    expect(statusLabel(null)).toBe("Not recorded");
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("Verifying phase 3")).toBe("Verifying");
    expect(statusLabel("complete")).toBe("Complete");
    expect(statusLabel("awaiting_review")).toBe("awaiting review");
    expect(planCountLabel({ ...data.roadmap.phases[3], completedPlans: null })).toBe("Plans not declared");
    expect(planCountLabel({ ...data.roadmap.phases[3], completedPlans: null, totalPlans: 5 })).toBe("— / 5 plans");
  });

  it("names every evidence warning in visible copy and folds the caveats", () => {
    expect(coreOverviewAlerts(undefined)).toEqual([]);
    expect(coreOverviewAlerts(overview())).toEqual([]);
    expect(coreOverviewAlerts({ ...overview(), warnings: ["roadmap-limited", "requirements-trace-conflict", "phase-not-in-roadmap"] })).toEqual([
      "Only part of the roadmap could be read; overall progress is not shown.",
      "The requirements checklist and phase mapping disagree; affected values are withheld.",
      "The phase recorded in State is not listed in this roadmap.",
    ]);
    const warnings: BoardOverview["warnings"] = ["state-unavailable", "roadmap-unavailable", "state-malformed", "roadmap-malformed", "roadmap-limited", "plan-count-conflict", "phase-not-in-roadmap",
      "requirements-unavailable", "requirements-malformed", "requirements-scope-unknown", "requirements-trace-conflict", "requirements-limited"];
    const copy = coreOverviewAlerts({ ...overview(), warnings });
    expect(copy).toHaveLength(warnings.length);
    expect(copy.every((line) => typeof line === "string" && line.length > 0)).toBe(true);

    const notes = coreOverviewNotes();
    expect(notes).toContain("Recorded planning state, not live execution status. Phase stages come from the files each stage leaves; an observed file is not a passed gate.");
    expect(notes).toContain("Phase progress is based on roadmap checkboxes, not a verification verdict. Each phase shows its declared plan progress; TBD totals are not treated as zero.");
    expect(notes).toContain("Requirements show checklist status only, not independent verification of product behavior.");
    expect(notes.join(" ")).toContain("not read from the project files");
    // Folded until asked for: the notes are not in the tree, the control to open them is.
    const { tree, content } = view();
    for (const note of notes) expect(content).not.toContain(note);
    expect(labelled(tree, "About these figures")?.props?.accessibilityState).toEqual({ expanded: false });
  });
});

describe("Overview stations", () => {
  it("shows every phase of a short roadmap and a window around the current phase of a long one", () => {
    const short = phaseStations(overview().roadmap);
    expect(short.shown).toBe(5);
    expect(short.stations).toEqual([
      { key: "59.1", label: "59.1", state: "done", detail: "4/4" },
      { key: "59.2", label: "59.2", state: "done", detail: "6/6" },
      { key: "59.3", label: "59.3", state: "current", detail: "18/24" },
      { key: "60", label: "60", state: "future", detail: null },
      { key: "61", label: "61", state: "future", detail: null },
    ]);
    const ids = (roadmap: BoardOverview["roadmap"], limit?: number) => phaseStations(roadmap, limit).stations.map((station) => station.key);
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
    // A third of the window before the current phase, clamped to either end.
    expect(ids(roadmapOf(20, 10))).toEqual(range(5, 20));
    expect(ids(roadmapOf(20, 2))).toEqual(range(1, 16));
    expect(ids(roadmapOf(20, 19))).toEqual(range(5, 20));
    expect(ids(roadmapOf(20, 10), 7)).toEqual(range(9, 15));
    expect(phaseStations(roadmapOf(20, 10), 7).stations.find((station) => station.state === "current")?.key).toBe("11");
    expect(ids(roadmapOf(20, 30))).toEqual(range(1, 16));
    expect(phaseStations(roadmapOf(20, 10)).shown).toBe(16);
    expect(phaseStations(unreadableRoadmap())).toEqual({ stations: [], shown: 0 });
  });

  it("says how many phases a window shows while describing them all", () => {
    const data = overview();
    data.roadmap = roadmapOf(20, 10);
    const wide = view({ data });
    expect(wide.content).toContain("Milestone phases · 16 of 20");
    const track = String(labelled(wide.tree, "Phases.")?.props?.accessibilityLabel);
    expect(track).toContain("1: complete;");
    expect(track).toContain("11: current;");
    expect(track).toMatch(/20: not started$/);
    expect(view({ data, compact: true }).content).toContain("Milestone phases · 7 of 20");
  });

  it("builds the hero stage track from the files the current phase left", () => {
    const phase = overview().plans.phases[1];
    const stages = phaseStages(phase);
    expect(stages.map((stage) => [stage.key, stage.state, stage.detail])).toEqual([
      ["discuss", "done", null], ["research", "done", null], ["plan", "done", "4 plans"], ["execute", "current", "2/24 summaries"], ["verify", "future", null],
    ]);
    expect(stagesLabel(phase, stages)).toBe("Phase 59.3 stages. discuss: observed; research: observed; plan: observed, 4 plans; execute: next, 2/24 summaries; verify: ahead");
  });
});

describe("Overview needs", () => {
  it("says calmly when nothing waits on a person", () => {
    expect(coreNeeds(overview())).toEqual([]);
    const { content } = view();
    expect(content).toContain("Nothing needs you right now");
    expect(content).toContain("No UAT issue, verification gap, validation escalation or open debug session is recorded, and no agent is waiting for input.");
  });

  it("puts an agent waiting for input first, then one line per kind of evidence, then open debug sessions", () => {
    const needs = coreNeeds(needy(), { status: "needs_input", since: null });
    expect(needs).toEqual([
      { tone: "warning", title: "An agent in this workspace is waiting for your input", detail: null, tab: null },
      { tone: "danger", title: "UAT needs a look in 2 phases", detail: "Phases 59.1 and 59.3 (current)", tab: "uat" },
      { tone: "danger", title: "Phase 59.2 verification needs a look", detail: "gaps found · 1 open gap", tab: "verification" },
      { tone: "warning", title: "Phase 16 validation needs a look", detail: "draft · not compliant", tab: "validation" },
      { tone: "warning", title: "2 debug sessions not resolved", detail: null, tab: "debug" },
    ]);
    // Only an agent asking for input is a need; a running one is shown beside the state instead.
    expect(coreNeeds(needy(), { status: "running", since: null })[0].title).toBe("UAT needs a look in 2 phases");
    expect(coreNeeds(needy(), { status: "failed", since: null })).toHaveLength(4);
    expect(coreNeeds(needy())).toHaveLength(4);
  });

  it("groups several phases of a kind, marks the current one and keeps the tone of the worst", () => {
    const data = overview();
    data.state.phaseId = "3";
    data.validation.phases = Array.from({ length: 9 }, (_, index) => validationPhase(String(index + 1), { recordedStatus: "draft", nyquistCompliant: false }));
    data.verification.phases = [verificationPhase("2", { recordedStatus: "human_needed", statusKind: "human_needed", humanCount: 1, openHumanCount: 1 }), verificationPhase("3", { recordedStatus: "human_needed", statusKind: "human_needed", humanCount: 1, openHumanCount: 1 })];
    data.uat.phases = [uatPhase("3", { pass: 1, pending: 1 }), uatPhase("4", {}, { observation: "unavailable" })];
    const needs = coreNeeds(data);
    expect(needs.map((need) => [need.tone, need.title, need.detail])).toEqual([
      ["warning", "UAT needs a look in 2 phases", "Phases 3 (current) and 4"],
      ["warning", "Verification needs a look in 2 phases", "Phases 2 and 3 (current)"],
      ["warning", "Validation needs a look in 9 phases", "Phases 1, 2, 3 (current), 4, 5, 6, 7 and 2 more"],
    ]);
    // An unreadable UAT file is surfaced, not hidden; a single phase carries its own summary.
    data.uat.phases = [uatPhase("4", {}, { observation: "unavailable" })];
    expect(coreNeeds(data)[0]).toEqual({ tone: "warning", title: "Phase 4 UAT needs a look", detail: "Unreadable", tab: "uat" });
    data.uat.phases = [uatPhase("4", { pass: 0, blocked: 2 })];
    expect(coreNeeds(data)[0]).toMatchObject({ tone: "danger", title: "Phase 4 UAT needs a look", detail: "0/2 pass · 2 blocked" });
    // Resolved and unrecorded sessions are not open.
    // The debug count is the server's over every readable session, not the listed rows.
    data.debug.counts = { ...data.debug.counts, unresolved: 2 };
    expect(coreNeeds(data).at(-1)).toEqual({ tone: "warning", title: "2 debug sessions not resolved", detail: null, tab: "debug" });
    data.debug.counts = { ...data.debug.counts, unresolved: 1 };
    expect(coreNeeds(data).at(-1)?.title).toBe("1 debug session not resolved");
    // Unreadable debug files make the count a lower bound and are named as unread.
    data.debug.counts = { ...data.debug.counts, unavailable: 1 };
    expect(coreNeeds(data).map((need) => need.title)).toEqual(expect.arrayContaining(["some debug files could not be read", "At least 1 debug session not resolved"]));
  });

  it("lists the needs and opens the tab each one is in, beside the live agent status", () => {
    const { tree, content, onNavigate } = view({ data: needy(), agent: { status: "needs_input", since: null } });
    for (const expected of [
      "Needs you · 5", "Agent waiting for you", "An agent in this workspace is waiting for your input",
      "UAT needs a look in 2 phases", "Phases 59.1 and 59.3 (current)", "Phase 59.2 verification needs a look", "gaps found · 1 open gap",
      "Phase 16 validation needs a look", "draft · not compliant", "2 debug sessions not resolved",
    ]) expect(content).toContain(expected);
    expect(content).not.toContain("Nothing needs you right now");
    expect(labelled(tree, "An agent in this workspace is waiting for your input.")).toBeUndefined();
    (labelled(tree, "UAT needs a look in 2 phases. Open uat.")?.props?.onPress as () => void)();
    expect(onNavigate).toHaveBeenLastCalledWith("uat");
    (labelled(tree, "2 debug sessions not resolved. Open debug.")?.props?.onPress as () => void)();
    expect(onNavigate).toHaveBeenLastCalledWith("debug");
    expect(stat(tree, "Debug")).toBe("Debug: 2, not resolved · 3 session files");

    expect(view({ agent: { status: "running", since: null } }).content).toContain("Agent running");
    expect(view({ agent: { status: "done", since: null } }).content).toContain("Agents idle");
    const quiet = view().content;
    expect(quiet).not.toContain("Agent running");
    expect(quiet).not.toContain("Agents idle");
  });
});

describe("Overview withheld and unread evidence", () => {
  it("never turns a withheld requirements percentage into 0%, or draws it as a bar", () => {
    const data = overview();
    data.requirements = { availability: "available", completed: 15, total: 41, percent: null, mapped: null };
    const { tree, content } = view({ data });
    expect(content).toContain("Percentage withheld");
    expect(nodes(tree).find((node) => node.props?.accessibilityLabel === "Requirements: 15/41, Percentage withheld")).toBeDefined();
    expect(nodes(tree).some((node) => typeof node.props?.accessibilityLabel === "string" && (node.props.accessibilityLabel as string).includes("requirements marked complete"))).toBe(false);
  });

  it("shows an unknown completed plan count as a dash, not a zero", () => {
    const data = overview();
    data.roadmap.phases[3] = { ...data.roadmap.phases[3], completedPlans: null, totalPlans: 3 };
    expect(phaseStations(data.roadmap).stations[3].detail).toBe("—/3");
  });

  it("labels the milestone bar from the same counts it draws, also when the current phase is already complete", () => {
    const data = overview();
    data.roadmap.phases[2] = { ...data.roadmap.phases[2], completed: true };
    data.roadmap.completedPhases = 3;
    const labels = nodes(view({ data }).tree).map((node) => node.props?.accessibilityLabel).filter((label): label is string => typeof label === "string");
    expect(labels).toContain("3 phases marked complete, 2 ahead");
    expect(labels.some((label) => label.includes("-1"))).toBe(false);
  });

  it("names the sources it could not read instead of looking calm", () => {
    const data = overview();
    data.uat = { availability: "unavailable", phases: [], limited: false };
    data.debug = { ...data.debug, availability: "unavailable" };
    expect(coreNeeds(data)[0]).toEqual({ tone: "warning", title: "UAT and debug could not be read", detail: "Anything recorded there is not shown here.", tab: "uat" });
    expect(view({ data }).content).not.toContain("Nothing needs you right now");
    expect(coreNeeds(overview())).toEqual([]);
  });
});

describe("internal board tabs", () => {
  const renderTabs = (activeTab: "overview" | "plans" | "context" | "validation" | "verification" | "uat" | "todos" | "parking" | "debug" = "overview") => {
    const onSelect = vi.fn();
    const overviewFocus = vi.fn();
    const plansFocus = vi.fn();
    const contextFocus = vi.fn();
    const validationFocus = vi.fn();
    const verificationFocus = vi.fn();
    const uatFocus = vi.fn();
    const todosFocus = vi.fn();
    const parkingFocus = vi.fn();
    const debugFocus = vi.fn();
    const tree = expand(BoardTabs({ activeTab, focusedTab: null, onSelect, onFocus: vi.fn(), idPrefix: "test-board", tabRefs: { current: { overview: { focus: overviewFocus }, plans: { focus: plansFocus }, context: { focus: contextFocus }, validation: { focus: validationFocus }, verification: { focus: verificationFocus }, uat: { focus: uatFocus }, todos: { focus: todosFocus }, parking: { focus: parkingFocus }, debug: { focus: debugFocus } } }, theme, compact: false }));
    return { tree, onSelect, overviewFocus, plansFocus, contextFocus, validationFocus, debugFocus, tabs: nodes(tree).filter((node) => node.props?.role === "tab") };
  };

  it("orders Overview first and Debug last with accessible panel relationships", () => {
    const { tabs, onSelect } = renderTabs();
    expect(tabs.map((tab) => tab.props?.accessibilityLabel)).toEqual(["Overview", "Plans", "Context", "Validation", "Verification", "UAT", "TODOs", "Parking Lot", "Debug"]);
    expect(tabs[0].props).toMatchObject({ tabIndex: 0, accessibilityState: { selected: true }, "aria-selected": true, "aria-controls": "test-board-panel-overview" });
    expect(tabs[1].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-plans" });
    expect(tabs[2].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-context" });
    expect(tabs[3].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-validation" });
    expect(tabs[4].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-verification" });
    expect(tabs[5].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-uat" });
    expect(tabs[6].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-todos" });
    expect(tabs[7].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-parking" });
    expect(tabs[8].props).toMatchObject({ tabIndex: -1, accessibilityState: { selected: false }, "aria-controls": "test-board-panel-debug" });
    expect(tabs).toHaveLength(9);
    (tabs[1].props?.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith("plans");
    expect(renderTabs("plans").tabs[1].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("context").tabs[2].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("validation").tabs[3].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("verification").tabs[4].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("uat").tabs[5].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("todos").tabs[6].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("parking").tabs[7].props?.accessibilityState).toEqual({ selected: true });
    expect(renderTabs("debug").tabs[8].props?.accessibilityState).toEqual({ selected: true });
  });

  it("supports arrow, Home and End navigation with keyboard focus", () => {
    const { tabs, onSelect, plansFocus } = renderTabs();
    const preventDefault = vi.fn();
    (tabs[0].props?.onKeyDown as (event: unknown) => void)({ key: "ArrowRight", preventDefault });
    expect(onSelect).toHaveBeenCalledWith("plans");
    expect(plansFocus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(tabForKey("plans", "ArrowRight")).toBe("context");
    expect(tabForKey("context", "ArrowLeft")).toBe("plans");
    expect(tabForKey("context", "ArrowRight")).toBe("validation");
    expect(tabForKey("validation", "ArrowLeft")).toBe("context");
    expect(tabForKey("validation", "ArrowRight")).toBe("verification");
    expect(tabForKey("verification", "ArrowLeft")).toBe("validation");
    expect(tabForKey("verification", "ArrowRight")).toBe("uat");
    expect(tabForKey("uat", "ArrowLeft")).toBe("verification");
    expect(tabForKey("uat", "ArrowRight")).toBe("todos");
    expect(tabForKey("todos", "ArrowLeft")).toBe("uat");
    expect(tabForKey("todos", "ArrowRight")).toBe("parking");
    expect(tabForKey("parking", "ArrowLeft")).toBe("todos");
    expect(tabForKey("parking", "ArrowRight")).toBe("debug");
    expect(tabForKey("debug", "ArrowLeft")).toBe("parking");
    expect(tabForKey("debug", "ArrowRight")).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft")).toBe("debug");
    expect(tabForKey("debug", "Home")).toBe("overview");
    expect(tabForKey("overview", "End")).toBe("debug");
    expect(tabForKey("overview", "Tab")).toBeNull();
  });
});
