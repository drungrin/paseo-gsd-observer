import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const hooks = (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>());
  return { ...hooks, useState: vi.fn(hooks.useState) };
});

import { useState } from "react";
import { expand } from "../helpers/react-native-mock";
import { matchingParkingEntries, parkingLotNotes, ParkingLotView } from "../../client/parking-lot-components";
import type { BoardViewState } from "../../client/board-components";
import { liveStatus } from "../../client/board-frame";
import { surface, tint, toneColor } from "../../client/ui-kit";
import type { BoardParkingLot, ParkingLotItem } from "../../shared/parking-lot";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const item = (overrides: Partial<ParkingLotItem> = {}): ParkingLotItem => ({ id: "999.1", title: "Cluster manual checks", disposition: "parked", recordedLabel: "BACKLOG", goal: "Validate the real preview cluster.", requirements: "TBD", plans: "0 plans", checklist: { checked: 0, total: 1 }, laterNote: null, excerptsLimited: false, ...overrides });
const data = (): BoardParkingLot => ({ availability: "available", section: "observed", limited: false, counts: { recorded: 3, parked: 1, absorbed: 1, promoted: 0, reconciliation: 1, other: 0, displayed: 3 }, items: [
  item(), item({ id: "999.2", title: "Earlier approval gate", disposition: "reconciliation", recordedLabel: "BACKLOG", goal: "Close the documented gate.", requirements: null, plans: null, checklist: { checked: 5, total: 6 }, laterNote: "Later roadmap note may supersede this entry; reconcile before acting." }),
  item({ id: "999.3", title: "Duplicate requirement", disposition: "absorbed", recordedLabel: "ABSORVIDA PELA PHASE 14.1 — NÃO EXECUTAR", goal: null, requirements: "STORE-09", plans: "0 plans", checklist: { checked: 1, total: 1 } }),
] });
const state = (parkingLot: BoardParkingLot = data()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { parkingLot } as BoardOverview,
} });
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const view = (parkingLot?: BoardParkingLot, compact = false) => expand(ParkingLotView({ state: state(parkingLot), theme, compact, onRefresh: vi.fn() }));
/** The counts, without the disposition bar that also carries an accessible label. */
const counts = (tree: unknown) => nodes(tree).filter((node) => node.props?.accessible && node.props?.accessibilityRole !== "image");
const bar = (tree: unknown) => nodes(tree).find((node) => node.props?.accessible && node.props?.accessibilityRole === "image");
/** The next ParkingLotView render reads this as its stored filter. */
const stored = (selection: { workspaceId: string; filter: string }, setter = vi.fn()) => {
  vi.mocked(useState).mockImplementationOnce((() => [selection, setter]) as unknown as typeof useState);
  return setter;
};

