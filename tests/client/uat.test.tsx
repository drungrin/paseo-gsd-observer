import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>()));

import { expand } from "../helpers/react-native-mock";
import { defaultPhase, phaseSummary, UatView, uatNotes } from "../../client/uat-components";
import { liveStatus } from "../../client/board-frame";
import { PhasePicker, type PickerPhase } from "../../client/core-components";
import type { BoardViewState } from "../../client/board-components";
import type { BoardUat, BoardUatPhase, UatTest } from "../../shared/uat";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const test = (number: number, overrides: Partial<UatTest> = {}): UatTest => ({ number, name: `Check ${number}`, expected: `Behavior ${number}`, expectedSameAsName: false, result: { kind: "pass", label: "pass", note: null },
  source: { kind: "automated", label: "automated" }, previousResult: null, severity: null, reported: null, resolvedBy: null, reason: null, reference: null, history: false, ...overrides });
const phase = (): BoardUatPhase => ({ id: "59.1", title: "Contextual help", current: false, observation: "observed", recordedStatus: "complete", startedAt: "2026-09-16", updatedAt: "2026-09-19",
  currentTest: { state: "complete", number: null, text: "testing complete" }, testCount: 4, results: { pass: 4, issue: 0, pending: 0, skipped: 0, blocked: 0, other: 0 },
  sources: { automated: 2, human: 1, evidence: 0, other: 0, unrecorded: 1 }, resolvedIssues: 1, gapCount: 1, openGapCount: 0,
  tests: [test(1), test(2, { source: { kind: "human", label: "human-confirmed" } }), test(3, { history: true, previousResult: "issue", severity: { level: "blocker", label: "blocker" }, reported: "Could not read it.", resolvedBy: "Plan 59.1-09" }), test(4, { source: { kind: "unrecorded", label: null } })],
  summary: { total: 4, passed: 3, issues: 0, pending: 0, skipped: 0, blocked: 0, extras: [{ label: "dispensados", count: 1 }], narrativeNotes: 2, compared: 5, ambiguous: [], mismatches: [{ field: "passed", recorded: 3, observed: 4 }] },
  records: [{ title: "Gaps", role: "gaps", itemCount: 1, items: [{ gap: true, conflicting: false, id: "G-59.1-1", title: "Guide steps are readable", status: "resolved", statusKind: "resolved", originalStatus: "failed", severity: { level: "blocker", label: "blocker" }, test: 3, reason: null, rootCause: "Panel painted behind the page", resolvedBy: "Plan 59.1-09", decision: null, date: "2026-09-19", references: 2 }] }],
  otherSections: [{ title: "Objective Evidence Already Closed", lines: ["28/28 must-haves verified."] }], excerptsLimited: false });
const uat = (): BoardUat => ({ availability: "available", limited: false, phases: [
  { ...phase(), id: "58", title: "Profile", observation: "observed" },
  phase(),
  { ...phase(), id: "59.3", title: "Registries", current: true, observation: "not_observed" },
] });
const state = (data: BoardUat = uat()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { uat: data } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const label = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));
const render = (viewState: BoardViewState, compact = false) => expand(UatView({ state: viewState, theme, compact, onRefresh: vi.fn() }));
const view = (data?: BoardUat, compact = false) => render(state(data), compact);
const withPhase = (overrides: Partial<BoardUatPhase>): BoardUat => ({ ...uat(), phases: uat().phases.map((item) => item.id === "59.1" ? { ...item, ...overrides } : item) });
const phaseView = (overrides: Record<string, unknown> = {}) => {
  const node = nodes(UatView({ state: state(), theme, onRefresh: vi.fn() })).find((item) => typeof item.type === "function" && item.type.name === "PhaseUat")!;
  return expand({ ...node, props: { ...node.props, ...overrides } });
};
/** The chips the picker is given, before they are rendered. */
const pickerPhases = (data?: BoardUat) => nodes(UatView({ state: state(data), theme, onRefresh: vi.fn() })).find((node) => node.type === PhasePicker)!.props!.phases as PickerPhase[];
const chips = (tree: unknown) => nodes(tree).filter((node) => String(node.props?.accessibilityLabel ?? "").startsWith("Phase "));
const bars = (tree: unknown) => nodes(tree).filter((node) => node.props?.accessibilityRole === "image");

