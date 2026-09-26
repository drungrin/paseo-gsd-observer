import { describe, expect, it } from "vitest";
import { readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { BoardSnapshotSchema } from "../../shared/board-rpc";
import { fixtureFiles } from "../fixtures/gsd-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

describe("buildBoardSnapshot", () => {
  it("publishes availability and warnings without any Legacy milestone projection or archive read", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-26T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toMatchObject({ availability: "available", freshness: "current" });
    expect(snapshot).not.toHaveProperty("milestones");
    expect(JSON.stringify(snapshot)).not.toMatch(/Archived roadmap|Archived phase|v0\.1/);
    await workspace.cleanup();
    const withoutRoadmap = await FixtureWorkspace.create([{ path: ".planning/STATE.md", content: "Phase: 1\n" }]);
    expect(buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(withoutRoadmap.root), observedAt: "2026-09-26T00:00:00Z" })).toMatchObject({ availability: "unknown", warnings: ["absent"] });
    await withoutRoadmap.cleanup();
    expect(buildBoardSnapshot({ workspaceId: "test", inventory: { available: false, artifacts: [], problems: [], warnings: ["unreadable"], limited: false }, observedAt: "2026-09-26T00:00:00Z" }))
      .toMatchObject({ availability: "unavailable", freshness: "refresh-failed", observedAt: null, warnings: ["unreadable"] });
  });

  it("keeps snapshot warnings and caps identical with optional checks", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n" },
      { path: ".planning/STATE.md", content: "Phase: 1\nStatus: planning\n" },
      { path: ".planning/phases/01-safe/01-CONTEXT.md", content: "# Discussed\n" },
    ]);
    const before = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-24T00:00:00Z" });
    await workspace.write(".planning/phases/01-safe/01-UI-SPEC.md", "---\nstatus: draft\n---\n");
    await workspace.write(".planning/phases/01-safe/01-VALIDATION.md", "---\nstatus: draft\nnyquist_compliant: false\n---\n");
    await workspace.createSymlink(".planning/phases/01-safe/01-SECURITY.md", "/etc/passwd");
    const after = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-24T00:00:00Z" });
    expect(after.warnings).toEqual(before.warnings);
    expect(after.limited).toBe(before.limited);
    expect(after.overview?.plans.phases[0].checks.plan.security.observation).toBe("unavailable");
    expect(after.overview?.plans.phases[0].checks.plan.nyquist).toEqual({ observation: "observed", reportedStatus: "draft", compliant: false });
    expect(BoardSnapshotSchema.safeParse(after).success).toBe(true);
    await workspace.cleanup();
  });

  it("refreshes current Context excerpts", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.3-contracts/59.3-CONTEXT.md", content: "<decisions>\n## Implementation Decisions\n### Lifecycle\n- **D-01:** Drafts are editable.\n</decisions>\n" },
    ]);
    const read = async () => buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    const before = await read();
    expect(before.overview?.context.phases[0]).toMatchObject({ id: "59.3", observation: "observed", current: true, decisionCount: 1 });
    await workspace.write(".planning/phases/59.3-contracts/59.3-CONTEXT.md", "<decisions>\n## Implementation Decisions\n### Lifecycle\n- **D-02:** Confirmed history is retained.\n</decisions>\n");
    const after = await read();
    expect(after.overview?.context.phases[0].decisionGroups[0].decisions[0].id).toBe("D-02");
    expect(after.warnings).toEqual(before.warnings);
    expect(BoardSnapshotSchema.safeParse(after).success).toBe(true);
    await workspace.cleanup();
  });

  it("refreshes current Validation projections", async () => {
    const validation = (status: string) => `---\nstatus: draft\nnyquist_compliant: false\n---\n## Per-Task Verification Map\n\n| Task ID | Automated Command | Status |\n|---|---|---|\n| 59.3-01-01 | \`pnpm test\` | ${status} |\n`;
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.3-contracts/59.3-VALIDATION.md", content: validation("⬜ pending") },
    ]);
    const read = async () => buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    const before = await read();
    expect(before.overview?.validation.phases[0]).toMatchObject({ id: "59.3", observation: "observed", current: true, nyquistCompliant: false, tables: [{ hiddenColumns: ["Automated Command"], counts: { pending: 1 } }] });
    await workspace.write(".planning/phases/59.3-contracts/59.3-VALIDATION.md", validation("✅ green"));
    const after = await read();
    expect(after.overview?.validation.phases[0].tables[0].counts).toMatchObject({ passing: 1, pending: 0 });
    expect(after.warnings).toEqual(before.warnings);
    expect(BoardSnapshotSchema.safeParse(after).success).toBe(true);
    expect(JSON.stringify(after.overview?.validation)).not.toContain("pnpm");
    await workspace.cleanup();
  });

  it("keeps the snapshot schema-valid when a non-current VALIDATION.md is pathological", async () => {
    const audits = Array.from({ length: 65 }, (_, index) => `## Validation Audit 2026-01-${String((index % 28) + 1).padStart(2, "0")}\n`).join("\n");
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n- [ ] Phase 60: Billing\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/60-billing/60-VALIDATION.md", content: `---\nthe_extremely_long_frontmatter_key_for_the_secondary_validation_status: ok\n---\n${audits}\n## Wave 0 Requirements\n${"- [x] item\n".repeat(257)}` },
    ]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.validation.phases[1]).toMatchObject({ id: "60", observation: "observed", auditCount: 64, wave0: { total: 256 } });
    await workspace.cleanup();
  });

  it("projects per-phase UAT into the overview", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [x] Phase 59.1: Help\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.1-help/59.1-UAT.md", content: "---\nstatus: partial\n---\n## Tests\n\n### 1. Panel readable\nexpected: Readable at http://localhost:5043\nresult: issue\nreported: \"Behind the form in src/Help/Panel.razor\"\nseverity: blocker\n\n## Summary\n\ntotal: 1\npassed: 0\nissues: 1\n" },
    ]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.uat.phases.map((phase) => [phase.id, phase.observation])).toEqual([["59.1", "observed"], ["59.3", "not_observed"]]);
    expect(snapshot.overview?.uat.phases[0]).toMatchObject({ recordedStatus: "partial", results: { issue: 1 }, summary: { mismatches: [] }, tests: [{ severity: { level: "blocker" }, history: true }] });
    expect(JSON.stringify(snapshot.overview?.uat)).not.toMatch(/localhost|5043|Panel\.razor|src\//);
    await workspace.cleanup();
  });

  it("projects per-phase verification into the overview and flags a body status that disagrees with the header", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [x] Phase 59.1: Help\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.1-help/59.1-VERIFICATION.md", content: "---\nstatus: passed\nscore: 3/4 must-haves verified\nhuman_verification:\n  - test: \"Read the guide\"\n    expected: \"Plain\"\n---\n# Phase 59.1\n\n**Status:** human_needed\n\n### Observable Truths\n\n| # | Truth | Status | Evidence |\n|---|---|---|---|\n| 1 | Panel opens | ✓ VERIFIED | Journey green |\n| 2 | Panel is not modal | ✗ FAILED | Still red at http://localhost:5043 in src/Help/Panel.razor |\n\n### Behavioral Spot-Checks\n\n| Behavior | Command | Result | Status |\n|---|---|---|---|\n| Help closes | `pnpm test -- close` | exit 1 | ✗ FAIL |\n" },
    ]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.verification.phases.map((phase) => [phase.id, phase.observation])).toEqual([["59.1", "observed"], ["59.3", "not_observed"]]);
    expect(snapshot.overview?.verification.phases[0]).toMatchObject({ recordedStatus: "passed", bodyStatus: "human_needed", score: { verified: 3, total: 4 }, openHumanCount: 1,
      truthTables: [{ rowCount: 2, counts: { verified: 1, failed: 1 } }], checks: [{ family: "behavior", counts: { failed: 1 } }] });
    expect(JSON.stringify(snapshot.overview?.verification)).not.toMatch(/localhost|5043|Panel\.razor|src\/|pnpm/);
    await workspace.cleanup();
  });

  it("projects standalone TODOs without changing snapshot warnings", async () => {
    const base = [
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
    ];
    const workspace = await FixtureWorkspace.create(base);
    const before = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    await workspace.write(".planning/todos/pending/2026-09-25-check-help.md", "---\ncreated: 2026-09-25\ntitle: Check help on a real device\narea: web\n---\n## Problem\nNeeds a person.\n");
    await workspace.write(".planning/todos/backlog/2026-09-25-check-help.md", "---\ncreated: 2026-09-25\ntitle: Check help later\nstatus: deferred\n---\n");
    const after = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(after).success).toBe(true);
    expect(after.overview?.todos).toMatchObject({ availability: "available", directoryState: "observed", counts: { pending: 1, backlog: 1, totalFiles: 2, distinctTasks: 1, duplicates: 2, displayed: 2 } });
    expect(after.overview?.todos.items.map((item) => item.duplicateName)).toEqual([true, true]);
    expect(after.warnings).toEqual(before.warnings);
    expect(after.limited).toBe(before.limited);
    expect(JSON.stringify(after.overview?.todos)).not.toContain("2026-09-25-check-help.md");
    await workspace.cleanup();
  });

  it("projects debug sessions and their archive without changing Plans or TODOs", async () => {
    const base = [
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 59.3: Contracts\n" },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"59.3\"\n---\n" },
      { path: ".planning/phases/59.3-contracts/59.3-01-PLAN.md", content: "---\nphase: 59.3-contracts\nplan: \"01\"\n---\n# Plan\n" },
    ];
    const workspace = await FixtureWorkspace.create(base);
    try {
      const before = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
      expect(before.overview?.debug).toMatchObject({ availability: "available", directoryState: "absent", sessions: [] });
      await workspace.write(".planning/debug/login-mobile-comb-falha.md", "---\nstatus: awaiting_human_verify\ntrigger: \"Login fails on the mobile app\"\nupdated: 2026-09-08T14:28:00Z\n---\n\n## Current Focus\n\nnext_action: \"Promote the fixed build and retry the login.\"\n");
      await workspace.write(".planning/debug/knowledge-base.md", "---\nstatus: complete\ntype: knowledge_base\n---\n");
      await workspace.write(".planning/debug/58-06-red-evidence.json", "{}");
      await workspace.write(".planning/debug/resolved/civil-servant-outro-orgao.md", "---\nstatus: resolved\nresolved: 2026-08-12\n---\n\n## Resolution\n\nroot_cause: A tenant-scoped query hid a global key.\nfiles_changed: [src/Handler.cs]\n");
      const after = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
      expect(BoardSnapshotSchema.safeParse(after).success).toBe(true);
      expect(after.overview?.debug).toMatchObject({ availability: "available", directoryState: "observed", archiveState: "observed", countsComplete: true,
        counts: { active: 1, archived: 1, unresolved: 1, awaitingVerification: 1, resolved: 1, knowledgeBase: 1, displayed: 2 } });
      expect(after.overview?.debug.sessions.map((item) => [item.slug, item.statusKind, item.location])).toEqual([
        ["login-mobile-comb-falha", "awaiting-verification", "active"], ["civil-servant-outro-orgao", "resolved", "archived"],
      ]);
        expect(after.warnings).toEqual(before.warnings);
      expect(after.limited).toBe(before.limited);
      expect(after.overview?.plans).toEqual(before.overview?.plans);
      expect(after.overview?.todos).toEqual(before.overview?.todos);
      expect(JSON.stringify(after.overview?.debug)).not.toMatch(/\.md|\.json|debug\/|src\/|Handler\.cs/);
    } finally { await workspace.cleanup(); }
  });

  it("projects the current roadmap parking lot without merging active phases or standalone TODOs", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: [
        "## Phases", "- [ ] Phase 22: Staging storage", "", "## Backlog (parking lot)",
        "### Phase 999.1: Manual infrastructure checks (BACKLOG)", "**Goal:** Check the real cluster without claiming live results.", "**Plans:** 0 plans", "",
        "### Phase 22: Staging storage", "**Goal:** This is a real current phase despite this heading's location.", "",
        "### Phase 999.2: Old secret-state obligation (ABSORVIDA PELA PHASE 14.1 — NÃO EXECUTAR)", "**Goal:** Historical record; the obligation moved to Phase 14.1.", "Plans:", "- [x] Transferred to Phase 14.1", "",
        "## Next milestone", "### Phase 999.3: Not in Backlog", "",
      ].join("\n") },
      { path: ".planning/STATE.md", content: "---\nmilestone: v3.0\ncurrent_phase: \"22\"\n---\n" },
      { path: ".planning/todos/pending/2026-09-25-check-a-different-thing.md", content: "---\ntitle: A separate standalone task\n---\n" },
    ]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.parkingLot).toMatchObject({ availability: "available", section: "observed", counts: { recorded: 2, parked: 1, absorbed: 1, displayed: 2 } });
    expect(snapshot.overview?.parkingLot.items.map((item) => [item.id, item.disposition])).toEqual([["999.1", "parked"], ["999.2", "absorbed"]]);
    expect(snapshot.overview?.roadmap.phases.map((phase) => phase.id)).toContain("22");
    expect(snapshot.overview?.parkingLot.items.map((item) => item.title)).not.toContain("A separate standalone task");
    expect(JSON.stringify(snapshot.overview?.parkingLot)).not.toMatch(/\.planning\/todos|\.md|\bsecret:/);
    await workspace.cleanup();
  });

  it("keeps a completed milestone's backlog out of the current parking lot", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: [
        "## Milestone v1.0 (Completed)", "### Phases", "- [x] Phase 1: Earlier", "## Backlog", "### Phase 999.1: Archived proposal",
        "## Milestone v2.0", "### Phases", "- [ ] Phase 2: Current", "## Backlog", "### Phase 999.2: Current parking entry",
      ].join("\n") },
      { path: ".planning/STATE.md", content: "---\nmilestone: v2.0\ncurrent_phase: \"2\"\n---\n" },
    ]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.parkingLot.items.map((item) => item.id)).toEqual(["999.2"]);
    expect(snapshot.overview?.parkingLot.counts).toMatchObject({ recorded: 1, parked: 1 });
    await workspace.cleanup();
  });

  it("does not claim an empty current parking lot when the root roadmap has ambiguous milestones", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: [
      "## Milestone v1.0", "### Phases", "- [x] Phase 1: Earlier", "## Backlog", "### Phase 999.1: Old proposal",
      "## Milestone v2.0", "### Phases", "- [ ] Phase 2: Current", "## Backlog", "### Phase 999.2: Later proposal",
    ].join("\n") }]);
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-09-25T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.overview?.roadmap.availability).toBe("unavailable");
    expect(snapshot.overview?.parkingLot).toMatchObject({ availability: "unavailable", section: "unavailable", items: [] });
    await workspace.cleanup();
  });
});