describe("Parking Lot tab", () => {
  it("shows recorded roadmap entries distinctly from executable phases and TODO files", () => {
    const tree = view();
    const content = text(tree);
    expect(parkingLotNotes()[0]).toContain("Unsequenced 999.x entries recorded in the current ROADMAP.md Backlog section.");
    expect(parkingLotNotes()[0]).toContain("These are not executable phases or standalone TODO files.");
    expect(content).toContain("3 safe cards shown from 3 recorded headings.");
    expect(parkingLotNotes()[1]).toContain("Recorded dispositions, not live verification results.");
    expect(content).toContain("3 entries match this filter.");
    expect(content).toContain("Phase 999.1 · Cluster manual checks");
    expect(content).toContain("As recorded: BACKLOG");
    expect(content).toContain("Requirements: TBD");
    expect(content).toContain("Plans, as written: 0 plans");
    expect(content).toContain("0 of 1 visible top-level checklist markers checked. Nested or indented markers are not counted; these are not proof of completion.");
    expect(content).toContain("Later roadmap note may supersede this entry; reconcile before acting.");
    expect(content).not.toContain("Later roadmap note: Later roadmap note");
    expect(content).toContain("This entry records a transfer; it is not counted as parked work.");
    expect(content).not.toContain("Promote now");
    expect(counts(tree).map((node) => node.props?.accessibilityLabel)).toEqual(["Recorded entries: 3", "Parked: 1", "Needs reconciliation: 1", "Absorbed / promoted: 1"]);
    const filters = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Filter:"));
    expect(filters.map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: All", "Filter: Parked", "Filter: Needs reconciliation", "Filter: Absorbed", "Filter: Promoted", "Filter: Unclassified"]);
    expect(filters[0].props).toMatchObject({ accessibilityState: { selected: true }, "aria-pressed": true });
    expect(nodes(tree).find((node) => node.props?.role === "group")?.props?.accessibilityLabel).toBe("Disposition");
    expect(text(view(undefined, true))).toContain("Phase 999.2 · Earlier approval gate");
  });

  it("marks each entry with its recorded disposition, and only transfers as not parked", () => {
    const content = text(view());
    expect(content).toContain("Phase 999.1 · Cluster manual checksParked");
    expect(content).toContain("Phase 999.2 · Earlier approval gateNeeds reconciliation");
    expect(content).toContain("Phase 999.3 · Duplicate requirementAbsorbed");
    expect(content.match(/This entry records a transfer/g)).toHaveLength(1);
    const promoted = data(); promoted.items = [item({ disposition: "promoted" }), item({ id: "999.4", disposition: "other", title: null })];
    const promotedText = text(view(promoted));
    expect(promotedText).toContain("Phase 999.1 · Cluster manual checksPromoted");
    expect(promotedText).toContain("Phase 999.4 · Title withheldUnclassified");
    expect(promotedText.match(/This entry records a transfer/g)).toHaveLength(1);
  });

  it("splits the disposition bar by recorded disposition and highlights reconciliation only when there is some", () => {
    const tree = view();
    expect(bar(tree)?.props?.accessibilityLabel).toBe("1 parked, 1 needs reconciliation, 0 unclassified, 1 absorbed, 0 promoted");
    // The legend lists only dispositions that have entries.
    expect(text(tree)).toContain("1 parked1 needs reconciliation1 absorbed");
    expect(text(tree)).not.toContain("0 promoted");
    const warning = tint(theme, toneColor(theme, "warning"), 0.12);
    const background = (tree: unknown, label: string) => (counts(tree).find((node) => node.props?.accessibilityLabel === label)?.props?.style as { backgroundColor?: string }).backgroundColor;
    expect(background(tree, "Needs reconciliation: 1")).toBe(warning);
    expect(background(tree, "Parked: 1")).toBe(surface(theme, 2));
    const settled = data(); settled.counts = { ...settled.counts, reconciliation: 0 };
    expect(background(view(settled), "Needs reconciliation: 0")).toBe(surface(theme, 2));
  });

  it("filters by recorded disposition without reclassifying absorbed entries as parked", () => {
    const source = data();
    expect(matchingParkingEntries(source, "parked").map((entry) => entry.id)).toEqual(["999.1"]);
    expect(matchingParkingEntries(source, "reconciliation").map((entry) => entry.id)).toEqual(["999.2"]);
    expect(matchingParkingEntries(source, "absorbed").map((entry) => entry.id)).toEqual(["999.3"]);
    expect(matchingParkingEntries(source, "all")).toHaveLength(3);
  });

  it("keeps a filter per workspace and says when nothing matches", () => {
    const setter = stored({ workspaceId: "selected", filter: "promoted" });
    const tree = view();
    expect(nodes(tree).filter((node) => node.props?.["aria-pressed"]).map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: Promoted"]);
    expect(text(tree)).toContain("0 entries match this filter.");
    expect(text(tree)).toContain("No displayed parking-lot entries match this disposition.");
    (nodes(tree).find((node) => node.props?.accessibilityLabel === "Filter: Parked")!.props!.onPress as () => void)();
    expect(setter).toHaveBeenLastCalledWith({ workspaceId: "selected", filter: "parked" });
    stored({ workspaceId: "other", filter: "promoted" });
    const reset = view();
    expect(nodes(reset).filter((node) => node.props?.["aria-pressed"]).map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: All"]);
    expect(text(reset)).toContain("3 entries match this filter.");
  });

  it("distinguishes no section, empty section, unavailable roadmap, limited data, loading and stale snapshots", () => {
    const empty = data(); empty.items = []; empty.counts = { recorded: 0, parked: 0, absorbed: 0, promoted: 0, reconciliation: 0, other: 0, displayed: 0 };
    empty.section = "absent";
    expect(text(view(empty))).toContain("The readable current ROADMAP.md has no Backlog section.");
    empty.section = "observed";
    expect(text(view(empty))).toContain("The Backlog section is present, but contains no recorded 999.x entries.");
    expect(bar(view(empty))).toBeUndefined();
    const unavailable = { ...empty, availability: "unavailable" as const, section: "unavailable" as const };
    expect(text(view(unavailable))).toContain("The current ROADMAP.md could not be read safely.");
    const limited = data(); limited.limited = true; limited.counts.recorded = 5;
    expect(text(view(limited))).toContain("Some parking-lot entries or safe excerpts may be incomplete; counts cover only observed headings.");
    expect(bar(view(limited))?.props?.accessibilityLabel).toMatch(/^at least 1 parked, /);
    expect(bar(view(data()))?.props?.accessibilityLabel).not.toContain("at least");
    expect(text(view(limited))).toContain("3 safe cards shown from 5 recorded headings.");
    expect(text(view(limited))).toContain("3 entries match this filter; additional headings may lack safe cards.");
    expect(text(view())).not.toContain("may be incomplete");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(expand(ParkingLotView({ state: loading, theme, onRefresh: vi.fn() })))).toContain("Loading parking lot…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(liveStatus(stale).label).toBe("Files changed · updating");
    expect(text(expand(ParkingLotView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Files changed · updating");
    const failed = { ...state(), error: "Could not refresh evidence." };
    const failedText = text(expand(ParkingLotView({ state: failed, theme, onRefresh: vi.fn() })));
    expect(failedText).toContain("Could not refresh parking lot. The last snapshot is still displayed.");
    expect(failedText).toContain("Out of date");
  });

  it("keeps qualifiers visible and folds the reading notes", () => {
    const element = ParkingLotView({ state: state(), theme, onRefresh: vi.fn() }) as { props: { notes: string[]; alerts: string[] } };
    expect(element.props.notes).toEqual(parkingLotNotes());
    expect(element.props.alerts).toEqual([]);
    const tree = view();
    expect(nodes(tree).find((node) => node.props?.accessibilityLabel === "About these figures")?.props).toMatchObject({ accessibilityState: { expanded: false } });
    expect(text(tree)).not.toContain("Unsequenced 999.x entries");
  });
});