describe("UAT tab", () => {
  it("falls back to the most recent phase with a UAT when the current phase has none, and says so", () => {
    expect(defaultPhase(uat())).toEqual({ id: "59.1", fallback: true });
    const withCurrent = uat(); withCurrent.phases[2] = { ...withCurrent.phases[2], observation: "observed" };
    expect(defaultPhase(withCurrent)).toEqual({ id: "59.3", fallback: false });
    const unreadable = uat(); unreadable.phases[2] = { ...unreadable.phases[2], observation: "unavailable" };
    expect(defaultPhase(unreadable)).toEqual({ id: "59.3", fallback: false });
    expect(phaseSummary(unreadable.phases[2])).toEqual({ text: "Unreadable", attention: true });
    expect(text(view(unreadable))).not.toContain("has no UAT yet");
    const tree = view();
    expect(chips(tree).map((node) => node.props?.accessibilityLabel)).toEqual([
      "Phase 58: 4/4 pass · 1 resolved issue · 1 human", "Phase 59.1: 4/4 pass · 1 resolved issue · 1 human", "Phase 59.3, current: No UAT",
    ]);
    expect(chips(tree).map((node) => node.props?.accessibilityState)).toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    expect(chips(tree).map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(text(tree)).toContain("Phase 59.3 (current) has no UAT yet; showing Phase 59.1, the most recent phase with a UAT.");
    expect(nodes(tree).filter((node) => node.props?.role === "heading").map(text)).toContain("Phase 59.1 · Contextual help");
  });

  it("summarizes one phase only and flags open items and Summary disagreements", () => {
    expect(phaseSummary(phase())).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: true });
    expect(phaseSummary({ ...phase(), summary: null })).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: false });
    const failing = { ...phase(), summary: null, results: { ...phase().results, pass: 3, issue: 1 }, openGapCount: 1 };
    expect(phaseSummary(failing)).toEqual({ text: "3/4 pass · 1 issue · 1 open gap · 1 resolved issue · 1 human", attention: true });
    const observation = { ...phase(), summary: null, gapCount: 0, records: [{ ...phase().records[0], role: "records" as const, items: [{ ...phase().records[0].items[0], gap: false, statusKind: "open" as const }] }] };
    expect(phaseSummary(observation)).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: false });
  });

  it("describes each phase chip by that phase alone, with a tone for issues, open items and full passes", () => {
    expect(pickerPhases()).toEqual([
      { id: "58", current: false, description: "4/4 pass · 1 resolved issue · 1 human", tone: "warning", detail: "4/4 pass", percent: 100 },
      { id: "59.1", current: false, description: "4/4 pass · 1 resolved issue · 1 human", tone: "warning", detail: "4/4 pass", percent: 100 },
      { id: "59.3", current: true, description: "No UAT", tone: null, detail: "no uat", percent: undefined },
    ]);
    const mixed = uat();
    mixed.phases = [
      { ...phase(), id: "1", summary: null },
      { ...phase(), id: "2", summary: null, results: { ...phase().results, pass: 3, issue: 1 } },
      { ...phase(), id: "3", summary: null, results: { ...phase().results, pass: 3, pending: 1 } },
      { ...phase(), id: "4", summary: null, testCount: 0, results: { ...phase().results, pass: 0 } },
      { ...phase(), id: "5", current: true, observation: "unavailable" },
    ];
    expect(pickerPhases(mixed).map(({ id, tone, detail, percent }) => ({ id, tone, detail, percent }))).toEqual([
      { id: "1", tone: "success", detail: "4/4 pass", percent: 100 },
      { id: "2", tone: "danger", detail: "3/4 pass", percent: 75 },
      { id: "3", tone: "warning", detail: "3/4 pass", percent: 75 },
      { id: "4", tone: null, detail: "no tests", percent: undefined },
      { id: "5", tone: "warning", detail: "unreadable", percent: undefined },
    ]);
    // The tone shows as a glyph beside the phase id, and the short detail under it.
    expect(chips(view(mixed)).map(text)).toEqual(["1✓4/4 pass", "2✕3/4 pass", "3!3/4 pass", "4no tests", "5!unreadable"]);
  });

  it("draws every recorded test of the phase as one bar, by result, with a matching legend", () => {
    expect(bars(view()).map((node) => node.props?.accessibilityLabel)).toEqual(["4 pass"]);
    const mixed = view(withPhase({ testCount: 6, results: { pass: 1, issue: 1, pending: 1, skipped: 1, blocked: 1, other: 1 } }));
    expect(bars(mixed).map((node) => node.props?.accessibilityLabel)).toEqual(["1 pass, 1 issue, 1 blocked, 1 pending, 1 skipped, 1 other"]);
    expect(nodes(mixed).filter((node) => node.type === "Text").map(text)).toEqual(expect.arrayContaining(["1 pass", "1 issue", "1 blocked", "1 pending", "1 skipped", "1 other"]));
    // The bar is an image with no text inside, so it hides nothing from screen readers.
    expect(bars(mixed).map(text)).toEqual([""]);
    expect(bars(view(withPhase({ testCount: 0, results: { pass: 0, issue: 0, pending: 0, skipped: 0, blocked: 0, other: 0 }, tests: [] })))).toHaveLength(0);
  });

  it("orders human judgments and issue history before other tests, which stay collapsed", () => {
    const tree = view();
    const content = text(tree);
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: complete", "Test results: 4 of 4 pass, Every recorded result is a pass.", "Judged by: 2 automated · 1 human, 1 without a recorded source", "Gaps: 1 recorded · 0 open"]));
    const headings = nodes(tree).filter((node) => node.props?.role === "heading").map(text);
    expect(headings.indexOf("Human and evidence-dossier judgments")).toBeGreaterThan(-1);
    expect(headings.indexOf("Human and evidence-dossier judgments")).toBeLessThan(headings.indexOf("Issues and history"));
    expect(headings.indexOf("Issues and history")).toBeLessThan(headings.indexOf("Other tests"));
    expect(content).toContain("UAT.md observed · Started 2026-09-16 · Updated 2026-09-19");
    expect(content).toContain("Summary records 3 passed; the per-test results show 4.");
    expect(content).toContain("Summary also records: dispensados 1.");
    expect(content).toContain("2 narrative notes in the Summary are not interpreted; the per-test results above are what is recorded.");
    expect(content).toContain("Reported: Could not read it.");
    expect(content).toContain("Resolved by: Plan 59.1-09");
    expect(content).toContain("2 file references recorded; locations are not shown.");
    expect(content).not.toContain("1. Check 1");
    // Test and record items are not accessible groups, so every field stays reachable to screen readers.
    expect(nodes(tree).filter((node) => node.props?.accessible && /^(?:Test \d|G-)/.test(String(node.props?.accessibilityLabel)))).toHaveLength(0);
    const withSummary = (summary: Partial<NonNullable<BoardUatPhase["summary"]>>) => text(view(withPhase({ summary: { ...phase().summary!, mismatches: [], ...summary } })));
    expect(withSummary({})).toContain("Summary counts match the per-test results (5 counts compared).");
    expect(withSummary({ compared: 0 })).toContain("The Summary records no counts that can be compared with the per-test results.");
    expect(withSummary({ compared: 0 })).not.toContain("Summary counts match");
    expect(withSummary({ ambiguous: ["passed"] })).toContain("The Summary repeats passed with different entries; those counts are not compared.");
    expect(label(tree, "Show 2 tests for phase 59.1")?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    expect(text(phaseView({ testsOpen: true }))).toContain("1. Check 1");
    expect(text(phaseView({ sectionsOpen: true }))).toContain("28/28 must-haves verified.");
  });

  it("keeps omitted and shortened excerpts visible under the phase heading", () => {
    const content = text(view(withPhase({ excerptsLimited: true, tests: [test(1, { reference: "[omitted]" }), ...phase().tests.slice(1)] })));
    expect(content).toContain("Commands, absolute paths, links and host-like text are shown as [omitted].");
    expect(content).toContain("Some UAT text could not be safely extracted or was shortened.");
    expect(text(view())).not.toContain("shown as [omitted]");
  });

  it("keeps the caveats under About these figures and the limited notice in view", () => {
    expect(uatNotes()).toEqual([
      "Results are recorded in the document; they are not a live test run.",
      "UAT is per phase, so nothing is aggregated across phases.",
    ]);
    expect((UatView({ state: state(), theme, onRefresh: vi.fn() }) as Node).props?.notes).toEqual(uatNotes());
    const tree = view();
    expect(label(tree, "About these figures")?.props?.accessibilityState).toEqual({ expanded: false });
    expect(text(tree)).not.toContain("not a live test run");
    expect(text(tree)).not.toContain("Some UAT evidence or safe excerpts may be incomplete.");
    expect(text(view({ ...uat(), limited: true }))).toContain("Some UAT evidence or safe excerpts may be incomplete.");
  });

  it("distinguishes no file, unreadable documents, missing roadmap, loading, failed refreshes and stale snapshots", () => {
    const data = uat(); data.phases = [{ ...phase(), current: true, observation: "not_observed" }];
    expect(text(view(data))).toContain("No UAT.md observed for this phase yet.");
    data.phases = [{ ...phase(), current: true, observation: "unavailable" }];
    expect(text(view(data))).toContain("UAT.md could not be read safely for this phase.");
    expect(text(view(data))).not.toContain("No UAT.md observed");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    expect(text(view({ availability: "available", phases: [], limited: false }))).toContain("No current-milestone phases declared in the roadmap.");
    const loading = text(render({ workspaceId: "other", snapshot: null, busy: true, error: null }));
    expect(loading).toContain("Loading UAT…");
    expect(loading).not.toContain("No readable current-milestone roadmap");
    expect(text(render({ ...state(), error: "boom" }))).toContain("Could not refresh UAT. The last snapshot is still displayed.");
    expect(text(render({ workspaceId: "selected", snapshot: null, busy: false, error: "boom" }))).toContain("Could not refresh UAT. Try refreshing again.");
    expect(text(render({ ...state(), refreshAnnouncement: "UAT refreshed." }))).toContain("UAT refreshed.");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(render(stale, true))).toContain("Files changed · updating");
    const failed = state(); failed.snapshot!.freshness = "refresh-failed";
    expect(text(render(failed))).toContain("Out of date");
    expect(text(view())).not.toContain("Out of date");
  });
});
