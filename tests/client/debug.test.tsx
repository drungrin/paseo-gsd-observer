import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const hooks = (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>());
  return { ...hooks, useState: vi.fn(hooks.useState) };
});

import { useState } from "react";
import { expand } from "../helpers/react-native-mock";
import { debugNotes, DebugView, matchingSessions, SessionDetails, SessionRow } from "../../client/debug-components";
import type { BoardViewState } from "../../client/board-components";
import { liveStatus } from "../../client/board-frame";
import type { BoardDebug, DebugSession } from "../../shared/debug";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const item = (overrides: Partial<DebugSession> = {}): DebugSession => ({
  id: "a1b2c3d4e5f6", location: "active", slug: "login-mobile-sessao-falha", title: null, statusKind: "awaiting-verification", recordedStatus: "awaiting_human_verify",
  goal: null, bugClass: "bohrbug", phaseId: null, createdAt: "2026-09-08", updatedAt: "2026-09-08", resolvedAt: null, notes: [],
  trigger: "Login fails on the mobile app.", expected: null, actual: null, hypothesis: "Two routes map the same bearer login.", nextAction: "Promote the fixed build and retry the login.",
  rootCause: null, fix: null, verification: null, verificationStructured: false, evidenceCount: 4, eliminatedCount: 1, filesChangedCount: null, detailsWithheld: false, excerptsLimited: false, ...overrides,
});
const counts = (overrides: Partial<BoardDebug["counts"]> = {}): BoardDebug["counts"] => ({ active: 3, archived: 2, attention: 4, unresolved: 3, open: 0, diagnosed: 1, awaitingVerification: 1, blocked: 1, resolved: 1, unclassified: 1,
  reconciliation: 1, unavailable: 0, knowledgeBase: 1, notes: 0, displayed: 5, ...overrides });
