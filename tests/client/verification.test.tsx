import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { disagreements, phaseSummary, statusLabel, VerificationView } from "../../client/verification-components";
import type { BoardViewState } from "../../client/board-components";
import { VERIFICATION_ROW_KINDS, type BoardVerification, type BoardVerificationPhase, type VerificationCheckTable, type VerificationRowKind } from "../../shared/verification";
import type { BoardOverview } from "../../shared/overview";
import type { BoardUat } from "../../shared/uat";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const counts = (values: Partial<Record<VerificationRowKind, number>> = {}) => ({ ...Object.fromEntries(VERIFICATION_ROW_KINDS.map((kind) => [kind, 0])), ...values }) as Record<VerificationRowKind, number>;
const row = (key: string, text: string, kind: VerificationRowKind, label: string, evidence: string | null = null) => ({ key, text, status: { kind, label, note: null }, evidence, aligned: true });
const check = (overrides: Partial<VerificationCheckTable> = {}): VerificationCheckTable => ({ title: "Key Link Verification", family: "links", rowCount: 5, counts: counts({ verified: 4, failed: 1 }), severities: null, statusRecorded: true,
  rows: [{ key: "Panel to page", status: { kind: "failed", label: "✗ NOT WIRED", note: null }, severity: null, detail: "The handler only logs.", aligned: true }], listed: "attention", ...overrides });
const phase = (): BoardVerificationPhase => ({ id: "59.2", title: "Supplier help", current: false, observation: "observed", recordedStatus: "passed", statusKind: "passed", bodyStatus: null, verifiedAt: "2026-09-21", disposedAt: null,
  score: { verified: 4, total: 4, text: null }, behaviorUnverified: 0, overridesApplied: 0, reVerification: null, gapCount: 0, openGapCount: 0, gaps: [],
  humanCount: 2, openHumanCount: 1, recordedHumanCount: 0, humanChecks: [
    { test: "Read the guide aloud", expected: "Each step reads as an instruction", whyHuman: "Tone has no oracle", state: "open", resolvedAt: null, resolution: null },
    { test: "Read the code from half a meter", expected: "Readable", whyHuman: "Needs the device", state: "resolved", resolvedAt: "2026-09-02", resolution: "Passed on the device." },
  ], humanClosed: null, humanNote: null, behaviorCount: 0, behaviorItems: [], overrideCount: 0, overrides: [], coincidentalCount: 0, deferredCount: 0, decisionCoverage: { honored: 18, total: 18, notHonored: 0 },
  truthTables: [{ title: "Observable Truths", textLabel: "Truth", rowCount: 4, counts: counts({ verified: 4 }), rows: [row("1", "Guide steps read as instructions", "verified", "✓ VERIFIED", "Journey 27/27 green"), row("2", "Panel is not modal", "verified", "✓ VERIFIED"), row("3", "Copy is plain", "verified", "✓ VERIFIED"), row("4", "Links work", "verified", "✓ WIRED")] }],
  checks: [check(), check({ title: "Requirements Coverage", family: "requirements", rowCount: 1, counts: counts({ verified: 1 }), rows: [{ key: "HELP-01", status: { kind: "verified", label: "✓ SATISFIED", note: null }, severity: null, detail: null, aligned: true }], listed: "all" }),
    check({ title: "Anti-Patterns Found", family: "antipatterns", rowCount: 3, counts: counts(), severities: { blocker: 1, warning: 1, info: 1, other: 0 }, statusRecorded: false, rows: [{ key: "TODO implement", status: null, severity: "blocker", detail: "Renders nothing", aligned: true }] })],
  gapsSummary: null, laterSections: [{ title: "Delta Re-verification 2026-09-22", date: "2026-09-22", lines: ["Truth 3 is now partial."], tables: 1 }], otherFields: ["disposition"],
  otherSections: [{ title: "Verification Metadata", lines: ["Goal-backward."] }], excerptsLimited: false });
