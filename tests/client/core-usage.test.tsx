import { afterEach, describe, expect, it, vi } from "vitest";

/** Initial values a test swaps in for one `useState` call, keyed by the component's own initial value ("status" → "spend"). */
const initial = vi.hoisted(() => new Map<unknown, unknown>());
vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const mock = (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>());
  return { ...mock, useState: (value: unknown) => mock.useState(initial.has(value) ? initial.get(value) : value) };
});

import { expand } from "../helpers/react-native-mock";
import { phaseChecks } from "../helpers/phase-checks";
import { coreLaneGroups, coreTimelineNotes, CoreTimelineView, defaultTimelinePhase, lanePhase } from "../../client/core-timeline-components";
import { ledgerNotes, PathLedgerView } from "../../client/path-ledger-components";
import { CORE_USAGE_SOURCE } from "../../client/path-usage-components";
import { PlansView } from "../../client/plans-components";
import { createUsageState, type UsageViewState } from "../../client/usage-controller";
import type { BoardViewState } from "../../client/board-components";
import type { BoardOverview } from "../../shared/overview";
import type { BoardUsage, UsageActivity } from "../../shared/usage";

type Phase = BoardOverview["plans"]["phases"][number];
type Plan = Phase["entries"][number];
type Node = { type?: unknown; props?: Record<string, unknown> };
const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const plan = (id: string, overrides: Partial<Plan> = {}): Plan => ({ id, number: id.split("-")[1], title: `Plan ${id}`, objective: null, wave: 1, roadmapChecked: null, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false, ...overrides });
const phase = (id: string, entries: Plan[], current = false): Phase => ({ id, title: `Title ${id}`, current, declaredPlans: entries.length, entries, checks: phaseChecks() });
/** Only what the timeline and plans tabs read: the milestone's phases and plans, and which phases the roadmap marks complete. */
const overview = (): BoardOverview => ({
  plans: { availability: "available", observedPlans: 3, observedSummaries: 1, limited: false, phases: [phase("60", [plan("60-1", { summaryObserved: true }), plan("60-2")]), phase("61", [plan("61-1")], true)] },
  roadmap: { availability: "available", completedPhases: 1, totalPhases: 2, percent: 50, phases: [{ id: "60", title: "Title 60", completed: true, current: false, completedPlans: 2, totalPlans: 2, percent: 100 }, { id: "61", title: "Title 61", completed: false, current: true, completedPlans: 0, totalPlans: 1, percent: 0 }] },
} as unknown as BoardOverview);
const bucket = (lane: string, at: string, turns = 1, cost: number | null = 0.5): UsageActivity => ({ lane, at, turns, cost });
const activity = [
  bucket("orchestrator", "2026-10-15T09:00:00.000Z", 4), bucket("60", "2026-10-15T09:10:00.000Z"), bucket("60-1", "2026-10-15T09:20:00.000Z", 3),
  bucket("60-2", "2026-10-15T09:20:00.000Z", 2), bucket("60-9", "2026-10-15T09:30:00.000Z"), bucket("12", "2026-08-01T10:00:00.000Z", 2, null),
  bucket("12-3", "2026-08-01T10:00:00.000Z", 1, 1), bucket("subagents", "2026-10-15T09:40:00.000Z"),
];
const usageData = (overrides: Partial<BoardUsage> = {}): BoardUsage => ({ workspaceId: "selected", observedAt: "2026-10-23T00:00:00.000Z", availability: "available", complete: true, limited: false, pricing: "configured", sessions: 4,
  totals: { turns: 15, prompts: 9, tokensIn: 1000, tokensCached: 9000, tokensOut: 200, cost: 4.5, pricedTurns: 13, durationS: 300, timedTurns: 15 }, models: [], milestones: [], unpriced: [], tasks: [],
  plans: [{ id: "60-1", turns: 3, tokens: 900, cost: 1.5, durationS: 60, first: "2026-10-15T09:20:00.000Z", last: "2026-10-15T09:25:00.000Z" }, { id: "60-2", turns: 2, tokens: 400, cost: 1, durationS: 30, first: "2026-10-15T09:20:00.000Z", last: "2026-10-15T09:29:00.000Z" }],
  phases: [{ id: "12", turns: 3, tokens: 300, cost: 1, durationS: 10 }, { id: "60", turns: 7, tokens: 1500, cost: 3, durationS: 100 }],
  activity, activityLimited: false, ...overrides });
