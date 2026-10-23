import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>()));

import { expand } from "../helpers/react-native-mock";
import { disagreements, phaseSummary, statusLabel, VerificationView, verificationNotes } from "../../client/verification-components";
import { liveStatus } from "../../client/board-frame";
import { PhasePicker, type PickerPhase } from "../../client/core-components";
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
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const label = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));
const render = (viewState: BoardViewState, compact = false) => expand(VerificationView({ state: viewState, theme, compact, onRefresh: vi.fn() }));
const view = (data?: BoardVerification, compact = false) => render(state(data), compact);
const phaseView = (isOpen: (key: string) => boolean, data?: BoardVerification) => {
  const node = nodes(VerificationView({ state: state(data), theme, onRefresh: vi.fn() })).find((item) => typeof item.type === "function" && item.type.name === "PhaseVerification")!;
  return expand({ ...node, props: { ...node.props, isOpen } });
};
const withPhase = (overrides: Partial<BoardVerificationPhase>) => ({ ...verification(), phases: verification().phases.map((item) => item.id === "59.2" ? { ...item, ...overrides } : item) });
/** The chips the picker is given, before they are rendered. */
const pickerPhases = (data?: BoardVerification) => nodes(VerificationView({ state: state(data), theme, onRefresh: vi.fn() })).find((node) => node.type === PhasePicker)!.props!.phases as PickerPhase[];
const chips = (tree: unknown) => nodes(tree).filter((node) => String(node.props?.accessibilityLabel ?? "").startsWith("Phase "));
const bars = (tree: unknown) => nodes(tree).filter((node) => node.props?.accessibilityRole === "image");
const barLabels = (tree: unknown) => bars(tree).map((node) => node.props?.accessibilityLabel);

