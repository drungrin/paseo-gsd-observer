import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (value: unknown) => [value, vi.fn()] };
});

import { matchingParkingEntries, ParkingLotView } from "../../client/parking-lot-components";
import type { BoardViewState } from "../../client/board-components";
import type { BoardParkingLot, ParkingLotItem } from "../../shared/parking-lot";
import type { BoardOverview } from "../../shared/overview";

const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4", statusWarning: "#b7791f" } };
const item = (overrides: Partial<ParkingLotItem> = {}): ParkingLotItem => ({ id: "999.1", title: "Cluster manual checks", disposition: "parked", recordedLabel: "BACKLOG", goal: "Validate the real preview cluster.", requirements: "TBD", plans: "0 plans", checklist: { checked: 0, total: 1 }, laterNote: null, excerptsLimited: false, ...overrides });
const data = (): BoardParkingLot => ({ availability: "available", section: "observed", limited: false, counts: { recorded: 3, parked: 1, absorbed: 1, promoted: 0, reconciliation: 1, other: 0, displayed: 3 }, items: [
  item(), item({ id: "999.2", title: "Earlier approval gate", disposition: "reconciliation", recordedLabel: "BACKLOG", goal: "Close the documented gate.", requirements: null, plans: null, checklist: { checked: 5, total: 6 }, laterNote: "Later roadmap note may supersede this entry; reconcile before acting." }),
  item({ id: "999.3", title: "Duplicate requirement", disposition: "absorbed", recordedLabel: "ABSORVIDA PELA PHASE 14.1 — NÃO EXECUTAR", goal: null, requirements: "CLOUD-09", plans: "0 plans", checklist: { checked: 1, total: 1 } }),
] });
const state = (parkingLot: BoardParkingLot = data()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: {
  workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false,
  overview: { parkingLot } as BoardOverview,
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
const view = (parkingLot?: BoardParkingLot, compact = false) => expand(ParkingLotView({ state: state(parkingLot), theme, compact, onRefresh: vi.fn() }));

describe("Parking Lot tab", () => {
  it("shows recorded roadmap entries distinctly from executable phases and TODO files", () => {
    const tree = view();
    const content = text(tree);
    expect(content).toContain("Unsequenced 999.x entries recorded in the current ROADMAP.md Backlog section.");
    expect(content).toContain("These are not executable phases or standalone TODO files.");
    expect(content).toContain("3 safe cards shown from 3 recorded headings. Recorded dispositions, not live verification results.");
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
    const facts = nodes(tree).filter((node) => node.props?.accessible).map((node) => node.props?.accessibilityLabel);
    expect(facts).toEqual(["Recorded entries: 3", "Parked: 1", "Needs reconciliation: 1", "Absorbed / promoted: 1"]);
    const filters = nodes(tree).filter((node) => (node.props?.accessibilityLabel as string | undefined)?.startsWith("Filter:"));
    expect(filters.map((node) => node.props?.accessibilityLabel)).toEqual(["Filter: All", "Filter: Parked", "Filter: Needs reconciliation", "Filter: Absorbed", "Filter: Promoted", "Filter: Unclassified"]);
    expect(filters[0].props).toMatchObject({ accessibilityState: { selected: true }, "aria-pressed": true });
    expect(text(view(undefined, true))).toContain("Phase 999.2 · Earlier approval gate");
  });

  it("filters by recorded disposition without reclassifying absorbed entries as parked", () => {
    const source = data();
    expect(matchingParkingEntries(source, "parked").map((entry) => entry.id)).toEqual(["999.1"]);
    expect(matchingParkingEntries(source, "reconciliation").map((entry) => entry.id)).toEqual(["999.2"]);
    expect(matchingParkingEntries(source, "absorbed").map((entry) => entry.id)).toEqual(["999.3"]);
    expect(matchingParkingEntries(source, "all")).toHaveLength(3);
  });

  it("distinguishes no section, empty section, unavailable roadmap, limited data, loading and stale snapshots", () => {
    const empty = data(); empty.items = []; empty.counts = { recorded: 0, parked: 0, absorbed: 0, promoted: 0, reconciliation: 0, other: 0, displayed: 0 };
    empty.section = "absent";
    expect(text(view(empty))).toContain("The readable current ROADMAP.md has no Backlog section.");
    empty.section = "observed";
    expect(text(view(empty))).toContain("The Backlog section is present, but contains no recorded 999.x entries.");
    const unavailable = { ...empty, availability: "unavailable" as const, section: "unavailable" as const };
    expect(text(view(unavailable))).toContain("The current ROADMAP.md could not be read safely.");
    const limited = data(); limited.limited = true; limited.counts.recorded = 5;
    expect(text(view(limited))).toContain("Some parking-lot entries or safe excerpts may be incomplete; counts cover only observed headings.");
    expect(text(view(limited))).toContain("3 safe cards shown from 5 recorded headings.");
    const loading: BoardViewState = { workspaceId: "other", snapshot: null, busy: true, error: null };
    expect(text(ParkingLotView({ state: loading, theme, onRefresh: vi.fn() }))).toContain("Loading parking lot…");
    const stale = state(); stale.snapshot!.freshness = "stale";
    expect(text(expand(ParkingLotView({ state: stale, theme, compact: true, onRefresh: vi.fn() })))).toContain("Refresh to update the parking lot.");
  });
});