const verification = (): BoardVerification => ({ availability: "available", limited: false, phases: [
  { ...phase(), id: "58", title: "Profile", humanCount: 0, openHumanCount: 0, humanChecks: [] },
  phase(),
  { ...phase(), id: "59.3", title: "Registries", current: true, observation: "not_observed" },
] });
const uat = { availability: "available", limited: false, phases: [{ id: "59.2", observation: "observed", testCount: 4, results: { pass: 4 } }] } as unknown as BoardUat;
const state = (data: BoardVerification = verification()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { verification: data, uat } as BoardOverview,
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
const view = (data?: BoardVerification, compact = false) => expand(VerificationView({ state: state(data), theme, compact, onRefresh: vi.fn() }));
const phaseView = (isOpen: (key: string) => boolean, data?: BoardVerification) => {
  const node = nodes(VerificationView({ state: state(data), theme, onRefresh: vi.fn() })).find((item) => typeof item.type === "function" && item.type.name === "PhaseVerification")!;
  return expand({ ...node, props: { ...node.props, isOpen } });
};
const withPhase = (overrides: Partial<BoardVerificationPhase>) => ({ ...verification(), phases: verification().phases.map((item) => item.id === "59.2" ? { ...item, ...overrides } : item) });

describe("Verification tab", () => {
  it("falls back to the most recent phase with a report, and summarizes each phase on its own", () => {
    const tree = view();
    const buttons = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Phase "));
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual(["Phase 58: passed · 4/4", "Phase 59.2: passed · 4/4 · 1 human check", "Phase 59.3, current: No report"]);
    expect(buttons.map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(text(tree)).toContain("Phase 59.3 (current) has no verification report yet; showing Phase 59.2, the most recent phase with one.");
    expect(phaseSummary(verification().phases[0])).toEqual({ text: "passed · 4/4", attention: false });
    expect(phaseSummary(phase())).toEqual({ text: "passed · 4/4 · 1 human check", attention: true });
    expect(phaseSummary({ ...phase(), observation: "unavailable" })).toEqual({ text: "Unreadable", attention: true });
    const gaps = { ...phase(), recordedStatus: "gaps_found", statusKind: "gaps_found" as const, score: { verified: 1, total: 5, text: null }, gapCount: 5, openGapCount: 5, openHumanCount: 0, behaviorCount: 1 };
    expect(phaseSummary(gaps)).toEqual({ text: "gaps found · 1/5 · 5 open gaps · 1 behavior unverified", attention: true });
  });

  it("flags recorded facts that disagree with each other, without re-judging the report", () => {
    expect(disagreements(phase())).toEqual([]);
    const conflicting = { ...phase(), bodyStatus: "human_needed", score: { verified: 5, total: 8, text: "5/8 plus 3 partial" }, openGapCount: 1, behaviorUnverified: 0, overridesApplied: 0, overrideCount: 3,
      truthTables: [{ ...phase().truthTables[0], counts: counts({ verified: 5, failed: 1, unverified: 2 }) }] };
    expect(disagreements(conflicting)).toEqual([
      "The report body still says human_needed; the header records passed.",
      "Status is passed, but the score records 5 of 8 verified.",
      "Status is passed, but the truth table records 1 failed · 2 behavior unverified.",
      "Status is passed, but 1 gap is not recorded as closed.",
      "The header records 0 behavior-unverified; the truth table shows 2.",
      "The header records 0 overrides applied but lists 3 overrides.",
    ]);
    // A report that does not claim passed is not contradicted by its open items.
    expect(disagreements({ ...conflicting, statusKind: "gaps_found", recordedStatus: "gaps_found", bodyStatus: null, behaviorUnverified: 2, overridesApplied: 3 })).toEqual([]);
    expect(text(view(withPhase({ bodyStatus: "human_needed" })))).toContain("The report body still says human_needed; the header records passed.");
  });

  it("orders open items before the truth table and keeps verified evidence and ID listings collapsed", () => {
    const tree = view();
    const content = text(tree);
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: passed", "Score: 4 of 4 verified", "Truths: 4 of 4 verified. Every row is recorded as verified (Observable Truths).", "Gaps: None recorded", "Human checks: 2 recorded · 1 unresolved"]));
    const headings = nodes(tree).filter((node) => node.props?.role === "heading").map(text);
    expect(headings.indexOf("Human verification")).toBeLessThan(headings.indexOf("Observable Truths"));
    expect(headings.indexOf("Observable Truths")).toBeLessThan(headings.indexOf("Supporting checks"));
    expect(headings.indexOf("Supporting checks")).toBeLessThan(headings.indexOf("Later dated sections"));
    expect(content).toContain("No resolution recorded");
    expect(content).toContain("Resolved 2026-09-02");
    expect(content).toContain("This phase's UAT.md records 4 of 4 tests passing; see the UAT tab.");
    expect(content).toContain("4 of 5 rows verified · 1 failed");
    expect(content).toContain("Failed · ✗ NOT WIRED");
    expect(content).toContain("3 findings · 1 blocker · 1 warning · 1 info");
    expect(content).toContain("Written after the tables above; they may revise what those tables record.");
    expect(content).toContain("1 table in this section is not interpreted.");
    expect(content).toContain("Decision coverage: 18 of 18 honored.");
    expect(content).toContain("Other header fields, not interpreted: disposition.");
    expect(content).not.toContain("Journey 27/27 green");
    expect(content).not.toContain("HELP-01");
    expect(content).not.toContain("Goal-backward.");
    const evidence = nodes(tree).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Show evidence for 4 verified truths in phase 59.2"));
    expect(evidence?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    const opened = text(phaseView(() => true));
    expect(opened).toContain("Journey 27/27 green");
    expect(opened).toContain("HELP-01");
    expect(opened).toContain("Goal-backward.");
    // Truth and check entries are not accessible groups, so every field stays reachable to screen readers.
    expect(nodes(tree).filter((node) => node.props?.accessible && !String(node.props?.accessibilityLabel).match(/^(?:Recorded status|Score|Truths|Gaps|Human checks):/))).toHaveLength(0);
  });

  it("shows gaps, behavior-unverified truths, re-verification and overrides when recorded", () => {
    const content = text(view(withPhase({ recordedStatus: "gaps_found", statusKind: "gaps_found", gapCount: 2, openGapCount: 1, gapsSummary: "The failed gap is tracked for Phase 60.",
      gaps: [{ truth: "Split secrets never reach the ring", status: "failed", statusKind: "open", previousStatus: null, reason: "The overlap leaks a suffix.", missing: 2, artifacts: 1, closedAt: null, closedBy: null, conflicting: false },
        { truth: "The pill stays inside the window", status: "closed", statusKind: "closed", previousStatus: "failed", reason: null, missing: 0, artifacts: 0, closedAt: "2026-09-01", closedBy: "Inline fix.", conflicting: true }],
      behaviorCount: 1, behaviorItems: [{ truth: "A dead session is invalidated", test: "Kill the adapter", expected: "A new adapter starts", whyHuman: "Needs a real process" }],
      reVerification: { previousStatus: "gaps_found", previousScore: "12/14", gapsClosed: 1, gapsRemaining: 1, regressions: 1, remaining: ["The seal is advanced by an automated commit."], regressionItems: ["17-12 introduced a critical defect."] },
      overrideCount: 1, overridesApplied: 1, overrides: [{ mustHave: "Mutations can repeat", reason: "Waived for the cut.", acceptedAt: "2026-08-29" }] })));
    expect(content).toContain("2 gaps recorded · 1 open");
    expect(content).toContain("2 missing items · 1 artifact (locations not shown) recorded.");
    expect(content).toContain("This gap repeats a field with different values; repeated fields are not interpreted.");
    expect(content).toContain("Gaps summary, as written: The failed gap is tracked for Phase 60.");
    expect(content).toContain("1 truth: present and wired, but no test exercised the behavior");
    expect(content).toContain("Previously gaps_found (12/14). As recorded at re-verification; later sections may update it.");
    expect(content).toContain("Regression: 17-12 introduced a critical defect.");
    expect(content).toContain("Accepted: 2026-08-29");
  });

  it("shows status qualifiers, unattributed rows, unclassified wording and every human-check state", () => {
    const content = text(view(withPhase({
      truthTables: [{ title: "Observable Truths", textLabel: "Truth", rowCount: 3, counts: counts({ verified: 1, partial: 1, other: 1 }), rows: [
        { ...row("1", "Links are wired", "partial", "✓ WIRED"), status: { kind: "partial", label: "✓ WIRED", note: "mecanicamente), ✗ SEM PISO" } },
        { ...row("2", "Export works", "other", "exit 1"), status: null, aligned: false },
        row("3", "Copy is plain", "verified", "✓ VERIFIED"),
      ] }],
      humanCount: 3, openHumanCount: 1, recordedHumanCount: 1, humanChecks: [
        { test: "Rejected check", expected: null, whyHuman: null, state: "open", resolvedAt: null, resolution: "rejected" },
        { test: "Discussed check", expected: null, whyHuman: null, state: "recorded", resolvedAt: null, resolution: "Reviewed with the team" },
        { test: "Approved check", expected: null, whyHuman: null, state: "resolved", resolvedAt: null, resolution: "Approved" },
      ],
      checks: [check({ title: "Requirements Coverage", family: "requirements", rowCount: 40, counts: counts({ verified: 39, failed: 1 }), listed: "all",
        rows: Array.from({ length: 24 }, (_, index) => ({ key: `REQ-${index}`, status: { kind: "verified" as const, label: "✓ SATISFIED", note: null }, severity: null, detail: null, aligned: true })) })],
    })));
    expect(content).toContain("Partial · ✓ WIRED");
    expect(content).toContain("mecanicamente), ✗ SEM PISO");
    expect(content).toContain("This row's cells do not line up with the table header, so its status is not read.");
    expect(content).toContain("1 truth row is recorded with wording this tab does not classify; read it below.");
    expect(content).toContain("Not resolved");
    expect(content).toContain("Outcome recorded");
    expect(content).toContain("3 checks recorded · 1 unresolved · 1 with an outcome this tab does not classify");
    expect(phaseSummary(withPhase({ humanCount: 0, openHumanCount: 0, truthTables: [{ ...phase().truthTables[0], counts: counts({ verified: 3, other: 1 }) }] }).phases[1]).attention).toBe(true);
    const blocked = withPhase({ checks: [check({ title: "Requirements Coverage", family: "requirements", rowCount: 40, counts: counts({ verified: 39, failed: 1 }), listed: "all",
      rows: [{ key: "REQ-40", status: { kind: "failed", label: "✗ BLOCKED", note: null }, severity: null, detail: null, aligned: true }] })] });
    const listing = text(phaseView(() => true, blocked));
    expect(listing).toContain("REQ-40");
    expect(listing).toContain("Showing 1 of 40 rows within the excerpt limit; rows needing attention come first.");
  });

  it("labels recorded status wording with its kind only when the wording does not name it", () => {
    expect(statusLabel({ kind: "verified", label: "✓ VERIFIED", note: null })).toBe("✓ VERIFIED");
    expect(statusLabel({ kind: "unverified", label: "PRESENT_BEHAVIOR_UNVERIFIED", note: null })).toBe("PRESENT_BEHAVIOR_UNVERIFIED");
    expect(statusLabel({ kind: "failed", label: "✗ NOT WIRED", note: null })).toBe("Failed · ✗ NOT WIRED");
    expect(statusLabel({ kind: "other", label: null, note: null })).toBe("Unclassified");
  });

  it("distinguishes no report, unreadable reports, missing roadmap, loading and stale snapshots", () => {
    const data = verification(); data.phases = [{ ...phase(), current: true, observation: "not_observed" }];
    expect(text(view(data))).toContain("No VERIFICATION.md observed for this phase yet.");
    data.phases = [{ ...phase(), current: true, observation: "unavailable" }];
    expect(text(view(data))).toContain("VERIFICATION.md could not be read safely for this phase.");
    expect(text(view(data))).not.toContain("has no verification report yet");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(VerificationView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading verification…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(expand(VerificationView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Refresh to update verification.");
    expect(text(view(withPhase({ truthTables: [] })))).toContain("No truth table with a recorded status was found in the report.");
    const plans = text(view(withPhase({ truthTables: [{ title: "Plan Must-Haves", textLabel: "Declared truths", rowCount: 1, counts: counts({ verified: 1 }), rows: [row("Plan 01", "4/4", "verified", "VERIFIED")] }] })));
    expect(plans).toContain("Plan 01");
    expect(plans).toContain("Declared truths: 4/4");
  });
});