describe("Verification tab", () => {
  it("falls back to the most recent phase with a report, and summarizes each phase on its own", () => {
    const tree = view();
    expect(chips(tree).map((node) => node.props?.accessibilityLabel)).toEqual(["Phase 58: passed · 4/4", "Phase 59.2: passed · 4/4 · 1 human check", "Phase 59.3, current: No report"]);
    expect(chips(tree).map((node) => node.props?.accessibilityState)).toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    expect(chips(tree).map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(text(tree)).toContain("Phase 59.3 (current) has no verification report yet; showing Phase 59.2, the most recent phase with one.");
    expect(nodes(tree).filter((node) => node.props?.role === "heading").map(text)).toContain("Phase 59.2 · Supplier help");
    expect(phaseSummary(verification().phases[0])).toEqual({ text: "passed · 4/4", attention: false });
    expect(phaseSummary(phase())).toEqual({ text: "passed · 4/4 · 1 human check", attention: true });
    expect(phaseSummary({ ...phase(), observation: "unavailable" })).toEqual({ text: "Unreadable", attention: true });
    const gaps = { ...phase(), recordedStatus: "gaps_found", statusKind: "gaps_found" as const, score: { verified: 1, total: 5, text: null }, gapCount: 5, openGapCount: 5, openHumanCount: 0, behaviorCount: 1 };
    expect(phaseSummary(gaps)).toEqual({ text: "gaps found · 1/5 · 5 open gaps · 1 behavior unverified", attention: true });
  });

  it("describes each phase chip by that phase alone, with a tone for gaps, open items and clean passes", () => {
    expect(pickerPhases()).toEqual([
      { id: "58", current: false, description: "passed · 4/4", tone: "success", detail: "4/4", percent: 100 },
      { id: "59.2", current: false, description: "passed · 4/4 · 1 human check", tone: "warning", detail: "4/4", percent: 100 },
      { id: "59.3", current: true, description: "No report", tone: null, detail: "no report", percent: undefined },
    ]);
    const mixed = verification();
    const clean = { ...phase(), humanCount: 0, openHumanCount: 0, humanChecks: [] };
    mixed.phases = [
      { ...clean, id: "1", recordedStatus: "gaps_found", statusKind: "gaps_found", score: { verified: 1, total: 5, text: null }, gapCount: 5, openGapCount: 5 },
      { ...clean, id: "2", gapCount: 1, openGapCount: 1 },
      { ...clean, id: "3", recordedStatus: "human_needed", statusKind: "human_needed", score: null },
      { ...clean, id: "4", score: { verified: 0, total: 0, text: null } },
      { ...clean, id: "5", current: true, observation: "unavailable" },
    ];
    expect(pickerPhases(mixed).map(({ id, tone, detail, percent }) => ({ id, tone, detail, percent }))).toEqual([
      { id: "1", tone: "danger", detail: "1/5", percent: 20 },
      // A passed report with a gap not recorded as closed is flagged, not re-judged: its detail still reads as recorded.
      { id: "2", tone: "danger", detail: "4/4", percent: 100 },
      { id: "3", tone: "warning", detail: "human needed", percent: undefined },
      { id: "4", tone: "success", detail: "0/0", percent: undefined },
      { id: "5", tone: "warning", detail: "unreadable", percent: undefined },
    ]);
    // The tone shows as a glyph beside the phase id, and the short detail under it.
    expect(chips(view(mixed)).map(text)).toEqual(["1✕1/5", "2✕4/4", "3!human needed", "4✓0/0", "5!unreadable"]);
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
    const tree = view(withPhase({ bodyStatus: "human_needed" }));
    expect(nodes(tree).filter((node) => node.props?.role === "alert").map(text)).toContain("The report body still says human_needed; the header records passed.");
    // The recorded status stays as written beside the disagreement.
    expect(label(tree, "Recorded status:")?.props?.accessibilityLabel).toBe("Recorded status: passed");
  });

  it("orders open items before the truth table and keeps verified evidence and ID listings collapsed", () => {
    const tree = view();
    const content = text(tree);
    const facts = nodes(tree).filter((node) => node.props?.accessible && typeof node.props?.accessibilityLabel === "string").map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(expect.arrayContaining(["Recorded status: passed", "Score: 4 of 4 verified", "Truths: 4 of 4 verified, Every row is recorded as verified (Observable Truths).", "Gaps: None recorded", "Human checks: 2 recorded · 1 unresolved"]));
    const headings = nodes(tree).filter((node) => node.props?.role === "heading").map(text);
    expect(headings.indexOf("Human verification")).toBeGreaterThan(-1);
    expect(headings.indexOf("Human verification")).toBeLessThan(headings.indexOf("Observable Truths"));
    expect(headings.indexOf("Observable Truths")).toBeLessThan(headings.indexOf("Supporting checks"));
    expect(headings.indexOf("Supporting checks")).toBeLessThan(headings.indexOf("Later dated sections"));
    expect(content).toContain("VERIFICATION.md observed · Verified 2026-09-21");
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
    expect(label(tree, "Show evidence for 4 verified truths in phase 59.2")?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    expect(label(tree, "Show 1 row in Requirements Coverage")?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    const opened = text(phaseView(() => true));
    expect(opened).toContain("Journey 27/27 green");
    expect(opened).toContain("HELP-01");
    expect(opened).toContain("Goal-backward.");
    // Truth and check entries are not accessible groups, so every field stays reachable to screen readers. The only other
    // accessible nodes are the score and truth bars, images with no text inside them.
    const groups = nodes(tree).filter((node) => node.props?.accessible);
    expect(groups.filter((node) => node.props?.accessibilityRole !== "image" && !String(node.props?.accessibilityLabel).match(/^(?:Recorded status|Score|Truths|Gaps|Human checks):/))).toHaveLength(0);
    expect(barLabels(tree)).toEqual(["4 of 4 verified", "4 verified"]);
    expect(bars(tree).map(text)).toEqual(["", ""]);
  });

  it("draws the score and each truth table as bars whose labels read the recorded counts", () => {
    const all = counts({ verified: 5, failed: 1, partial: 1, unverified: 2, human: 1, pending: 1, uncertain: 1, override: 1, deferred: 1, other: 1 });
    const tree = view(withPhase({ score: { verified: 5, total: 8, text: "5/8 plus 3 partial" }, truthTables: [{ ...phase().truthTables[0], rowCount: 15, counts: all },
      { title: "Plan Must-Haves", textLabel: "Declared truths", rowCount: 2, counts: counts({ verified: 1, failed: 1 }), rows: [] }] }));
    expect(barLabels(tree)).toEqual([
      "5 of 8 verified",
      "5 verified, 1 failed, 1 partial, 2 behavior unverified, 1 needs human, 1 pending, 1 uncertain, 1 override, 1 deferred, 1 unclassified",
      "1 verified, 1 failed",
    ]);
    expect(nodes(tree).filter((node) => node.type === "Text").map(text)).toEqual(expect.arrayContaining(["2 behavior unverified", "1 needs human", "1 unclassified"]));
    // No recorded score, or a score out of nothing, draws no score bar.
    expect(barLabels(view(withPhase({ score: null })))).toEqual(["4 verified"]);
    expect(barLabels(view(withPhase({ score: { verified: 0, total: 0, text: null } })))).toEqual(["4 verified"]);
    expect(barLabels(view(withPhase({ truthTables: [] })))).toEqual(["4 of 4 verified"]);
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
    const tree = view(withPhase({
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
    }));
    const content = text(tree);
    expect(content).toContain("Partial · ✓ WIRED");
    expect(content).toContain("mecanicamente), ✗ SEM PISO");
    expect(content).toContain("This row's cells do not line up with the table header, so its status is not read.");
    expect(content).toContain("Status not read");
    expect(content).toContain("1 truth row is recorded with wording this tab does not classify; read it below.");
    const human = nodes(tree).filter((node) => node.type === "Text").map(text);
    expect(human).toEqual(expect.arrayContaining(["Rejected check", "Not resolved", "Discussed check", "Outcome recorded", "Approved check", "Resolved"]));
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

  it("keeps omitted and shortened excerpts visible under the phase heading", () => {
    const content = text(view(withPhase({ excerptsLimited: true, gapsSummary: "Run [omitted] again." })));
    expect(content).toContain("Commands, absolute paths, links and host-like text are shown as [omitted].");
    expect(content).toContain("Some verification text could not be safely extracted or was shortened.");
    expect(text(view())).not.toContain("shown as [omitted]");
  });

  it("keeps the caveats under About these figures and the limited notice in view", () => {
    expect(verificationNotes()).toEqual([
      "Results are recorded in the report; they are not a live check.",
      "Verification is per phase, so nothing is aggregated across phases. Disagreements are facts of the same report that do not match; the report is not re-judged.",
    ]);
    expect((VerificationView({ state: state(), theme, onRefresh: vi.fn() }) as Node).props?.notes).toEqual(verificationNotes());
    const tree = view();
    expect(label(tree, "About these figures")?.props?.accessibilityState).toEqual({ expanded: false });
    expect(text(tree)).not.toContain("not a live check");
    expect(text(tree)).not.toContain("Some verification evidence or safe excerpts may be incomplete.");
    expect(text(view({ ...verification(), limited: true }))).toContain("Some verification evidence or safe excerpts may be incomplete.");
  });

  it("distinguishes no report, unreadable reports, missing roadmap, loading, failed refreshes and stale snapshots", () => {
    const data = verification(); data.phases = [{ ...phase(), current: true, observation: "not_observed" }];
    expect(text(view(data))).toContain("No VERIFICATION.md observed for this phase yet.");
    data.phases = [{ ...phase(), current: true, observation: "unavailable" }];
    expect(text(view(data))).toContain("VERIFICATION.md could not be read safely for this phase.");
    expect(text(view(data))).not.toContain("has no verification report yet");
    expect(text(view({ availability: "unavailable", phases: [], limited: false }))).toContain("No readable current-milestone roadmap was found.");
    expect(text(view({ availability: "available", phases: [], limited: false }))).toContain("No current-milestone phases declared in the roadmap.");
    const loading = text(render({ workspaceId: "other", snapshot: null, busy: true, error: null }));
    expect(loading).toContain("Loading verification…");
    expect(loading).not.toContain("No readable current-milestone roadmap");
    expect(text(render({ ...state(), error: "boom" }))).toContain("Could not refresh verification. The last snapshot is still displayed.");
    expect(text(render({ workspaceId: "selected", snapshot: null, busy: false, error: "boom" }))).toContain("Could not refresh verification. Try refreshing again.");
    expect(text(render({ ...state(), refreshAnnouncement: "Verification refreshed." }))).toContain("Verification refreshed.");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(render(stale, true))).toContain("Files changed · updating");
    const failed = state(); failed.snapshot!.freshness = "refresh-failed";
    expect(text(render(failed))).toContain("Out of date");
    expect(text(view())).not.toContain("Out of date");
    expect(text(view(withPhase({ truthTables: [] })))).toContain("No truth table with a recorded status was found in the report.");
    const plans = text(view(withPhase({ truthTables: [{ title: "Plan Must-Haves", textLabel: "Declared truths", rowCount: 1, counts: counts({ verified: 1 }), rows: [row("Plan 01", "4/4", "verified", "VERIFIED")] }] })));
    expect(plans).toContain("Plan 01");
    expect(plans).toContain("Declared truths: 4/4");
  });
});
