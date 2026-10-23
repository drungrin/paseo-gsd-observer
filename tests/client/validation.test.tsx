import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>()));

import { expand } from "../helpers/react-native-mock";
import { latestAudit, phaseSummary, ValidationView, validationNotes } from "../../client/validation-components";
import { liveStatus } from "../../client/board-frame";
import { PhasePicker, type PickerPhase } from "../../client/core-components";
import type { BoardViewState } from "../../client/board-components";
import type { BoardValidation, BoardValidationPhase } from "../../shared/validation";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const counts = { passing: 5, pending: 0, failing: 3, partial: 0, human: 0, blocked: 0, flaky: 0, other: 0 };
const phase = (): BoardValidationPhase => ({ id: "16", title: "Platform idempotency", current: true, observation: "observed", recordedStatus: "validated", nyquistCompliant: false, wave0Complete: true,
  createdAt: "2026-08-28", updatedAt: null, otherStatuses: [{ label: "Execution status", value: "partial" }],
  infrastructure: [{ label: "Framework", value: "Vitest 4.1.10", withheld: null }, { label: "Quick run command", value: null, withheld: "command" }],
  tables: [
    { title: "Per-Task Verification Map", role: "verification", keyLabel: "Task ID", columns: ["Wave", "Secure Behavior"], statusLabel: "Status", hiddenColumns: ["Automated Command"],
      rows: [{ key: "16-01-01", cells: ["1", "Replays return the cached response"], status: { kind: "failing", label: "red", note: "Docker cannot resolve [omitted]" }, aligned: true },
        { key: "16-01-02", cells: [], status: { kind: "passing", label: "green", note: null }, aligned: false },
        { key: "16-01-03", cells: ["2", null], status: { kind: "passing", label: "green", note: null }, aligned: true }],
      rowCount: 8, irregularRows: 1, counts, conflicts: 2 },
    { title: "Escalated Automated Verifications", role: "escalated", keyLabel: "Requirement", columns: ["Failing Behavior"], statusLabel: null, hiddenColumns: [], rows: [{ key: "REQ-10", cells: ["Docker cold start"], status: null, aligned: true }], rowCount: 1, irregularRows: 0, counts: null, conflicts: 0 },
  ],
  manualNote: null, wave0: { done: 10, total: 10, open: [], note: null }, signOff: { done: 4, total: 7, open: ["The final focused gate is green"], note: "adversarial audit is partial" },
  audits: [{ title: "Adversarial Audit — 2026-08-29", date: "2026-08-29", gaps: null, resolved: null, escalated: null }, { title: "Validation Audit 2026-08-29", date: "2026-08-29", gaps: 4, resolved: 1, escalated: 3 }, { title: "Undated audit", date: null, gaps: 0, resolved: 0, escalated: 0 }],
  auditCount: 3, sections: ["Test Infrastructure", "Per-Task Verification Map"], excerptsLimited: false });
const validation = (): BoardValidation => ({ availability: "available", limited: false, phases: [
  { ...phase(), id: "15", title: "Prior", current: false, observation: "not_observed" },
  phase(),
  { ...phase(), id: "17", title: "Next", current: false, observation: "unavailable" },
] });
const state = (data: BoardValidation = validation()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { validation: data } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const label = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));
const render = (viewState: BoardViewState, compact = false) => expand(ValidationView({ state: viewState, theme, compact, onRefresh: vi.fn() }));
const view = (data?: BoardValidation, compact = false) => render(state(data), compact);
const withPhase = (overrides: Partial<BoardValidationPhase>): BoardValidation => ({ ...validation(), phases: validation().phases.map((item) => item.id === "16" ? { ...item, ...overrides } : item) });
/** The chips the picker is given, before they are rendered. */
const pickerPhases = (data?: BoardValidation) => nodes(ValidationView({ state: state(data), theme, onRefresh: vi.fn() })).find((node) => node.type === PhasePicker)!.props!.phases as PickerPhase[];
const chips = (tree: unknown) => nodes(tree).filter((node) => String(node.props?.accessibilityLabel ?? "").startsWith("Phase "));
const barLabels = (tree: unknown) => nodes(tree).filter((node) => node.props?.accessibilityRole === "image").map((node) => node.props?.accessibilityLabel);

