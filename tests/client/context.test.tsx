import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const hooks = (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>());
  return { ...hooks, useState: vi.fn(hooks.useState) };
});

import { useState } from "react";
import { expand } from "../helpers/react-native-mock";
import { contextNotes, ContextView } from "../../client/context-components";
import type { BoardViewState } from "../../client/board-components";
import { liveStatus } from "../../client/board-frame";
import type { BoardContext, BoardContextPhase } from "../../shared/context";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4" } };
const phase = (): BoardContextPhase => ({ id: "59.3", title: "Independent registries", current: true, observation: "observed", gatheredAt: "2026-09-23", recordedStatus: "Ready for planning",
  boundary: ["Drafts must be confirmed explicitly."], decisionCount: 3, decisionGroups: [{ title: "Lifecycle", decisions: [{ id: "D-01", title: null, text: "Drafts can be edited." }, { id: "D-02", title: null, text: "Confirmed changes preserve history." }] }],
  discretion: ["Select the storage model."], specifics: ["Show drafts in the list."], deferred: ["Financial reports come later."], referencesObserved: true, amendmentsObserved: true,
  insights: [{ title: "Reusable Assets", lines: ["Existing list components are reusable."] }], sourceSections: [{ title: "Later amendments", lines: ["Review before confirmation."] }], excerptsLimited: true });
