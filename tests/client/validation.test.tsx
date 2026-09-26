import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { latestAudit, phaseSummary, ValidationView } from "../../client/validation-components";
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
    { title: "Escalated Automated Verifications", role: "escalated", keyLabel: "Requirement", columns: ["Failing Behavior"], statusLabel: null, hiddenColumns: [], rows: [{ key: "CONT-10", cells: ["Docker cold start"], status: null, aligned: true }], rowCount: 1, irregularRows: 0, counts: null, conflicts: 0 },
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
// Render function components recursively so nested cards and tables are inspectable.
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Node;
  if (typeof value.type === "function") return expand((value.type as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
const view = (data?: BoardValidation, compact = false) => expand(ValidationView({ state: state(data), theme, compact, onRefresh: vi.fn() }));

describe("Validation tab", () => {
  it("defaults to the current phase and summarizes each phase without merging compliance into status", () => {
    const tree = view();
    const buttons = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Phase "));
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual(["Phase 15: No file", "Phase 16, current: validated · not compliant · audit escalations · failing rows", "Phase 17: Unreadable"]);
    expect(buttons.map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(text(tree)).toContain("Phase 16 · Platform idempotency");
  });

  it("shows the four facts separately and picks the latest dated audit", () => {
    const tree = view();
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: validated. Execution status: partial", "Nyquist compliant: No", "Wave 0 complete: Yes", "Latest audit: 4 gaps found · 1 resolved · 3 escalated. Validation Audit 2026-08-29"]));
    expect(latestAudit(phase().audits)?.title).toBe("Validation Audit 2026-08-29");
    expect(latestAudit([{ title: "Only", date: null, gaps: null, resolved: null, escalated: null }])?.title).toBe("Only");
    expect(text(tree)).toContain("Statuses are recorded in the document; they are not a live test run.");
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
    expect(content).toContain("4 of 7 checked");
    expect(content).toContain("2 open items are withheld by the privacy filter or excerpt limit.");
    expect(content).toContain("Approval: adversarial audit is partial");
    expect(content).toContain("Recorded; not shown (command or file location).");
  });

  it("stacks rows as cards in compact panels", () => {
    const tree = view(undefined, true);
    expect(nodes(tree).some((node) => node.props?.role === "table")).toBe(false);
    const card = nodes(tree).find((node) => node.props?.accessibilityLabel === "Per-Task Verification Map")!;
    expect(text(card)).toContain("Secure Behavior");
    expect(text(card)).toContain("Replays return the cached response");
  });

  it("distinguishes no file, unreadable documents, missing roadmap, loading and stale snapshots", () => {
    const data = validation(); data.phases = [{ ...phase(), observation: "not_observed" }];
    expect(text(view(data))).toContain("No VALIDATION.md observed for this phase.");
    data.phases = [{ ...phase(), observation: "unavailable" }];
    expect(text(view(data))).toContain("VALIDATION.md could not be read safely for this phase.");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(ValidationView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading validation…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(expand(ValidationView({ state: stale, theme, onRefresh: vi.fn() })))).toContain("Refresh to update validation.");
    expect(phaseSummary({ ...phase(), nyquistCompliant: true, audits: [], tables: [] })).toEqual({ text: "validated", attention: false });
    const historical = { ...phase().tables[0], counts: { ...counts, failing: 0 } };
    expect(phaseSummary({ ...phase(), nyquistCompliant: true, audits: [], tables: [historical, { ...phase().tables[0], title: "Nyquist Gap Audit" }] }).text).toBe("validated");
  });
});