const stored = (selection: { workspaceId: string; status: string; location: string; expanded: string[] }, setter = vi.fn()) => {
  vi.mocked(useState).mockImplementationOnce((() => [selection, setter]) as unknown as typeof useState);
  return setter;
};
const data = (): BoardDebug => ({ availability: "available", directoryState: "observed", archiveState: "observed", countsComplete: true, limited: false, counts: counts(), sessions: [
  item({ id: "000000000001", slug: "pool-driver-notfound", statusKind: "blocked", recordedStatus: "blocked" }),
  item(),
  item({ id: "000000000003", location: "archived", slug: "calendario-estavel-por-conta", statusKind: "diagnosed", recordedStatus: "diagnosed", notes: ["archived-unresolved"] }),
  item({ id: "000000000004", slug: "job-intervencao-autorizada", title: "Controlled intervention in dev", statusKind: "unrecorded", recordedStatus: null }),
  item({ id: "000000000005", location: "archived", slug: "perfil-externo-outro-setor", statusKind: "resolved", recordedStatus: "resolved", resolvedAt: "2026-08-12" }),
] });
const state = (debug: BoardDebug = data()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { debug } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
/** The headline figures, without the status bar that also carries an accessible label. */
const facts = (tree: unknown) => nodes(tree).filter((node) => node.props?.accessible && node.props?.accessibilityRole !== "image").map((node) => node.props?.accessibilityLabel);
const bar = (tree: unknown) => nodes(tree).find((node) => node.props?.accessible && node.props?.accessibilityRole === "image");
/** Session row toggles; the folded "About these figures" notes are a disclosure too, but not a session. */
const sessionRows = (tree: unknown) => nodes(tree).filter((node) => (node.props?.accessibilityState as { expanded?: boolean } | undefined)?.expanded !== undefined && node.props?.accessibilityLabel !== "About these figures");
const view = (debug?: BoardDebug, compact = false) => expand(DebugView({ state: state(debug), theme, compact, onRefresh: vi.fn() }));

describe("Debug tab", () => {
  it("opens on sessions that need attention with recorded statuses, locations and collapsed rows", () => {
    const tree = view();
    const content = text(tree);
    expect(debugNotes()[0]).toContain("GSD debug sessions in the active debug directory and its resolved archive.");
    expect(debugNotes()[0]).toContain("statuses are as recorded in each file, not re-verified.");
    expect(content).toContain("5 session files found (3 active, 2 archived) · 5 safe rows shown. Recorded statuses, not live checks.");
    expect(content).toContain("The debug knowledge base is not a session and is not listed.");
    expect(content).toContain("4 sessions match the current filters.");
    expect(content).not.toContain("perfil-externo-outro-setor");
    expect(content).toContain("Recorded: awaiting_human_verify · Active directory · Updated 2026-09-08");
    expect(content).toContain("Controlled intervention in dev");
    // The status pill sits beside the name; the reconciliation flag under the placement line.
    expect(content).toContain("Controlled intervention in devNo recorded status");
    expect(content).toContain("pool-driver-notfoundBlockedRecorded: blocked");
    expect(content).toContain("calendario-estavel-por-contaDiagnosedRecorded: diagnosed · Resolved archive · Updated 2026-09-08Needs reconciliation");
    expect(content).not.toContain("Promote the fixed build");
    expect(facts(tree)).toEqual(["Unresolved: 3", "Awaiting verification: 1", "Blocked: 1", "Unclassified: 1", "Resolved: 1", "Needs reconciliation: 1"]);
    expect(debugNotes()).toContain("Needs attention: not recorded as resolved, or recorded in a way that needs reconciliation.");
    const filters = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Filter:"));
    expect(filters.map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: Needs attention", "Filter: All", "Filter: Unresolved", "Filter: Open", "Filter: Diagnosed", "Filter: Awaiting verification",
      "Filter: Blocked", "Filter: Resolved", "Filter: Needs reconciliation", "Filter: Unclassified", "Filter: Any location", "Filter: Active directory", "Filter: Resolved archive"]);
    expect(filters[0].props).toMatchObject({ accessibilityState: { selected: true }, "aria-pressed": true });
    expect(filters[10].props).toMatchObject({ accessibilityState: { selected: true }, "aria-pressed": true });
    const rows = sessionRows(tree);
    expect(rows.map((node) => node.props?.accessibilityLabel)).toEqual([
      "pool-driver-notfound. Blocked. Recorded: blocked. Active directory. Show details",
      "login-mobile-sessao-falha. Awaiting human verification. Recorded: awaiting_human_verify. Active directory. Show details",
      "calendario-estavel-por-conta. Diagnosed. Recorded: diagnosed. Resolved archive. Needs reconciliation. Show details",
      "Controlled intervention in dev. No recorded status. Active directory. Show details",
    ]);
    expect(rows[0].props).toMatchObject({ accessibilityRole: "button", "aria-expanded": false });
    expect(text(view(undefined, true))).toContain("pool-driver-notfound");
  });

  it("splits the status bar by recorded status and reads it out in words", () => {
    const tree = view();
    // Unresolved less awaiting verification and blocked is what remains open or diagnosed.
    expect(bar(tree)?.props?.accessibilityLabel).toBe("1 open or diagnosed, 1 awaiting verification, 1 blocked, 1 unclassified, 1 resolved");
    expect(text(tree)).toContain("1 open or diagnosed1 awaiting verification1 blocked1 unclassified1 resolved");
    const resolved = { ...data(), sessions: [data().sessions[4]], counts: counts({ active: 0, archived: 1, attention: 0, unresolved: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 1, unclassified: 0, reconciliation: 0, displayed: 1 }) };
    const calm = view(resolved);
    expect(bar(calm)?.props?.accessibilityLabel).toBe("0 open or diagnosed, 0 awaiting verification, 0 blocked, 0 unclassified, 1 resolved");
    // The legend lists only statuses that have sessions.
    expect(text(calm)).toContain("1 resolved");
    expect(text(calm)).not.toContain("0 blocked");
    const empty = { ...data(), sessions: [], counts: counts({ active: 0, archived: 0, unresolved: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 0, unclassified: 0, reconciliation: 0, knowledgeBase: 0, displayed: 0 }) };
    expect(bar(view(empty))).toBeUndefined();
  });

  it("keeps qualifiers visible and folds the reading notes", () => {
    const element = DebugView({ state: state(), theme, onRefresh: vi.fn() }) as { props: { notes: string[]; alerts: string[] } };
    expect(element.props.notes).toEqual(debugNotes());
    expect(element.props.alerts).toEqual([]);
    const partial = { ...data(), countsComplete: false, limited: true, counts: counts({ unavailable: 2, displayed: 4 }) };
    expect(DebugView({ state: state(partial), theme, onRefresh: vi.fn() }).props.alerts).toEqual([
      "The debug inventory or its safe excerpts are incomplete; counts cover only observed files.",
      "2 debug files or directories could not be read, so sessions there may be missing and their status is unknown.",
    ]);
    const tree = view();
    expect(nodes(tree).find((node) => node.props?.accessibilityLabel === "About these figures")?.props).toMatchObject({ accessibilityState: { expanded: false } });
    expect(text(tree)).not.toContain("not re-verified");
  });

  it("filters by recorded status and location without reclassifying archived sessions", () => {
    const source = data();
    expect(matchingSessions(source, "attention", "all").map((entry) => entry.slug)).toEqual(["pool-driver-notfound", "login-mobile-sessao-falha", "calendario-estavel-por-conta", "job-intervencao-autorizada"]);
    expect(matchingSessions(source, "unresolved", "all").map((entry) => entry.slug)).toEqual(["pool-driver-notfound", "login-mobile-sessao-falha", "calendario-estavel-por-conta"]);
    // A resolved session still in the active directory needs attention even though it is recorded as resolved.
    const misplaced = { ...source, sessions: [...source.sessions, item({ id: "000000000006", slug: "apply-sem-cluster", statusKind: "resolved", recordedStatus: "resolved", notes: ["resolved-not-archived"] })] };
    expect(matchingSessions(misplaced, "attention", "all").map((entry) => entry.slug)).toContain("apply-sem-cluster");
    expect(matchingSessions(misplaced, "unresolved", "all").map((entry) => entry.slug)).not.toContain("apply-sem-cluster");
    expect(matchingSessions(source, "resolved", "all").map((entry) => entry.slug)).toEqual(["perfil-externo-outro-setor"]);
    expect(matchingSessions(source, "reconciliation", "all").map((entry) => entry.slug)).toEqual(["calendario-estavel-por-conta"]);
    expect(matchingSessions(source, "unclassified", "all").map((entry) => entry.slug)).toEqual(["job-intervencao-autorizada"]);
    expect(matchingSessions(source, "all", "archived").map((entry) => entry.slug)).toEqual(["calendario-estavel-por-conta", "perfil-externo-outro-setor"]);
    expect(matchingSessions(source, "diagnosed", "active")).toEqual([]);
    expect(matchingSessions(source, "all", "all")).toHaveLength(5);
  });

  it("expands a row into recorded wording, placement notes and tallies without implying a live check", () => {
    const onToggle = vi.fn();
    const collapsed = expand(SessionRow({ session: item(), expanded: false, onToggle, theme, compact: false }));
    (nodes(collapsed).find((node) => node.props?.accessibilityRole === "button")!.props!.onPress as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
    const open = expand(SessionRow({ session: item(), expanded: true, onToggle, theme, compact: true }));
    expect(nodes(open).find((node) => node.props?.accessibilityRole === "button")?.props).toMatchObject({ accessibilityState: { expanded: true }, "aria-expanded": true });
    const content = text(open);
    expect(content).toContain("Trigger: Login fails on the mobile app.");
    expect(content).toContain("Focus, as last recorded");
    expect(content).toContain("Hypothesis: Two routes map the same bearer login.");
    expect(content).toContain("Next action: Promote the fixed build and retry the login.");
    expect(content).toContain("Bug class: bohrbug");
    expect(content).toContain("Created 2026-09-08 · Updated 2026-09-08");
    expect(content).toContain("4 evidence entries · 1 eliminated hypothesis");
    expect(content).not.toContain("Session: ");

    const details = text(expand(SessionDetails({ theme, session: item({
      title: "Civil servant in another agency", location: "archived", statusKind: "diagnosed", notes: ["archived-unresolved", "resolution-status"], goal: "diagnose-only",
      expected: "A friendly domain failure.", actual: "An unhandled internal error.", rootCause: "A tenant-scoped query hid a global key.", fix: "(não aplicado — goal: find_root_cause_only)",
      verificationStructured: true, evidenceCount: 1, eliminatedCount: 2, filesChangedCount: 1, excerptsLimited: true,
    }) })));
    expect(details).toContain("Moved to the resolved archive, but the recorded status is not resolved.");
    expect(details).toContain("A resolution section records a different status than the file's status line; reconcile before acting.");
    expect(details).toContain("Session: login-mobile-sessao-falha");
    expect(details).toContain("Goal: Find root cause only (no fix)");
    expect(details).toContain("Expected: A friendly domain failure.");
    expect(details).toContain("Observed: An unhandled internal error.");
    expect(details).toContain("Resolution, as recorded");
    expect(details).toContain("Fix: (não aplicado — goal: find_root_cause_only)");
    expect(details).toContain("Verification is recorded as a structured record; it is not summarized here.");
    expect(details).toContain("1 evidence entry · 2 eliminated hypotheses · 1 file listed as changed");
    expect(details).toContain("Some wording was withheld or shortened for safe display.");
    const unrecorded = text(expand(SessionDetails({ theme, session: item({ location: "archived", statusKind: "unrecorded", notes: ["archived-unresolved", "resolved-not-archived", "duplicate-slug"] }) })));
    expect(unrecorded).toContain("Moved to the resolved archive, but the file records no status.");
    expect(unrecorded).toContain("Recorded as resolved, but still in the active debug directory.");
    expect(unrecorded).toContain("A file with the same name exists in the other location; neither record is preferred.");
    const withheld = text(expand(SessionDetails({ theme, session: item({ trigger: null, hypothesis: null, nextAction: null, detailsWithheld: true, evidenceCount: null, eliminatedCount: null }) })));
    expect(withheld).toContain("Details were withheld to keep the snapshot bounded.");
    expect(withheld).not.toContain("No safe details");
    expect(text(expand(SessionDetails({ theme, session: item({ trigger: null, hypothesis: null, nextAction: null }) })))).toContain("No safe details were recorded for this session.");
    expect(text(expand(SessionRow({ session: item({ title: null, slug: null }), expanded: false, onToggle, theme, compact: false })))).toContain("Session name withheld");
  });

  it("distinguishes unavailable, absent, empty, incomplete, fully resolved, loading and stale states", () => {
    const empty = { ...data(), sessions: [], counts: counts({ active: 0, archived: 0, unresolved: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 0, unclassified: 0, reconciliation: 0, knowledgeBase: 0, displayed: 0 }) };
    expect(text(view({ ...empty, directoryState: "absent", archiveState: "absent" }))).toContain("No .planning/debug directory was observed for this workspace. Debug sessions are created by /gsd-debug.");
    expect(text(view(empty))).toContain("The observed debug directory has no session files.");
    const onlyNotes = text(view({ ...empty, counts: { ...empty.counts, notes: 2 } }));
    expect(onlyNotes).toContain("The observed debug directory has no session files. 2 other Markdown notes are not sessions.");
    expect(onlyNotes).not.toContain("knowledge base");
    expect(text(view({ ...empty, counts: { ...empty.counts, knowledgeBase: 1 } }))).toContain("The observed debug directory has no session files. Its knowledge base is not a session.");
    expect(text(view({ ...empty, counts: { ...empty.counts, unavailable: 2 }, countsComplete: false, limited: true }))).toContain("2 debug files or directories could not be safely read; no sessions are shown.");
    // Files that were enumerated but could not be read never become "nothing to do".
    const unreadable = { ...empty, counts: { ...empty.counts, active: 1, unavailable: 1 } };
    const unreadableText = text(view(unreadable));
    expect(unreadableText).toContain("1 debug file or directory could not be safely read; no sessions are shown.");
    expect(unreadableText).not.toContain("No session needs attention");
    expect(text(view({ ...empty, availability: "unavailable", directoryState: "unknown", archiveState: "unknown" }))).toContain("No readable planning inventory was found for this workspace.");
    const resolved = { ...data(), sessions: [data().sessions[4]], counts: counts({ active: 0, archived: 1, attention: 0, unresolved: 0, diagnosed: 0, awaitingVerification: 0, blocked: 0, resolved: 1, unclassified: 0, reconciliation: 0, displayed: 1 }) };
    expect(text(view(resolved))).toContain("No session needs attention: every readable session is recorded as resolved and placed consistently. Choose All to include resolved sessions.");
    const halfRead = { ...resolved, counts: { ...resolved.counts, active: 1, unavailable: 1 } };
    const halfReadText = text(view(halfRead));
    expect(halfReadText).toContain("No readable session needs attention; 1 debug file or directory could not be read, so sessions there may be missing and their status is unknown.");
    expect(halfReadText).toContain("2 session files found (1 active, 1 archived)");
    expect(halfReadText).not.toContain("Choose All");
    expect(facts(view(halfRead))).toEqual(["Unresolved: At least 0", "Awaiting verification: At least 0", "Blocked: At least 0", "Unclassified: At least 0", "Resolved: At least 1", "Needs reconciliation: At least 0"]);
    // The bar and its legend are lower bounds too, like the figures above them.
    expect(bar(view(halfRead))?.props?.accessibilityLabel).toBe("at least 0 open or diagnosed, at least 0 awaiting verification, at least 0 blocked, at least 0 unclassified, at least 1 resolved");
    expect(halfReadText).toContain("at least 1 resolved");
    const partial = { ...data(), countsComplete: false, limited: true, archiveState: "absent" as const, counts: counts({ unavailable: 1, displayed: 4, notes: 2 }) };
    const partialText = text(view(partial));
    expect(partialText).toContain("The debug inventory or its safe excerpts are incomplete; counts cover only observed files.");
    expect(partialText).toContain("At least 5 session files found");
    expect(partialText).toContain("Unresolved");
    expect(partialText).toContain("At least 3");
    expect(partialText).toContain("1 debug file or directory could not be read, so sessions there may be missing and their status is unknown.");
    expect(partialText).toContain("2 other Markdown notes in the debug directories are not sessions and are not listed.");
    expect(partialText).toContain("No resolved archive directory was observed.");
    expect(partialText).toContain("; some files have no safe row.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(expand(DebugView({ state: loading, theme, onRefresh: vi.fn() })))).toContain("Loading debug sessions…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(expand(DebugView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Files changed · updating");
    const failed = { ...state(), error: "Could not refresh evidence." };
    const failedText = text(expand(DebugView({ state: failed, theme, onRefresh: vi.fn() })));
    expect(failedText).toContain("Could not refresh debug sessions. The last snapshot is still displayed.");
    expect(failedText).toContain("Out of date");
  });

  it("resets filters and expansion on a workspace change and ignores stale expanded ids", () => {
    stored({ workspaceId: "other", status: "blocked", location: "archived", expanded: ["000000000001"] });
    const reset = view();
    const filters = nodes(reset).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Filter:"));
    expect(filters.filter((node) => node.props?.["aria-pressed"]).map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: Needs attention", "Filter: Any location"]);
    expect(nodes(reset).filter((node) => node.props?.["aria-expanded"] === true)).toHaveLength(0);

    stored({ workspaceId: "selected", status: "all", location: "all", expanded: ["deadbeef0000", "000000000001"] });
    const kept = view();
    expect(nodes(kept).filter((node) => node.props?.["aria-expanded"] === true).map((node) => node.props?.accessibilityLabel)).toEqual(["pool-driver-notfound. Blocked. Recorded: blocked. Active directory. Hide details"]);
    expect(text(kept)).toContain("5 sessions match the current filters.");

    const setter = stored({ workspaceId: "other", status: "blocked", location: "archived", expanded: ["000000000001"] });
    const tree = view();
    (nodes(tree).find((node) => node.props?.accessibilityLabel === "Filter: Resolved")!.props!.onPress as () => void)();
    expect(setter).toHaveBeenLastCalledWith({ workspaceId: "selected", status: "resolved", location: "all", expanded: [] });
    (nodes(tree).find((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("login-mobile-sessao-falha."))!.props!.onPress as () => void)();
    expect(setter).toHaveBeenLastCalledWith({ workspaceId: "selected", status: "attention", location: "all", expanded: ["a1b2c3d4e5f6"] });
  });
});