const context = (): BoardContext => ({ availability: "available", limited: true, phases: [
  { ...phase(), id: "59.2", title: "Prior phase", current: false, observation: "not_observed" },
  phase(),
  { ...phase(), id: "60", title: "Billing", current: false, observation: "not_observed" },
] });
const state = (data: BoardContext = context()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { context: data } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const view = (viewState: BoardViewState = state(), compact = false) => expand(ContextView({ state: viewState, theme, compact, onRefresh: vi.fn() }));
const chips = (tree: unknown) => nodes(tree).filter((node) => node.props?.role === "button" && String(node.props?.accessibilityLabel ?? "").startsWith("Phase "));
const heading = (tree: unknown, title: string) => nodes(tree).find((node) => node.props?.role === "heading" && text(node) === title);
/** The next ContextView render reads these as its phase selection and its open source excerpts. */
const stored = (selection: { workspaceId: string; phaseId: string } | null, openSource: { workspaceId: string; phaseId: string } | null = null) => {
  const setSelection = vi.fn();
  const setOpenSource = vi.fn();
  vi.mocked(useState).mockImplementationOnce((() => [selection, setSelection]) as unknown as typeof useState).mockImplementationOnce((() => [openSource, setOpenSource]) as unknown as typeof useState);
  return { setSelection, setOpenSource };
};

describe("Context tab", () => {
  it("defaults to the current dotted phase, preserving roadmap order and honest observation", () => {
    const tree = view();
    const buttons = chips(tree);
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual([
      "Phase 59.2: no context observed", "Phase 59.3, current: context observed, later amendments recorded", "Phase 60: no context observed",
    ]);
    expect(buttons.map((node) => node.props?.accessibilityState)).toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    expect(buttons.map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(nodes(tree).find((node) => node.props?.role === "list")?.props?.accessibilityLabel).toBe("Context phases");
    const content = text(tree);
    expect(heading(tree, "Phase 59.3 · Independent registries")).toBeDefined();
    expect(content).not.toContain("Phase 59.2 · Prior phase");
    expect(content).toContain("CONTEXT.mdPhase 59.3 · Independent registriesContext observed · Gathered 2026-09-23 · Document status: Ready for planning");
    // The recorded status is what the file said when gathered; the caveat travels with the tab's notes.
    expect(contextNotes()).toContain("The document status is what CONTEXT.md recorded when it was gathered, not live phase progress.");
    expect(contextNotes()).toContain("Recorded context decisions are not independent verification of implementation.");
    expect(content).toContain("Later amendments are recorded; earlier decision excerpts may have been superseded. Review the source before relying on them.");
    expect(content).toContain("Some context sections could not be safely extracted or were shortened.");
    expect(content).toContain("Some context evidence or safe excerpts may be incomplete.");
    expect(heading(tree, "Decisions · 2 of 3 excerpts")).toBeDefined();
    expect(content).toContain("Canonical references recorded; file locations are not included");
    const sourceControl = nodes(tree).find((node) => (node.props?.accessibilityLabel as string | undefined)?.includes("safe source excerpts for phase 59.3"));
    expect(sourceControl?.props).toMatchObject({ accessibilityLabel: "Show safe source excerpts for phase 59.3", accessibilityState: { expanded: false }, "aria-expanded": false });
    expect(content).not.toContain("Review before confirmation.");
  });

  it("opens the safe source excerpts only for the selected phase of the selected workspace", () => {
    const { setOpenSource } = stored(null);
    const closed = view();
    (nodes(closed).find((node) => node.props?.accessibilityLabel === "Show safe source excerpts for phase 59.3")!.props!.onPress as () => void)();
    expect(setOpenSource).toHaveBeenLastCalledWith({ workspaceId: "selected", phaseId: "59.3" });

    stored(null, { workspaceId: "selected", phaseId: "59.3" });
    const open = view();
    expect(nodes(open).find((node) => node.props?.accessibilityLabel === "Hide safe source excerpts for phase 59.3")?.props).toMatchObject({ accessibilityState: { expanded: true }, "aria-expanded": true });
    expect(text(open)).toContain("Selected safe excerpts in source order; not the full CONTEXT.md.");
    expect(text(open)).toContain("Review before confirmation.");

    // Excerpts opened in another workspace stay closed here.
    stored(null, { workspaceId: "other", phaseId: "59.3" });
    expect(text(view())).not.toContain("Review before confirmation.");
  });

  it("selects a phase per workspace and falls back to the current phase for a stale or foreign selection", () => {
    const { setSelection } = stored(null);
    const tree = view();
    (chips(tree)[0].props!.onPress as () => void)();
    expect(setSelection).toHaveBeenLastCalledWith({ workspaceId: "selected", phaseId: "59.2" });

    stored({ workspaceId: "selected", phaseId: "60" });
    const chosen = view();
    expect(chips(chosen).map((node) => (node.props?.accessibilityState as { selected: boolean }).selected)).toEqual([false, false, true]);
    expect(text(chosen)).toContain("No context observed for this phase.");

    stored({ workspaceId: "other", phaseId: "60" });
    expect(chips(view()).map((node) => (node.props?.accessibilityState as { selected: boolean }).selected)).toEqual([false, true, false]);
    stored({ workspaceId: "selected", phaseId: "61" });
    expect(chips(view()).map((node) => (node.props?.accessibilityState as { selected: boolean }).selected)).toEqual([false, true, false]);
  });

  it("describes each picker chip by what was observed, not by phase progress", () => {
    // As the reader produces them: amendments are only ever recorded for an observed file.
    const data = context();
    data.phases[0] = { ...data.phases[0], observation: "unavailable", amendmentsObserved: false };
    data.phases[2] = { ...data.phases[2], observation: "observed", amendmentsObserved: false, decisionCount: 0 };
    data.phases.push({ ...phase(), id: "61", title: "Reports", current: false, observation: "not_observed", amendmentsObserved: false, decisionCount: 0 });
    const buttons = chips(view(state(data)));
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual([
      "Phase 59.2: context unavailable", "Phase 59.3, current: context observed, later amendments recorded", "Phase 60: context observed", "Phase 61: no context observed",
    ]);
    // The short visible line: unreadable and amended phases carry a warning mark, the rest none.
    expect(buttons.map(text)).toEqual(["59.2!unreadable", "59.3!3 decisions", "60observed", "61no context"]);
  });

  it("sums the briefing in four figures without implying implementation", () => {
    const tree = view();
    expect(nodes(tree).filter((node) => node.props?.accessible).map((node) => node.props?.accessibilityLabel)).toEqual([
      "Decisions: 3, 2 shown as excerpts", "Discretion: 1, shown as excerpts", "Deferred ideas: 1, shown as excerpts", "Specific ideas: 1, shown as excerpts",
    ]);
    const element = ContextView({ state: state(), theme, onRefresh: vi.fn() }) as { props: { notes: string[]; alerts: string[] } };
    expect(element.props.notes).toEqual(contextNotes());
    expect(element.props.alerts).toEqual(["Some context evidence or safe excerpts may be incomplete."]);
    expect(ContextView({ state: state({ ...context(), limited: false }), theme, onRefresh: vi.fn() }).props.alerts).toEqual([]);
    // The notes stay folded until asked for.
    expect(nodes(tree).find((node) => node.props?.accessibilityLabel === "About these figures")?.props).toMatchObject({ accessibilityState: { expanded: false } });
    expect(text(tree)).not.toContain("not independent verification of implementation");
  });

  it("shows a decision title before its wording and sizes the ID column for range and scoped IDs", () => {
    const data = context();
    data.phases[1] = { ...data.phases[1], decisionGroups: [{ title: "Ownership", decisions: [
      { id: "D-01..D-04", title: null, text: "Quantities keep three places." },
      { id: "D-27", title: "Test data profile", text: "No endpoint accepts the current month." },
    ] }] };
    const briefing = view(state(data));
    expect(text(briefing)).toContain("D-27Test data profile No endpoint accepts the current month.");
    const idCell = nodes(briefing).find((node) => node.props?.children === "D-01..D-04");
    expect((idCell?.props?.style as { width?: number }).width).toBeGreaterThanOrEqual(90);
  });

  it("distinguishes no file, unreadable content, roadmap unavailable, loading and stale snapshots", () => {
    expect(text(view())).not.toContain("No context observed for this phase.");
    const data = context(); data.phases[1] = { ...data.phases[1], observation: "unavailable" };
    const unavailable = text(view(state(data)));
    expect(unavailable).toContain("Context could not be read safely for this phase.");
    expect(unavailable).not.toContain("No context observed for this phase.");
    const missing = { ...data, availability: "unavailable" as const, phases: [] };
    const missingText = text(view(state(missing)));
    expect(missingText).toContain("Context unavailable");
    expect(missingText).toContain("No readable current-milestone roadmap was found.");
    expect(text(view(state({ ...context(), phases: [] })))).toContain("No current-milestone phases declared in the roadmap.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    const loadingText = text(view(loading));
    expect(loadingText).toContain("Loading context…");
    expect(loadingText).not.toContain("Context unavailable");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(view(stale, true))).toContain("Files changed · updating");
    const refreshFailed = state(); refreshFailed.snapshot!.freshness = "refresh-failed";
    expect(text(view(refreshFailed))).toContain("Out of date");
    const failed = { ...state(), error: "Could not refresh evidence.", refreshAnnouncement: "Context refresh failed." };
    const failedText = text(view(failed));
    expect(failedText).toContain("Could not refresh context. The last snapshot is still displayed.");
    expect(failedText).toContain("Context refresh failed.");
    expect(failedText).toContain("Phase 59.3 · Independent registries");
    expect(text(view({ workspaceId: "selected", snapshot: null, busy: false, error: "Could not refresh evidence." }))).toContain("Could not refresh context. Try refreshing again.");
    const withoutCurrent = context(); withoutCurrent.phases = [{ ...phase(), id: "60", current: false, observation: "not_observed" }];
    expect(text(view(state(withoutCurrent)))).toContain("No context observed for this phase.");
  });
});
