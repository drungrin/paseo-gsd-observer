import { afterEach, describe, expect, it, vi } from "vitest";

/** Initial values a test swaps in for one `useState` call, keyed by the component's own initial value ("tiles" → "list"). */
const initial = vi.hoisted(() => new Map<unknown, unknown>());

vi.mock("react-native", async () => (await import("../helpers/react-native-mock")).reactNativeMock);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: "PaseoScrollView" }));
vi.mock("react", async (importOriginal) => {
  const mock = (await import("../helpers/react-native-mock")).reactHooksMock(await importOriginal<typeof import("react")>());
  return { ...mock, useState: (value: unknown) => mock.useState(initial.has(value) ? initial.get(value) : value) };
});

import { expand } from "../helpers/react-native-mock";
import { liveStatus } from "../../client/board-frame";
import { defaultPlan, phaseCounts, planEvidenceLabel, planState, plansNotes, PlansView, planWaves } from "../../client/plans-components";
import { checkLabel, checkTone, executeChecks, PhaseChecks, phaseStages, planChecks, stagesLabel, visibleCheckLabel } from "../../client/phase-checks";
import type { BoardViewState } from "../../client/board-components";
import type { BoardOverview } from "../../shared/overview";
import { phaseChecks } from "../helpers/phase-checks";

