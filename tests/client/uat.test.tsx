import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { defaultPhase, phaseSummary, UatView } from "../../client/uat-components";
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
const nodes = (node: unknown): Node[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as Node;
  return [value, ...nodes(value.props?.children)];
};
const text = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node !== "object") return "";
  return text((node as Node).props?.children);
};
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Node;
  if (typeof value.type === "function") return expand((value.type as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
const view = (data?: BoardUat, compact = false) => expand(UatView({ state: state(data), theme, compact, onRefresh: vi.fn() }));
const phaseView = (overrides: Record<string, unknown> = {}) => {
  const node = nodes(UatView({ state: state(), theme, onRefresh: vi.fn() })).find((item) => typeof item.type === "function" && item.type.name === "PhaseUat")!;
  return expand({ ...node, props: { ...node.props, ...overrides } });
};

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
    const buttons = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Phase "));
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual([
      "Phase 58: 4/4 pass · 1 resolved issue · 1 human", "Phase 59.1: 4/4 pass · 1 resolved issue · 1 human", "Phase 59.3, current: No UAT",
    ]);
    expect(buttons.map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(text(tree)).toContain("Phase 59.3 (current) has no UAT yet; showing Phase 59.1, the most recent phase with a UAT.");
  });

  it("summarizes one phase only and flags open items and Summary disagreements", () => {
    expect(phaseSummary(phase())).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: true });
    expect(phaseSummary({ ...phase(), summary: null })).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: false });
    const failing = { ...phase(), summary: null, results: { ...phase().results, pass: 3, issue: 1 }, openGapCount: 1 };
    expect(phaseSummary(failing)).toEqual({ text: "3/4 pass · 1 issue · 1 open gap · 1 resolved issue · 1 human", attention: true });
    const observation = { ...phase(), summary: null, gapCount: 0, records: [{ ...phase().records[0], role: "records" as const, items: [{ ...phase().records[0].items[0], gap: false, statusKind: "open" as const }] }] };
    expect(phaseSummary(observation)).toEqual({ text: "4/4 pass · 1 resolved issue · 1 human", attention: false });
  });

  it("orders human judgments and issue history before other tests, which stay collapsed", () => {
    const tree = view();
    const content = text(tree);
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: complete", "Test results: 4 of 4 pass. Every recorded result is a pass.", "Judged by: 2 automated · 1 human. 1 without a recorded source", "Gaps: 1 recorded · 0 open"]));
    const headings = nodes(tree).filter((node) => node.props?.role === "heading").map(text);
    expect(headings.indexOf("Human and evidence-dossier judgments")).toBeLessThan(headings.indexOf("Issues and history"));
    expect(headings.indexOf("Issues and history")).toBeLessThan(headings.indexOf("Other tests"));
    expect(content).toContain("Summary records 3 passed; the per-test results show 4.");
    expect(content).toContain("Summary also records: dispensados 1.");
    expect(content).toContain("2 narrative notes in the Summary are not interpreted; the per-test results above are what is recorded.");
    expect(content).toContain("Reported: Could not read it.");
    expect(content).toContain("Resolved by: Plan 59.1-09");
    expect(content).toContain("2 file references recorded; locations are not shown.");
    expect(content).not.toContain("1. Check 1");
    // Test and record items are not accessible groups, so every field stays reachable to screen readers.
    expect(nodes(tree).filter((node) => node.props?.accessible && /^(?:Test \d|G-)/.test(String(node.props?.accessibilityLabel)))).toHaveLength(0);
    const withSummary = (summary: Partial<NonNullable<BoardUatPhase["summary"]>>) => text(view({ ...uat(), phases: uat().phases.map((item) => item.id === "59.1" ? { ...item, summary: { ...item.summary!, mismatches: [], ...summary } } : item) }));
    expect(withSummary({})).toContain("Summary counts match the per-test results (5 counts compared).");
    expect(withSummary({ compared: 0 })).toContain("The Summary records no counts that can be compared with the per-test results.");
    expect(withSummary({ compared: 0 })).not.toContain("Summary counts match");
    expect(withSummary({ ambiguous: ["passed"] })).toContain("The Summary repeats passed with different entries; those counts are not compared.");
    const toggle = nodes(tree).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Show 2 tests for phase 59.1"));
    expect(toggle?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    expect(text(phaseView({ testsOpen: true }))).toContain("1. Check 1");
    expect(text(phaseView({ sectionsOpen: true }))).toContain("28/28 must-haves verified.");
  });

  it("distinguishes no file, unreadable documents, missing roadmap, loading and stale snapshots", () => {
    const data = uat(); data.phases = [{ ...phase(), current: true, observation: "not_observed" }];
    expect(text(view(data))).toContain("No UAT.md observed for this phase yet.");
    data.phases = [{ ...phase(), current: true, observation: "unavailable" }];
    expect(text(view(data))).toContain("UAT.md could not be read safely for this phase.");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(UatView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading UAT…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(expand(UatView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Refresh to update UAT.");
  });
});
