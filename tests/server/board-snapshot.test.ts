import { describe, expect, it } from "vitest";
import { createBoardService } from "../../index.server";
import { buildBoardSnapshot, classifyPhase } from "../../server/board-snapshot";
import { BoardSnapshotSchema } from "../../shared/board-rpc";
import { fixtureFiles } from "../fixtures/gsd-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

describe("buildBoardSnapshot", () => {
  it("counts current GSD slug-phase plan pairs despite unconsumed nested frontmatter", async () => {
    const phaseDir = ".planning/phases/01-safe-evidence-board";
    const plan = (id: string) => `---\nphase: 01-safe-evidence-board\nplan: "${id}"\nestimate:\n  tokens: 10\nmust_haves:\n  truths:\n    - "safe evidence"\n---\n# Plan\n`;
    const summary = (id: string) => `---\nphase: 01-safe-evidence-board\nplan: "${id}"\nrequires:\n  - phase: 01-safe-evidence-board\nprovides:\n  - "paired evidence"\n---\n# Summary\n`;
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "### Phase 1: Safe Evidence Board\n" },
      ...["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].flatMap((id) => [
        { path: `${phaseDir}/01-${id}-PLAN.md`, content: plan(id) },
        { path: `${phaseDir}/01-${id}-SUMMARY.md`, content: summary(id) },
      ]),
      { path: `${phaseDir}/01-VERIFICATION.md`, content: "---\nphase: 01-safe-evidence-board\nstatus: human_needed\ncovered_files:\n  - .planning/phases/01-safe-evidence-board/01-01-PLAN.md\n---\n# Verification\n" },
    ]);
    const service = createBoardService({ resolveWorkspace: async () => workspace.root });

    const result = await service.handle({ workspaceId: "selected", intent: "refresh" });

    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") throw new Error("expected snapshot");
    const phase = result.snapshot.milestones[0].phases[0];
    expect(phase).toMatchObject({ phaseId: "1", planCount: 10, summaryCount: 10, availability: "available" });
    expect(phase.warnings).not.toContain("malformed");
    expect(phase.warnings).not.toContain("inconsistent");
    await service.close();
    await workspace.cleanup();
  });

  it("keeps discovered phases after roadmap phases in numeric-segment order", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const service = createBoardService({ resolveWorkspace: async () => workspace.root });

    const result = await service.handle({ workspaceId: "selected", intent: "refresh" });

    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") throw new Error("expected snapshot");
    const phases = result.snapshot.milestones.find((milestone) => milestone.active)?.phases ?? [];
    expect(phases.map((phase) => phase.phaseId)).toEqual(["2.2", "2.10", "99"]);
    expect(phases.at(-1)).toMatchObject({ roadmapDeclared: false });
    await service.close();
    await workspace.cleanup();
  });

  it("keeps a divided roadmap phase visible when only its directory placeholder exists", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-14T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [{
          key: "ROADMAP.md",
          kind: "roadmap",
          bytes: new TextEncoder().encode("### Phase 14: Inventário em `dev`\n### Phase 14.9.1: Bootstrap mínimo\n"),
          size: 76,
        }],
        problems: [], warnings: [], limited: false,
      },
    });

    expect(snapshot.milestones[0].phases).toEqual([
      expect.objectContaining({ phaseId: "14", roadmapDeclared: true }),
      expect.objectContaining({ phaseId: "14.9.1", roadmapDeclared: true, title: "Bootstrap mínimo", column: "backlog" }),
    ]);
  });

  it("does not promote an orphan summary into plan progress", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [
          { key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("### Phase 2.2: Early\n"), size: 22 },
          { key: "phases/02.2-early/02-01-SUMMARY.md", kind: "summary", phaseId: "2.2", bytes: new TextEncoder().encode("---\nplan: '01'\n---\n# Summary\n"), size: 29 },
        ],
        problems: [],
        warnings: [],
        limited: false,
      },
    });

    expect(snapshot.milestones[0].phases[0]).toMatchObject({ planCount: 0, summaryCount: 0, plans: [], column: "unknown" });
    expect(snapshot.milestones[0].phases[0].warnings).toContain("inconsistent");
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("carries roadmap Goal and success criteria to a future phase without plan artifacts", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [{ key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("### Phase 3: Approved Structured Trace\n\n**Goal**: Users can inspect a privacy-approved structured execution trace.\n**Success Criteria** (what must be TRUE):\n\n1. The producer must be approved.\n"), size: 200 }],
        problems: [], warnings: [], limited: false,
      },
    });
    expect(snapshot.milestones[0].phases[0]).toMatchObject({ phaseId: "3", planCount: 0, goal: "Users can inspect a privacy-approved structured execution trace.", successCriteria: ["The producer must be approved."] });
  });

  it("keeps a current phase complete when only an archived milestone hit the snapshot limit", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [
          { key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("### Phase 3: Current\n"), size: 21 },
          { key: "phases/03-current/03-01-PLAN.md", kind: "plan", phaseId: "3", bytes: new TextEncoder().encode("---\nplan: '01'\n---\n# Plan\n"), size: 29 },
        ],
        problems: [{ milestoneId: "v0.1", phaseId: "1", warning: "observation-limited" }],
        warnings: ["observation-limited"],
        limited: true,
      },
    });

    expect(snapshot).toMatchObject({ limited: true });
    expect(snapshot.milestones[0].phases[0]).toMatchObject({ limited: false, availability: "available" });
  });

  it("classifies paired execution evidence without treating STATE as authority", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [
          { key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("### Phase 2: Evidence\n"), size: 22 },
          { key: "phases/02-evidence/02-01-PLAN.md", kind: "plan", phaseId: "2", bytes: new TextEncoder().encode("---\nplan: '01'\n---\n# Plan\n"), size: 29 },
          { key: "phases/02-evidence/02-01-SUMMARY.md", kind: "summary", phaseId: "2", bytes: new TextEncoder().encode("---\nplan: '01'\nstatus: complete\n---\n# Summary\n"), size: 49 },
          { key: "phases/02-evidence/02-02-PLAN.md", kind: "plan", phaseId: "2", bytes: new TextEncoder().encode("---\nplan: '02'\n---\n# Plan\n"), size: 29 },
          { key: "STATE.md", kind: "state", bytes: new TextEncoder().encode("Phase: 2\nStatus: executing\n"), size: 27 },
        ],
        problems: [],
        warnings: [],
        limited: false,
      },
    });

    const phase = snapshot.milestones[0].phases[0];
    expect(phase).toMatchObject({
      column: "executing",
      planCount: 2,
      summaryCount: 1,
      stateMarker: true,
    });
    expect(phase.proof).toContainEqual(expect.objectContaining({ source: "summary", status: "observed", count: 1 }));
    expect(phase.proof).toContainEqual(expect.objectContaining({ source: "state", status: "observed" }));
  });

  it("carries a safe PLAN heading title without promoting summary evidence to completion", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [
          { key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("### Phase 2: Evidence\n"), size: 22 },
          { key: "phases/02-evidence/02-01-PLAN.md", kind: "plan", phaseId: "2", bytes: new TextEncoder().encode("---\nplan: '01'\n---\n# Plan 01: Título seguro do plano\n\n**As a** person, **I want to** inspect this phase, **so that** I understand it.\n\n<success_criteria>\n- The Goal is available.\n</success_criteria>\n"), size: 190 },
          { key: "phases/02-evidence/02-01-SUMMARY.md", kind: "summary", phaseId: "2", bytes: new TextEncoder().encode("---\nplan: '01'\nstatus: complete\n---\n# Summary\n"), size: 49 },
        ],
        problems: [],
        warnings: [],
        limited: false,
      },
    });

    expect(snapshot.milestones[0].phases[0].plans).toEqual([expect.objectContaining({ title: "Título seguro do plano", evidenceStatus: "summary-present", summaryPaired: true, summaryStatus: "complete" })]);
    expect(snapshot.milestones[0].phases[0]).toMatchObject({ goal: "As a person, I want to inspect this phase, so that I understand it.", successCriteria: ["The Goal is available."] });
    expect(snapshot.milestones[0].phases[0].column).toBe("verifying");
  });

  it("keeps a valid archive navigable beside an indexed unavailable archive", () => {
    const snapshot = buildBoardSnapshot({
      workspaceId: "selected",
      observedAt: "2026-09-13T12:00:00.000Z",
      inventory: {
        available: true,
        artifacts: [
          { key: "ROADMAP.md", kind: "roadmap", bytes: new TextEncoder().encode("# Current\n"), size: 10 },
          { key: "MILESTONES.md", kind: "milestones", bytes: new TextEncoder().encode("## v0.1\n## v0.2\n"), size: 16 },
          { key: "milestones/v0.1-ROADMAP.md", kind: "roadmap", milestoneId: "v0.1", bytes: new TextEncoder().encode("### Phase 1: Archived\n"), size: 22 },
          { key: "milestones/v0.1-phases/01-archived/01-CONTEXT.md", kind: "context", milestoneId: "v0.1", phaseId: "1", bytes: new TextEncoder().encode("# Context\n"), size: 10 },
        ],
        problems: [],
        warnings: [],
        limited: false,
      },
    });

    const safe = snapshot.milestones.find((milestone) => milestone.id === "archive:v0.1");
    const missing = snapshot.milestones.find((milestone) => milestone.id === "archive:v0.2");
    expect(safe).toMatchObject({ archived: true, availability: "available", phases: [{ id: "archive:v0.1:1", column: "discussed" }] });
    expect(missing).toMatchObject({ archived: true, availability: "unknown", phases: [] });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("uses the six evidence classes in authoritative precedence order", () => {
    const base = { declared: true, itemCount: 1, planCount: 0, summaryCount: 0, hasContext: false, verification: "absent" as const, blockedByReviewOrUat: false, unavailable: false };
    expect(classifyPhase({ ...base, itemCount: 0 })).toBe("backlog");
    expect(classifyPhase({ ...base, hasContext: true })).toBe("discussed");
    expect(classifyPhase({ ...base, planCount: 1 })).toBe("planned");
    expect(classifyPhase({ ...base, planCount: 2, summaryCount: 1 })).toBe("executing");
    expect(classifyPhase({ ...base, planCount: 1, summaryCount: 1 })).toBe("verifying");
    expect(classifyPhase({ ...base, verification: "passed" })).toBe("completed");
  });
});