const usageState = (usage: BoardUsage | null = usageData()): UsageViewState => ({ ...createUsageState(), usage });
const state = (data: BoardOverview | null = overview()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, refreshAnnouncement: null, changes: null, statusFailed: false,
  snapshot: { workspaceId: "selected", observedAt: "2026-10-23T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, flavor: "gsd-core", ...(data ? { overview: data } : {}) } } as BoardViewState);
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";

afterEach(() => initial.clear());

describe("GSD Core timeline lanes", () => {
  it("opens one phase with a lane for its other agents and one per plan, and folds every other phase into one lane", () => {
    const groups = coreLaneGroups(overview(), activity, "60");
    expect(groups.map((group) => [group.key, group.title, group.band])).toEqual([
      ["orchestrator", "Orchestrator", false], ["phase-60", "Phase 60 · Title 60", true], ["earlier", "Outside this milestone", false], ["subagents", "Other subagents", false],
    ]);
    // The phase's other agents, its listed plans with what their files show, then an executor whose plan the files do not list.
    expect(groups[1].lanes.map((lane) => [lane.id, lane.label, lane.mark?.label ?? null, lane.buckets.length])).toEqual([
      ["60", "Agents", null, 1], ["60-1", "60-1", "Summary written", 1], ["60-2", "60-2", "Plan file only", 1], ["60-9", "60-9", null, 1],
    ]);
    // Phases outside the milestone are one lane, their buckets added up per ten minutes: turns summed, costs summed where any had one.
    expect(groups[2].lanes).toEqual([{ id: "earlier", label: "Earlier phases", title: "Phase 12", mark: null, buckets: [{ lane: "earlier", at: "2026-08-01T10:00:00.000Z", turns: 3, cost: 1 }] }]);
  });

  it("folds the milestone's other phases into one lane each, marked as the roadmap records them", () => {
    const groups = coreLaneGroups(overview(), [...activity, bucket("61-1", "2026-10-16T09:00:00.000Z")], "61");
    const milestone = groups.find((group) => group.key === "milestone");
    expect(milestone?.title).toBe("This milestone's other phases");
    expect(milestone?.lanes.map((lane) => [lane.id, lane.label, lane.mark?.label, lane.buckets.reduce((sum, entry) => sum + entry.turns, 0)])).toEqual([["phase-60", "Phase 60", "Marked complete", 7]]);
    expect(groups.find((group) => group.key === "phase-61")?.current).toBe(true);
  });

  it("opens on the current phase when its agents worked, else on the milestone phase that worked last", () => {
    const phases = overview().plans.phases;
    expect(defaultTimelinePhase(phases, activity)).toBe("60");
    expect(defaultTimelinePhase(phases, [...activity, bucket("61-1", "2026-10-01T00:00:00.000Z")])).toBe("61");
    expect(defaultTimelinePhase(phases, [])).toBe("61");
    expect(lanePhase("59.3-17")).toBe("59.3");
    expect(lanePhase("59.3")).toBe("59.3");
  });

  it("lets a phase be opened, and opens the history on the open phase's last turn", () => {
    const tree = CoreTimelineView({ state: state(), usage: usageState(), onRefresh: vi.fn(), theme });
    const recorder = nodes(tree).find((node) => node.props?.unit === "plan");
    expect(recorder?.props).toMatchObject({ focus: { key: "60", at: Date.parse("2026-10-15T09:30:00.000Z") } });
    // Only the open milestone's plans make the long pole.
    expect((recorder?.props?.spans as { id: string }[]).map((span) => span.id)).toEqual(["60-1", "60-2"]);
    const content = text(expand(tree));
    expect(content).toContain("$3.00");
    expect(content).toContain("no turns");
    expect(content).toContain("Phase 60 · Title 60");
  });

  it("explains where a turn's lane comes from, and says when there is no evidence", () => {
    expect(coreTimelineNotes().join(" ")).toContain("names that plan's PLAN.md file first");
    expect(text(expand(CoreTimelineView({ state: state(null), usage: usageState(), onRefresh: vi.fn(), theme })))).toContain("Project evidence unavailable");
    expect(text(expand(CoreTimelineView({ state: state(), usage: usageState(null), onRefresh: vi.fn(), theme })))).toContain("Reading host session logs…");
  });
});

describe("GSD Core ledger", () => {
  it("shows the usage card for a GSD Core workspace and says how its turns are placed", () => {
    const content = text(expand(PathLedgerView({ state: state(), usage: usageState(), onRefresh: vi.fn(), onLoadLedger: vi.fn(), theme })));
    expect(content).toContain("Usage");
    expect(content).toContain("Load host turn ledger");
    expect(ledgerNotes("gsd-core")[0]).toBe(CORE_USAGE_SOURCE);
    expect(text(expand(PathLedgerView({ state: state(null), usage: usageState(), onRefresh: vi.fn(), onLoadLedger: vi.fn(), theme })))).toContain("Project evidence unavailable");
  });
});

describe("GSD Core plan spend", () => {
  it("shows the open phase's spend, the selected plan's executor, and colors the tiles by spend when asked", () => {
    const data = overview();
    data.plans.phases[1].current = false;
    data.plans.phases[0].current = true;
    initial.set("status", "spend");
    const tree = expand(PlansView({ state: state(data), usage: usageState(), onRefresh: vi.fn(), theme }));
    const content = text(tree);
    expect(content).toContain("$3.00 spent");
    // The plan the tab opens on is the first without a summary: 60-2.
    const stats = nodes(tree).map((node) => node.props?.accessibilityLabel).filter((label): label is string => typeof label === "string" && /^(Spent|Turns|Agent time|Wall clock):/.test(label));
    // Wall clock runs from the first turn to the last, in local time.
    // Agent time is shown in whole minutes, as everywhere on the board.
    expect(stats.slice(0, 3)).toEqual(["Spent: $1.00", "Turns: 2", "Agent time: 0m"]);
    expect(stats[3]).toMatch(/^Wall clock: 9m, /);
    const tile = nodes(tree).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Plan 60-1:"));
    expect(tile?.props?.accessibilityLabel).toContain("$1.50.");
    expect(content).toContain("$1.50");
  });

  it("says when no executor names a plan yet, and shows nothing about spend without usage", () => {
    const data = overview();
    const withUsage = text(expand(PlansView({ state: state(data), usage: usageState(), onRefresh: vi.fn(), theme })));
    expect(withUsage).toContain("No executor session names this plan's file yet.");
    const without = text(expand(PlansView({ state: state(data), usage: usageState(null), onRefresh: vi.fn(), theme })));
    expect(without).not.toContain("No executor session names");
    expect(without).not.toContain("spent");
  });
});
