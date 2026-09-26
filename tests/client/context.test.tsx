import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { ContextView } from "../../client/context-components";
import type { BoardViewState } from "../../client/board-components";
import type { BoardContext, BoardContextPhase } from "../../shared/context";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4" } };
const phase = (): BoardContextPhase => ({ id: "59.3", title: "Independent registries", current: true, observation: "observed", gatheredAt: "2026-09-23", recordedStatus: "Ready for planning",
  boundary: ["Drafts must be confirmed explicitly."], decisionCount: 3, decisionGroups: [{ title: "Lifecycle", decisions: [{ id: "D-01", text: "Drafts can be edited." }, { id: "D-02", text: "Confirmed changes preserve history." }] }],
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
const nodes = (node: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const value = node as { type?: unknown; props?: Record<string, unknown> };
  return [value, ...nodes(value.props?.children)];
};
const text = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node !== "object") return "";
  return text((node as { props?: { children?: unknown } }).props?.children);
};
const render = (node: { type?: unknown; props?: Record<string, unknown> }) => (node.type as (props: Record<string, unknown>) => unknown)(node.props ?? {});

describe("Context tab", () => {
  it("defaults to the current dotted phase, preserving roadmap order and honest observation", () => {
    const tree = ContextView({ state: state(), theme, onRefresh: vi.fn() });
    const buttons = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Phase "));
    expect(buttons.map((node) => node.props?.accessibilityLabel)).toEqual([
      "Phase 59.2: no context observed", "Phase 59.3, current: context observed", "Phase 60: no context observed",
    ]);
    expect(buttons.map((node) => node.props?.accessibilityState)).toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    expect(buttons.map((node) => node.props?.["aria-pressed"])).toEqual([false, true, false]);
    const selected = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "PhaseBriefing")!;
    expect((selected.props?.phase as BoardContextPhase).id).toBe("59.3");
    const briefing = render(selected);
    expect(text(briefing)).toContain("Document status: Ready for planning (recorded when gathered; not live phase progress).");
    expect(text(briefing)).toContain("Later amendments are recorded");
    expect(nodes(briefing).find((node) => node.props?.title === "Decisions · 2 of 3 excerpts")).toBeDefined();
    expect(text(briefing)).toContain("Canonical references recorded; file locations are not included");
    const sourceControl = nodes(briefing).find((node) => (node.props?.accessibilityLabel as string | undefined)?.includes("safe source excerpts for phase 59.3"));
    expect(sourceControl?.props).toMatchObject({ accessibilityState: { expanded: false }, "aria-expanded": false });
    expect(text(briefing)).not.toContain("Review before confirmation.");
    expect(text(render({ ...selected, props: { ...selected.props, sourceOpen: true } }))).toContain("Review before confirmation.");
  });

  it("distinguishes no file, unreadable content, roadmap unavailable, loading and stale snapshots", () => {
    const absent = render(nodes(ContextView({ state: state(), theme, onRefresh: vi.fn() })).find((node) => typeof node.type === "function" && node.type.name === "PhaseBriefing")!);
    expect(text(absent)).not.toContain("No context observed for this phase.");
    const data = context(); data.phases[1] = { ...data.phases[1], observation: "unavailable" };
    const unavailable = render(nodes(ContextView({ state: state(data), theme, onRefresh: vi.fn() })).find((node) => typeof node.type === "function" && node.type.name === "PhaseBriefing")!);
    expect(text(unavailable)).toContain("Context could not be read safely for this phase.");
    const missing = { ...data, availability: "unavailable" as const, phases: [] };
    expect(nodes(ContextView({ state: state(missing), theme, onRefresh: vi.fn() })).find((node) => node.props?.title === "Context unavailable")).toBeDefined();
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(ContextView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading context…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(ContextView({ state: stale, theme, compact: true, onRefresh: vi.fn() }))).toContain("Refresh to update context.");
    const withoutCurrent = context(); withoutCurrent.phases = [{ ...phase(), id: "60", current: false, observation: "not_observed" }];
    const noFile = render(nodes(ContextView({ state: state(withoutCurrent), theme, onRefresh: vi.fn() })).find((node) => typeof node.type === "function" && node.type.name === "PhaseBriefing")!);
    expect(text(noFile)).toContain("No context observed for this phase.");
  });
});