type Phase = BoardOverview["plans"]["phases"][number];
type Plan = Phase["entries"][number];
type Check = Phase["checks"]["discuss"];
const theme = { colors: { surface0: "#fff", surface1: "#f8fafc", surface2: "#eef2f5", foreground: "#12151c", foregroundMuted: "#626c76", accent: "#316ec4", accentForeground: "#fff", border: "#d8dde4" } };
const plans = (): BoardOverview["plans"] => ({
  availability: "available", observedPlans: 4, observedSummaries: 2, limited: false,
  phases: [
    { id: "59.2", title: "Contract foundation", current: false, declaredPlans: 6, entries: [], checks: phaseChecks() },
    { id: "59.3", title: "Contract management", current: true, declaredPlans: 24, entries: [
      { id: "59.3-23", number: "23", title: "Supplier check", objective: "Recheck suppliers.", wave: 11, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-17", number: "17", title: "Registry help", objective: "Update help.", wave: 14, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-18", number: "18", title: "Browser certification", objective: "Test the journeys.", wave: 15, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
      { id: "59.3-24", number: "24", title: null, objective: null, wave: 17, roadmapChecked: false, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false },
    ], checks: phaseChecks(true) },
    { id: "60", title: "Billing", current: false, declaredPlans: null, entries: [], checks: phaseChecks() },
  ],
});
const plan = (id: string, overrides: Partial<Plan> = {}): Plan => ({ id, number: id.split("-")[1], title: `Plan ${id}`, objective: null, wave: 1, roadmapChecked: null, roadmapConflict: false, planObserved: true, summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false, ...overrides });
const phase = (overrides: Partial<Phase> = {}): Phase => ({ id: "7", title: "Imports", current: true, declaredPlans: null, entries: [], checks: phaseChecks(), ...overrides });
const state = (data = plans()): BoardViewState => ({ workspaceId: "selected", busy: false, error: null, snapshot: { workspaceId: "selected", observedAt: "2026-09-25T00:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, overview: { plans: data } as BoardOverview } });

type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node as Node, ...nodes((node as Node).props?.children)] : [];
const text = (node: unknown): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : "";
const byLabel = (tree: unknown, value: string) => nodes(tree).find((node) => node.props?.accessibilityLabel === value);
const labelled = (tree: unknown, prefix: string) => nodes(tree).find((node) => String(node.props?.accessibilityLabel ?? "").startsWith(prefix));
const labels = (tree: unknown) => nodes(tree).map((node) => node.props?.accessibilityLabel).filter((value): value is string => typeof value === "string");
const tiles = (tree: unknown) => nodes(tree).filter((node) => node.props?.role === "button" && String(node.props?.accessibilityLabel ?? "").startsWith("Plan "));
const view = (viewState: BoardViewState = state(), compact = false, onRefresh = vi.fn()) => {
  const tree = expand(PlansView({ state: viewState, theme, compact, onRefresh }));
  return { tree, content: text(tree), onRefresh };
};
/** The selected phase is the current one; a phase holding only `entries` opens on its default plan. */
const withEntries = (entries: Plan[], overrides: Partial<Phase> = {}) => {
  const data = plans();
  data.phases[1] = { ...data.phases[1], entries, ...overrides };
  return state(data);
};

afterEach(() => initial.clear());

describe("Plans tab", () => {
  it("shows the milestone's plans by evidence, its phases, and the current phase's plans wave by wave", () => {
    const { tree, content } = view();
    expect(content).toContain("Plans");
    expect(content).toContain("The current milestone's phases, the stages each has left files for, and its plans wave by wave.");
    // Summaries, plan files without one, and the rest of the declared totals are counted apart.
    expect(labelled(tree, "2 plans with a summary")?.props?.accessibilityLabel).toBe("2 plans with a summary, 2 with a plan file only, 26 declared or listed without a plan file");
    for (const expected of ["2 with a summary", "2 plan file only", "26 declared or listed, no plan file yet"]) expect(content).toContain(expected);
    const chips = nodes(byLabel(tree, "Phases")).filter((node) => node.props?.role === "button");
    expect(chips.map((chip) => [chip.props?.accessibilityLabel, (chip.props?.accessibilityState as { selected: boolean }).selected, text(chip)])).toEqual([
      ["Phase 59.2: Contract foundation. 0 of 6 plans with a summary.", false, "59.20/6"],
      ["Phase 59.3, current: Contract management. 2 of 24 plans with a summary.", true, "59.32/24"],
      ["Phase 60: Billing. 0 of no plans with a summary.", false, "600/?"],
    ]);
    expect(content).toContain("Phase 59.3 · currentContract management2 of 24 plans with a summary");
    expect(nodes(tree).filter((node) => node.props?.role === "heading").map(text).filter((heading) => /^(W\d+|No wave)$/.test(heading))).toEqual(["W11", "W14", "W15", "W17"]);
    expect(labels(tree).filter((value) => value.startsWith("Plans in wave"))).toEqual([
      "Plans in wave 11, 1 of 1 with a summary", "Plans in wave 14, 1 of 1 with a summary", "Plans in wave 15, 0 of 1 with a summary", "Plans in wave 17, 0 of 1 with a summary",
    ]);
    expect(tiles(tree).map((tile) => String(tile.props?.accessibilityLabel).split(":")[0])).toEqual(["Plan 59.3-23", "Plan 59.3-17", "Plan 59.3-18", "Plan 59.3-24"]);
    // How to read the figures is folded, not lost.
    expect(plansNotes()).toContain("A summary file is observed evidence, not a verified completion.");
    for (const note of plansNotes()) expect(content).not.toContain(note);
    expect(byLabel(tree, "About these figures")?.props?.accessibilityState).toEqual({ expanded: false });
  });

  it("keeps roadmap checkmarks, plan files, and summary observations separate", () => {
    const current = plans().phases[1].entries;
    expect(planEvidenceLabel(current[0])).toEqual(["Roadmap checked", "Plan file observed", "Summary observed"]);
    expect(planEvidenceLabel(current[2])).toEqual(["Roadmap unchecked", "Plan file observed", "No readable summary observed"]);
    expect(planEvidenceLabel({ ...current[3], roadmapChecked: null, planObserved: false })).toEqual(["Not listed in roadmap", "No readable plan file observed", "No readable summary observed"]);
    expect(planEvidenceLabel({ ...current[3], roadmapChecked: null, roadmapConflict: true })).toEqual(["Conflicting roadmap checkmarks", "Plan file observed", "No readable summary observed"]);
    const { tree } = view();
    expect(tiles(tree).map((tile) => [tile.props?.accessibilityLabel, (tile.props?.accessibilityState as { selected: boolean }).selected, text(tile)])).toEqual([
      ["Plan 59.3-23: Supplier check. Wave 11. Roadmap checked. Plan file observed. Summary observed.", false, "59.3-23✓summary"],
      ["Plan 59.3-17: Registry help. Wave 14. Roadmap checked. Plan file observed. Summary observed.", false, "59.3-17✓summary"],
      ["Plan 59.3-18: Browser certification. Wave 15. Roadmap unchecked. Plan file observed. No readable summary observed.", true, "59.3-18●plan file"],
      ["Plan 59.3-24: title not observed. Wave 17. Roadmap unchecked. Plan file observed. No readable summary observed.", false, "59.3-24●plan file"],
    ]);
    // The tab opens on the first plan without a summary, with its evidence as separate facts.
    const detail = byLabel(tree, "Plan 59.3-18 details");
    const copy = text(detail);
    for (const expected of ["Plan 59.3-18 · wave 15", "Browser certification", "Roadmap unchecked", "Plan file observed", "No readable summary observed", "Test the journeys."]) expect(copy).toContain(expected);
    expect(copy).not.toContain("Summary, as recorded");
    expect(plansNotes()).toContain("Roadmap checkmarks and observed summaries are separate facts; neither proves verification.");

    // A conflict and a summary without a plan file stay visible as what they are.
    const odd = view(withEntries([plan("59.3-1", { roadmapConflict: true, wave: 2 }), plan("59.3-2", { planObserved: false, summaryObserved: true, roadmapChecked: true, wave: null })])).tree;
    expect(tiles(odd).map((tile) => [tile.props?.accessibilityLabel, text(tile)])).toEqual([
      ["Plan 59.3-1: Plan 59.3-1. Wave 2. Conflicting roadmap checkmarks. Plan file observed. No readable summary observed.", "59.3-1●roadmap conflict"],
      ["Plan 59.3-2: Plan 59.3-2. Wave not recorded. Roadmap checked. No readable plan file observed. Summary observed.", "59.3-2✓summary"],
    ]);
    expect(text(byLabel(odd, "Plan 59.3-1 details"))).toContain("Conflicting roadmap checkmarks");
    expect(text(byLabel(odd, "Plan 59.3-1 details"))).toContain("Objective not observed in the plan file.");
    expect(byLabel(odd, "Plans without a recorded wave")).toBeDefined();
  });

  it("shows summary wording separately from plan evidence and marks absent or limited wording", () => {
    const render = (overrides: Partial<Plan>) => {
      const entry = { ...plans().phases[1].entries[0], ...overrides };
      const detail = byLabel(view(withEntries([entry])).tree, `Plan ${entry.id} details`);
      const summary = nodes(detail).find((node) => (node.props?.style as { borderLeftWidth?: number } | undefined)?.borderLeftWidth === 2);
      return { detail: text(detail), summary: summary ? text(summary) : null };
    };
    const recorded = render({ summaryExcerpt: "Os registros ganham ciclo de vida explícito.", summaryExcerptLimited: false });
    expect(recorded.summary).toBe("Summary, as recordedOs registros ganham ciclo de vida explícito.");
    expect(recorded.detail).toContain("Recheck suppliers.");
    expect(recorded.detail.indexOf("Plan file observed")).toBeLessThan(recorded.detail.indexOf("Recheck suppliers."));
    expect(recorded.detail.indexOf("Recheck suppliers.")).toBeLessThan(recorded.detail.indexOf("Summary, as recorded"));
    for (const evidence of ["Roadmap checked", "Plan file observed", "Summary observed", "Recheck suppliers."]) expect(recorded.summary).not.toContain(evidence);
    expect(render({ summaryExcerpt: null, summaryExcerptLimited: false }).summary).toBe("Summary, as recordedNo introductory prose recorded before the next heading.");
    const unsafe = render({ summaryExcerpt: null, summaryExcerptLimited: true });
    expect(unsafe.summary).toBe("Summary, as recordedNo safe summary introduction available.");
    expect(unsafe.detail).not.toContain("Some summary wording was withheld");
    expect(render({ summaryExcerpt: "The gate remains blocked.", summaryExcerptLimited: true }).summary).toBe("Summary, as recordedThe gate remains blocked.Some summary wording was withheld or shortened for safe display.");
    // No summary, no summary block.
    expect(render({ summaryObserved: false }).summary).toBeNull();
  });

  it("says when absolute paths and links were omitted", () => {
    const detail = (overrides: Partial<Plan>) => text(byLabel(view(withEntries([plan("59.3-5", overrides)])).tree, "Plan 59.3-5 details"));
    expect(detail({ title: "Guide at [omitted]" })).toContain("Absolute paths and links are shown as [omitted].");
    expect(detail({ objective: "Read [omitted] first." })).toContain("Absolute paths and links are shown as [omitted].");
    expect(detail({ title: "Guide", objective: "Read the guide." })).not.toContain("[omitted]");
    expect(detail({ title: null })).toContain("Title not observed");
  });

  it("handles unavailable plans and loading without presenting an invented zero", () => {
    const unavailable = { ...plans(), availability: "unavailable" as const, phases: [], observedPlans: 0, observedSummaries: 0 };
    const missing = view(state(unavailable));
    expect(missing.content).toContain("Plans unavailable");
    expect(missing.content).toContain("No readable current-milestone roadmap was found.");
    expect(missing.content).not.toContain("with a summary");
    expect(byLabel(missing.tree, "Phases")).toBeUndefined();
    const loading: BoardViewState = { workspaceId: "empty", snapshot: null, busy: true, error: null };
    expect(view(loading).content).toContain("Loading plans…");
    expect(view(loading).content).not.toContain("Plans unavailable");
    expect(view({ ...loading, busy: false }).content).toContain("Plans unavailable");
    expect(view({ ...loading, busy: false, error: "unreachable" }).content).toContain("Could not refresh plans. Try refreshing again.");
    const failed = view({ ...state(), error: "unreachable" }).content;
    expect(failed).toContain("Could not refresh plans. The last snapshot is still displayed.");
    expect(failed).toContain("2 with a summary");
    expect(view(state({ ...plans(), phases: [] })).content).toContain("No phases declared in this milestone.");

    // With no current phase the first one opens; declared plans without files read as such, not as zero of zero.
    const first = plans();
    first.phases[1] = { ...first.phases[1], current: false };
    const opened = view(state(first));
    expect(opened.content).toContain("Phase 59.2Contract foundation0 of 6 plans with a summary");
    expect(opened.content).toContain("No plan files or roadmap plan entries observed for this phase.");
    expect(labelled(opened.tree, "Show plans as")).toBeUndefined();
    expect(labelled(opened.tree, "Plan 59.2")).toBeUndefined();
    expect((byLabel(opened.tree, "Phase 59.2: Contract foundation. 0 of 6 plans with a summary.")?.props?.accessibilityState as { selected: boolean }).selected).toBe(true);
    const undeclared = plans();
    undeclared.phases[1] = { ...undeclared.phases[1], current: false };
    undeclared.phases[2] = { ...undeclared.phases[2], current: true };
    expect(view(state(undeclared)).content).toContain("Phase 60 · currentBillingNo plans declared yet");
    // A total taken from the entries alone says it is not confirmed.
    expect(view(withEntries([plan("59.3-1", { summaryObserved: true }), plan("59.3-2")], { declaredPlans: null })).content).toMatch(/1 of 2 plans with a summary · \d+ roadmap checked · total not confirmed/);
  });

  it("discloses stale or limited observation, refreshes on request and lays out compactly", () => {
    const data = plans(); data.limited = true;
    const current = state(data); current.snapshot!.freshness = "stale";
    const { tree, content } = view(current, true);
    expect(content).toContain("Some plan or summary evidence could not be fully read; counts may be partial.");
    expect(liveStatus(current)).toMatchObject({ tone: "warning", label: "Files changed · updating" });
    expect(content).toContain("Files changed · updating");
    expect(nodes(tree).find((node) => (node.props?.style as { gap?: number })?.gap === 16 && (node.props?.style as { flexDirection?: string })?.flexDirection === "column")?.props?.style).toMatchObject({ alignItems: "stretch" });
    expect(labelled(tree, "Phase 59.3 stages.")?.props?.accessibilityLabel).toContain("execute: next, 2/24;");
    const errored = { ...state(), error: "unreachable" };
    expect(liveStatus(errored)).toMatchObject({ tone: "danger", label: "Out of date" });
    expect(view(errored).content).toContain("Out of date");

    const refresh = view();
    (byLabel(refresh.tree, "Refresh plans")?.props?.onPress as () => void)();
    expect(refresh.onRefresh).toHaveBeenCalledOnce();
    const busy = view({ ...state(), busy: true });
    expect(byLabel(busy.tree, "Refreshing plans")?.props?.disabled).toBe(true);
    expect(busy.content).toContain("2 with a summary");
  });

  it("offers the same plan evidence as a list", () => {
    const tiled = view();
    const toggle = (tree: unknown) => nodes(byLabel(tree, "Show plans as")).filter((node) => node.props?.accessibilityRole === "radio").map((radio) => [radio.props?.accessibilityLabel, (radio.props?.accessibilityState as { selected: boolean }).selected]);
    expect(toggle(tiled.tree)).toEqual([["Tiles", true], ["List", false]]);
    initial.set("tiles", "list");
    const { tree } = view();
    expect(toggle(tree)).toEqual([["Tiles", false], ["List", true]]);
    const rows = nodes(byLabel(tree, "Plans for phase 59.3")).filter((node) => node.props?.role === "listitem").map(text);
    expect(rows).toEqual([
      "✓  59.3-23Supplier checkWave 11Roadmap checkedPlan file observedSummary observed",
      "✓  59.3-17Registry helpWave 14Roadmap checkedPlan file observedSummary observed",
      "●  59.3-18Browser certificationWave 15Roadmap uncheckedPlan file observedNo readable summary observed",
      "●  59.3-24Title not observedWave 17Roadmap uncheckedPlan file observedNo readable summary observed",
    ]);
    // Every fact a tile announces is in its list row.
    tiles(tiled.tree).forEach((tile, index) => {
      for (const fact of String(tile.props?.accessibilityLabel).split(". ").slice(1)) expect(rows[index]).toContain(fact.replace(/\.$/, ""));
    });
    expect(tiles(tree)).toEqual([]);
    expect(labelled(tree, "Plan 59.3-18 details")).toBeUndefined();
  });

  it("shows the five phase stages and phase-only check groups without asserting success from file presence", () => {
    const current = plans().phases[1];
    const tree = expand(PhaseChecks({ phase: current, theme, compact: false }));
    expect(labelled(tree, "Phase 59.3 stages.")?.props?.accessibilityLabel).toBe("Phase 59.3 stages. discuss: observed; research: observed; plan: observed, 4 plans; execute: next, 2/24 summaries; verify: ahead");
    const content = text(tree);
    expect(content).toContain("Plan sub-stages · 3 of 11 observed");
    expect(content).toContain("Execute sub-stages · 0 of 5 observed");
    expect(content).not.toContain("apply to entire phase");
    const items = (title: string) => nodes(byLabel(tree, title)).filter((node) => node.props?.role === "listitem");
    expect(items("Plan sub-stages")).toHaveLength(11);
    expect(items("Execute sub-stages")).toHaveLength(5);
    expect(items("Plan sub-stages").map((item) => [item.props?.accessibilityLabel, text(item)])).toEqual([
      ["Spec: Not observed", "○Spec"], ["Skeleton: Not observed", "○Skeleton"], ["Security: Not observed", "○Security"], ["Patterns: Observed", "●Patterns · Observed"],
      ["UI-Spec: Observed · draft", "!UI-Spec · Draft"], ["AI-Spec: Not observed", "○AI-Spec"], ["Plan-Check: Not observed", "○Plan-Check"], ["UI-Check: Not observed", "○UI-Check"],
      ["Nyquist: Observed · draft · compliance: no", "!Nyquist · Draft · pending"], ["Windows: Not observed", "○Windows"], ["Deferred: Not observed", "○Deferred"],
    ]);
    expect(items("Execute sub-stages").map((item) => item.props?.accessibilityLabel)).toEqual(["Code Review: Not observed", "UI Review: Not observed", "Eval Review: Not observed", "UAT: Not observed", "Coverage: Not observed"]);
    expect(planChecks.map(([, label]) => label)).toHaveLength(11);
    expect(executeChecks.map(([, label]) => label)).toEqual(["Code Review", "UI Review", "Eval Review", "UAT", "Coverage"]);
    expect(checkLabel(current.checks.plan.uiSpec)).toBe("Observed · draft");
    expect(checkLabel(current.checks.plan.spec)).toBe("Not observed");
    expect(checkLabel({ observation: "observed", reportedStatus: "open", compliant: null })).toBe("Observed · open");
    expect(checkLabel({ observation: "observed", reportedStatus: "partial", compliant: null })).toBe("Observed · partial");
    expect(checkLabel({ observation: "observed", reportedStatus: "failed", compliant: null })).toBe("Observed · failed");
    expect(checkLabel({ observation: "observed", reportedStatus: "passed", compliant: true })).toBe("Observed · passed · compliance: yes");
    expect(checkLabel({ observation: "unavailable", reportedStatus: null, compliant: null })).toBe("Unavailable");

    // An unreadable sub-check is said, in a warning tone, not folded into "not observed".
    const unreadable = plans().phases[1];
    unreadable.checks = { ...unreadable.checks, execute: { ...unreadable.checks.execute, uat: { observation: "unavailable", reportedStatus: null, compliant: null } } };
    const uat = nodes(byLabel(expand(PhaseChecks({ phase: unreadable, theme, compact: false })), "Execute sub-stages")).find((node) => node.props?.accessibilityLabel === "UAT: Unavailable");
    expect(text(uat)).toBe("!UAT · Unavailable");

    const compactTree = expand(PhaseChecks({ phase: current, theme, compact: true }));
    expect(nodes(compactTree).find((node) => (node.props?.style as { gap?: number })?.gap === 16 && (node.props?.style as { flexDirection?: string })?.flexDirection === "column")?.props?.style).toMatchObject({ alignItems: "stretch" });
    expect(labelled(compactTree, "Phase 59.3 stages.")?.props?.accessibilityLabel).toContain("execute: next, 2/24;");
  });

  it("tones a check by what it records, and only when it was observed", () => {
    const check = (observation: Check["observation"], reportedStatus: Check["reportedStatus"] = null, compliant: boolean | null = null): Check => ({ observation, reportedStatus, compliant });
    expect(checkTone(check("not_observed"))).toBeNull();
    expect(checkTone(check("unavailable"))).toBe("warning");
    expect(checkTone(check("observed", "failed"))).toBe("danger");
    expect(checkTone(check("observed", "passed", false))).toBe("warning");
    expect(checkTone(check("observed", "gaps_found"))).toBe("warning");
    expect(checkTone(check("observed", "draft"))).toBe("warning");
    expect(checkTone(check("observed", "verified"))).toBe("success");
    expect(checkTone(check("observed"))).toBe("accent");
    expect(checkTone(check("observed", "unknown"))).toBe("accent");
    expect(visibleCheckLabel(check("observed", "draft", false))).toBe("Draft · pending");
    expect(visibleCheckLabel(check("observed", "passed", false))).toBe("Compliance: no");
    expect(visibleCheckLabel(check("observed", "human_needed"))).toBe("Human needed");
    expect(visibleCheckLabel(check("observed"))).toBe("Observed");
    expect(visibleCheckLabel(check("not_observed"))).toBe("Not observed");
    expect(visibleCheckLabel(check("unavailable"))).toBe("Unavailable");
  });
});

describe("Phase stages", () => {
  const observed = (reportedStatus: Check["reportedStatus"] = null): Check => ({ observation: "observed", reportedStatus, compliant: null });
  const stations = (value: Phase | undefined, compact = false) => phaseStages(value, compact).map((station) => [station.key, station.state, station.detail]);

  it("marks stages done by their files, the next one current and the rest ahead", () => {
    const current = plans().phases[1];
    expect(stations(current)).toEqual([["discuss", "done", null], ["research", "done", null], ["plan", "done", "4 plans"], ["execute", "current", "2/24 summaries"], ["verify", "future", null]]);
    expect(stations(current, true)[3]).toEqual(["execute", "current", "2/24"]);
    // Nothing observed: discuss is next; declared plans are a total, not progress.
    expect(stations(plans().phases[0])).toEqual([["discuss", "current", null], ["research", "future", null], ["plan", "future", null], ["execute", "future", "0/6 summaries"], ["verify", "future", null]]);
    expect(stations(undefined)).toEqual([["discuss", "current", null], ["research", "future", null], ["plan", "future", null], ["execute", "future", null], ["verify", "future", null]]);
  });

  it("reads a stage passed without its file as skipped", () => {
    const entries = [plan("7-1", { summaryObserved: true }), plan("7-2", { summaryObserved: true })];
    const done = phase({ entries, checks: { ...phaseChecks(), verify: observed("passed") } });
    const stages = phaseStages(done);
    expect(stages.map((station) => [station.key, station.state, station.detail, station.tone])).toEqual([
      ["discuss", "skipped", "skipped", undefined], ["research", "skipped", "skipped", undefined], ["plan", "done", "2 plans", undefined],
      ["execute", "done", "2/2 summaries, total TBD", undefined], ["verify", "done", "passed", "success"],
    ]);
    expect(stagesLabel(done, stages)).toBe("Phase 7 stages. discuss: not observed; research: not observed; plan: observed, 2 plans; execute: observed, 2/2 summaries, total TBD; verify: observed, passed");
    // Research without discuss: discuss skipped, plan next.
    expect(stations(phase({ checks: { ...phaseChecks(), research: observed() } }))).toEqual([["discuss", "skipped", "skipped"], ["research", "done", null], ["plan", "current", null], ["execute", "future", null], ["verify", "future", null]]);
  });

  it("holds execute open until every plan has a summary, and tones verify by its recorded status", () => {
    // Undeclared total: execute is done only when every observed plan has a summary.
    expect(stations(phase({ entries: [plan("7-1", { summaryObserved: true }), plan("7-2")] }))[3]).toEqual(["execute", "current", "1/2 summaries, total TBD"]);
    // Plan files added outside the declared list (gap closure) count toward the total.
    expect(stations(phase({ declaredPlans: 2, entries: [plan("7-1", { summaryObserved: true }), plan("7-2", { summaryObserved: true }), plan("7-3")] }))[3]).toEqual(["execute", "current", "2/3 summaries"]);
    // Declared total: summaries must reach it.
    expect(stations(phase({ declaredPlans: 3, entries: [plan("7-1", { summaryObserved: true }), plan("7-2", { summaryObserved: true })] }))[3]).toEqual(["execute", "current", "2/3 summaries"]);
    expect(stations(phase({ declaredPlans: 2, entries: [plan("7-1", { summaryObserved: true }), plan("7-2", { summaryObserved: true })] }))[3]).toEqual(["execute", "done", "2/2 summaries"]);
    const gaps = phaseStages(phase({ entries: [plan("7-1")], checks: { ...phaseChecks(), verify: observed("gaps_found") } }));
    expect(gaps.map((station) => [station.key, station.state])).toEqual([["discuss", "skipped"], ["research", "skipped"], ["plan", "done"], ["execute", "skipped"], ["verify", "done"]]);
    expect(gaps[4]).toMatchObject({ detail: "gaps found", tone: "warning" });
  });
});

describe("Unreadable stages and unconfirmed totals", () => {
  it("shows an unreadable stage file as unreadable, never as skipped", () => {
    const phase = plans().phases[1];
    const checks = { ...phase.checks, research: { observation: "unavailable" as const, reportedStatus: null, compliant: null }, verify: { observation: "unavailable" as const, reportedStatus: null, compliant: null } };
    const stations = phaseStages({ ...phase, checks });
    expect(stations[1]).toMatchObject({ key: "research", detail: "unreadable", tone: "warning" });
    expect(stations[4]).toMatchObject({ key: "verify", detail: "unreadable", tone: "warning" });
    expect(stations.map((station) => station.detail)).not.toContain("skipped");
    expect(stagesLabel({ ...phase, checks }, stations)).toContain("research: file unreadable");
  });

  it("never marks a phase settled while its plan total is unconfirmed", () => {
    const tree = view(withEntries([plan("59.3-1", { summaryObserved: true }), plan("59.3-2", { summaryObserved: true })], { declaredPlans: null })).tree;
    const chip = nodes(tree).find((node) => typeof node.props?.accessibilityLabel === "string" && (node.props.accessibilityLabel as string).startsWith("Phase 59.3"));
    expect(chip?.props?.accessibilityLabel).toContain("2 of 2 plans with a summary; the total is not confirmed.");
    expect(text(chip)).toContain("2/2 · total TBD");
    expect(text(chip)).not.toContain("✓");
  });

  it("keeps the milestone's plan-file and summary counts and each phase's roadmap checkmarks", () => {
    const { content } = view();
    expect(content).toContain("4 plan files observed · 2 matching summaries observed");
    expect(content).toMatch(/2 of 24 plans with a summary · 2 roadmap checked/);
  });
});

describe("Plan helpers", () => {
  it("says what a plan's files show", () => {
    expect(planState(plan("7-1", { summaryObserved: true }))).toBe("summary");
    expect(planState(plan("7-1", { planObserved: false, summaryObserved: true }))).toBe("summary");
    expect(planState(plan("7-1"))).toBe("planned");
    expect(planState(plan("7-1", { planObserved: false, roadmapChecked: false }))).toBe("listed");
  });

  it("counts summaries, plan files without one, and the rest of the declared total", () => {
    const [foundation, management, billing] = plans().phases;
    expect(phaseCounts(management)).toEqual({ summaries: 2, planned: 2, rest: 20, total: 24 });
    expect(phaseCounts(foundation)).toEqual({ summaries: 0, planned: 0, rest: 6, total: 6 });
    expect(phaseCounts(billing)).toEqual({ summaries: 0, planned: 0, rest: 0, total: 0 });
    const mixed = [plan("7-1", { summaryObserved: true }), plan("7-2"), plan("7-3", { planObserved: false, roadmapChecked: false }), plan("7-4", { planObserved: false, summaryObserved: true })];
    expect(phaseCounts(phase({ entries: mixed }))).toEqual({ summaries: 2, planned: 1, rest: 1, total: 4 });
    // More entries than declared: the entries are the total.
    expect(phaseCounts(phase({ declaredPlans: 2, entries: mixed }))).toEqual({ summaries: 2, planned: 1, rest: 1, total: 4 });
  });

  it("opens on the first plan without a summary, else the last", () => {
    expect(defaultPlan(plans().phases[1])?.id).toBe("59.3-18");
    expect(defaultPlan(phase({ entries: [plan("7-1", { summaryObserved: true }), plan("7-2", { summaryObserved: true })] }))?.id).toBe("7-2");
    expect(defaultPlan(phase())).toBeNull();
    expect(defaultPlan(undefined)).toBeNull();
  });

  it("groups plans by wave in wave order, plans without a wave last", () => {
    const entries = [plan("7-1", { wave: 3 }), plan("7-2", { wave: null }), plan("7-3", { wave: 1 }), plan("7-4", { wave: 3 }), plan("7-5", { wave: null }), plan("7-6", { wave: 10 })];
    expect(planWaves(phase({ entries })).map((group) => [group.wave, group.plans.map((entry) => entry.id)])).toEqual([
      [1, ["7-3"]], [3, ["7-1", "7-4"]], [10, ["7-6"]], [null, ["7-2", "7-5"]],
    ]);
    expect(planWaves(phase())).toEqual([]);
  });
});