describe("Validation tab", () => {
  it("defaults to the current phase and summarizes each phase without merging compliance into status", () => {
    const tree = view();
    expect(chips(tree).map((node) => node.props?.accessibilityLabel)).toEqual(["Phase 15: No file", "Phase 16, current: validated · not compliant · audit escalations · failing rows", "Phase 17: Unreadable"]);
    expect(chips(tree).map((node) => node.props?.accessibilityState)).toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    expect(chips(tree).map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(nodes(tree).filter((node) => node.props?.role === "heading").map(text)).toContain("Phase 16 · Platform idempotency");
    expect(text(tree)).toContain("VALIDATION.md observed · Created 2026-08-28");
  });

  it("describes each phase chip by its recorded status, with compliance, escalations and failing rows only in its tone", () => {
    expect(pickerPhases().map(({ id, current, description, tone, detail }) => ({ id, current, description, tone, detail }))).toEqual([
      { id: "15", current: false, description: "No file", tone: null, detail: "no file" },
      { id: "16", current: true, description: "validated · not compliant · audit escalations · failing rows", tone: "warning", detail: "validated" },
      { id: "17", current: false, description: "Unreadable", tone: "warning", detail: "unreadable" },
    ]);
    // The fill is the share of passing rows in the primary verification table: 5 of 8 counted.
    expect(pickerPhases()[1].percent).toBe(62.5);
    const primary = { ...phase().tables[0], counts: { ...counts, failing: 0 } };
    const mixed = validation();
    mixed.phases = [
      { ...phase(), id: "1", current: false, nyquistCompliant: true, audits: [], tables: [primary] },
      { ...phase(), id: "2", current: false, nyquistCompliant: null, audits: [], tables: [] },
      { ...phase(), id: "3", current: false, nyquistCompliant: false, audits: [], tables: [] },
      // A later table's failing rows may be a historical record; only the primary table speaks for the phase.
      { ...phase(), id: "4", current: false, nyquistCompliant: true, audits: [], tables: [primary, { ...phase().tables[0], title: "Nyquist Gap Audit" }] },
      { ...phase(), id: "5", current: false, observation: "not_observed", tables: [] },
    ];
    expect(pickerPhases(mixed).map(({ id, description, tone, detail, percent }) => ({ id, description, tone, detail, percent }))).toEqual([
      { id: "1", description: "validated · Nyquist compliant", tone: "success", detail: "validated", percent: 100 },
      { id: "2", description: "validated", tone: null, detail: "validated", percent: undefined },
      { id: "3", description: "validated · not compliant", tone: "warning", detail: "validated", percent: undefined },
      { id: "4", description: "validated · Nyquist compliant", tone: "success", detail: "validated", percent: 100 },
      { id: "5", description: "No file", tone: null, detail: "no file", percent: undefined },
    ]);
    // The tone shows as a glyph beside the phase id, and the short detail under it.
    expect(chips(view(mixed)).map(text)).toEqual(["1✓validated", "2validated", "3!validated", "4✓validated", "5no file"]);
  });

  it("shows the four facts separately and picks the latest dated audit", () => {
    const tree = view();
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: validated, Execution status: partial", "Nyquist compliant: No", "Wave 0 complete: Yes", "Latest audit: 4 gaps found · 1 resolved · 3 escalated, Validation Audit 2026-08-29"]));
    expect(latestAudit(phase().audits)?.title).toBe("Validation Audit 2026-08-29");
    expect(latestAudit([{ title: "Only", date: null, gaps: null, resolved: null, escalated: null }])?.title).toBe("Only");
    expect(text(tree)).toContain("Validation Audit 2026-08-29 · latest");
    const unknown = nodes(view(withPhase({ nyquistCompliant: null, wave0Complete: null, audits: [], otherStatuses: [] }))).map((node) => node.props?.accessibilityLabel);
    expect(unknown).toEqual(expect.arrayContaining(["Recorded status: validated", "Nyquist compliant: Not recorded", "Wave 0 complete: Not recorded", "Latest audit: None recorded"]));
  });

  it("renders the file's columns with status counts, hidden-column, conflict, irregular and withheld notes", () => {
    const tree = view();
    const content = text(tree);
    expect(nodes(tree).find((node) => node.props?.role === "table" && node.props?.accessibilityLabel === "Per-Task Verification Map")).toBeDefined();
    expect(nodes(tree).filter((node) => node.props?.role === "columnheader").map(text)).toEqual(["Task ID", "Status", "Wave", "Secure Behavior", "Requirement", "Failing Behavior"]);
    expect(nodes(tree).find((node) => node.props?.accessibilityLabel === "Passing 5, Failing 3")).toBeDefined();
    expect(content).toContain("8 rows recorded · showing 3 · 1 with irregular columns");
    expect(content).toContain("2 rows have a different status in another table of this document.");
    expect(content).toContain("Not shown: Automated Command (commands and file locations are withheld).");
    expect(content).toContain("Columns could not be aligned for this row; only its key and status are shown.");
    expect(content).toContain("Withheld");
    expect(content).toContain("Docker cannot resolve [omitted]");
    expect(content).toContain("Commands, absolute paths, links and host-like text are shown as [omitted].");
    expect(content).toContain("4 of 7 checked");
    expect(content).toContain("2 open items are withheld by the privacy filter or excerpt limit.");
    expect(content).toContain("Approval: adversarial audit is partial");
    expect(content).toContain("Recorded; not shown (command or file location).");
  });

  it("draws each table's recorded statuses as one bar with a legend that reads the counts", () => {
    const tree = view();
    // The escalated table records no status column, so it gets no bar.
    expect(barLabels(tree)).toEqual(["Passing 5, Failing 3"]);
    expect(nodes(tree).filter((node) => node.type === "Text").map(text)).toEqual(expect.arrayContaining(["Passing 5", "Failing 3"]));
    const all = { passing: 1, pending: 1, failing: 1, partial: 1, human: 1, blocked: 1, flaky: 1, other: 1 };
    expect(barLabels(view(withPhase({ tables: [{ ...phase().tables[0], counts: all }] })))).toEqual(["Passing 1, Pending 1, Failing 1, Partial 1, Needs human 1, Blocked 1, Flaky 1, Other 1"]);
    const none = { passing: 0, pending: 0, failing: 0, partial: 0, human: 0, blocked: 0, flaky: 0, other: 0 };
    expect(barLabels(view(withPhase({ tables: [{ ...phase().tables[0], counts: none }] })))).toEqual(["No rows"]);
  });

  it("stacks rows as cards in compact panels", () => {
    const tree = view(undefined, true);
    expect(nodes(tree).some((node) => node.props?.role === "table")).toBe(false);
    const card = nodes(tree).find((node) => node.props?.accessibilityLabel === "Per-Task Verification Map")!;
    expect(text(card)).toContain("Secure Behavior");
    expect(text(card)).toContain("Replays return the cached response");
    expect(text(card)).toContain("Columns could not be aligned for this row; only its key and status are shown.");
    expect(text(card)).toContain("Withheld");
  });

  it("keeps the caveats under About these figures and the limited notice in view", () => {
    expect(validationNotes()).toEqual([
      "Statuses are recorded in the document; they are not a live test run.",
      "Only the primary verification table speaks for the phase; later tables may be historical audit or execution records.",
    ]);
    expect((ValidationView({ state: state(), theme, onRefresh: vi.fn() }) as Node).props?.notes).toEqual(validationNotes());
    const tree = view();
    expect(label(tree, "About these figures")?.props?.accessibilityState).toEqual({ expanded: false });
    expect(text(tree)).not.toContain("not a live test run");
    expect(text(tree)).not.toContain("Some validation evidence or safe excerpts may be incomplete.");
    expect(text(view({ ...validation(), limited: true }))).toContain("Some validation evidence or safe excerpts may be incomplete.");
    expect(text(view(withPhase({ excerptsLimited: true })))).toContain("Some validation text could not be safely extracted or was shortened.");
  });

  it("distinguishes no file, unreadable documents, missing roadmap, loading, failed refreshes and stale snapshots", () => {
    const data = validation(); data.phases = [{ ...phase(), observation: "not_observed" }];
    expect(text(view(data))).toContain("No VALIDATION.md observed for this phase.");
    data.phases = [{ ...phase(), observation: "unavailable" }];
    expect(text(view(data))).toContain("VALIDATION.md could not be read safely for this phase.");
    expect(text(view(data))).not.toContain("No VALIDATION.md observed");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    expect(text(view({ availability: "available", phases: [], limited: false }))).toContain("No current-milestone phases declared in the roadmap.");
    const loading = text(render({ workspaceId: "other", snapshot: null, busy: true, error: null }));
    expect(loading).toContain("Loading validation…");
    expect(loading).not.toContain("No readable current-milestone roadmap");
    expect(text(render({ ...state(), error: "boom" }))).toContain("Could not refresh validation. The last snapshot is still displayed.");
    expect(text(render({ workspaceId: "selected", snapshot: null, busy: false, error: "boom" }))).toContain("Could not refresh validation. Try refreshing again.");
    expect(text(render({ ...state(), refreshAnnouncement: "Validation refreshed." }))).toContain("Validation refreshed.");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(render(stale))).toContain("Files changed · updating");
    const failed = state(); failed.snapshot!.freshness = "refresh-failed";
    expect(text(render(failed))).toContain("Out of date");
    expect(text(view())).not.toContain("Out of date");
    expect(phaseSummary({ ...phase(), nyquistCompliant: true, audits: [], tables: [] })).toEqual({ text: "validated", attention: false });
    const historical = { ...phase().tables[0], counts: { ...counts, failing: 0 } };
    expect(phaseSummary({ ...phase(), nyquistCompliant: true, audits: [], tables: [historical, { ...phase().tables[0], title: "Nyquist Gap Audit" }] }).text).toBe("validated");
  });
});
