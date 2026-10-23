import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllowedInventory } from "../../server/allowed-reader";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { buildPath } from "../../server/path-board";
import { resolveWorkspaceRoot } from "../../server/workspace-root";
import { BoardSnapshotSchema } from "../../shared/board-rpc";
import { forkFiles, forkReviewFiles, forkState, upstreamFiles, upstreamReviewFiles } from "../fixtures/path-fixtures";
import type { FixtureFile } from "../fixtures/gsd-fixtures";
import { FixtureWorkspace } from "../helpers/fixture-workspace";

const snapshotOf = async (files: readonly FixtureFile[]) => {
  const workspace = await FixtureWorkspace.create(files);
  try {
    const inventory = await readAllowedInventory(workspace.root);
    const snapshot = buildBoardSnapshot({ workspaceId: "selected", inventory, observedAt: "2026-10-22T00:00:00Z" });
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    return { inventory, snapshot, root: workspace.root };
  } finally { await workspace.cleanup(); }
};
const replaced = (files: readonly FixtureFile[], path: string, content: string | null) =>
  [...files.filter((file) => file.path !== path), ...(content === null ? [] : [{ path, content }])];

describe("GSD Path detection", () => {
  it("chooses GSD Path when .project/STATE.md names a gsd-path pipeline, even beside GSD Core history", async () => {
    const workspace = await FixtureWorkspace.create([...forkFiles, { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Old\n" }]);
    try {
      expect(await resolveWorkspaceRoot(workspace.root)).toMatchObject({ available: true, flavor: "gsd-path" });
      const snapshot = buildBoardSnapshot({ workspaceId: "selected", inventory: await readAllowedInventory(workspace.root), observedAt: "2026-10-22T00:00:00Z" });
      expect(snapshot).toMatchObject({ flavor: "gsd-path", availability: "available" });
      expect(snapshot.overview).toBeUndefined();
    } finally { await workspace.cleanup(); }
  });

  it("keeps GSD Core for a .project file, a non-Path state file, or no Path marker", async () => {
    const core = { path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n" };
    for (const files of [
      [core, { path: ".project", content: "<projectDescription/>\n" }],
      [core, { path: ".project/STATE.md", content: "---\npipeline: other-tool/v1\n---\n" }],
      [core, { path: ".project/notes.md", content: "Unrelated folder.\n" }],
    ]) {
      const workspace = await FixtureWorkspace.create(files);
      try { expect(await resolveWorkspaceRoot(workspace.root)).toMatchObject({ available: true, flavor: "gsd-core" }); }
      finally { await workspace.cleanup(); }
    }
  });

  it("shows an install with no milestone as not started, with or without an empty .project", async () => {
    for (const files of [[{ path: ".gsd-path/runtime.json", content: "{}\n" }], [{ path: ".gsd-path/status_runtime.py", content: "# launcher\n" }, { path: ".project/research/notes.md", content: "x\n" }]]) {
      const { snapshot } = await snapshotOf(files);
      expect(snapshot).toMatchObject({ flavor: "gsd-path", availability: "available", path: { setup: "not-started", state: { availability: "unavailable" }, tasks: { availability: "absent" } } });
    }
  });

  it("reports a later pipeline format as unsupported and parses nothing else", async () => {
    const { snapshot } = await snapshotOf(replaced(forkFiles, ".project/STATE.md", forkState({ pipeline: "gsd-path/v3" })));
    expect(snapshot).toMatchObject({ flavor: "gsd-path", availability: "unsupported", warnings: ["unsupported"], path: { setup: "unsupported", state: { availability: "unavailable", project: null }, tasks: { availability: "unavailable", waves: [] } } });
  });

  // Root reads a mode-000 file anyway, so the check only means something for another user.
  it.skipIf(process.getuid?.() === 0)("keeps GSD Core when .project/STATE.md cannot be opened", async () => {
    const workspace = await FixtureWorkspace.create([{ path: ".planning/ROADMAP.md", content: "## Phases\n- [ ] Phase 1: Safe\n" }, { path: ".project/STATE.md", content: forkState() }]);
    try {
      await chmod(join(workspace.root, ".project", "STATE.md"), 0o000);
      expect(await resolveWorkspaceRoot(workspace.root)).toMatchObject({ available: true, flavor: "gsd-core" });
    } finally {
      await chmod(join(workspace.root, ".project", "STATE.md"), 0o644);
      await workspace.cleanup();
    }
  });

  it("reads branches only when no segment can be a host or a commit", async () => {
    const hostile = forkState().replace("branch: feature/milestone-001", "branch: 9e8d7c6b5a49382716059e8d7c6b5a4938271605").replace("default_branch: main", "default_branch: git.corp.example.com");
    const { snapshot } = await snapshotOf(replaced(forkFiles, ".project/STATE.md", hostile));
    expect(snapshot.path?.state).toMatchObject({ branch: null, defaultBranch: null });
    expect(JSON.stringify(snapshot)).not.toMatch(/corp\.example|9e8d7c6/);
    const release = forkState().replace("branch: feature/milestone-001", "branch: release/1.2");
    expect((await snapshotOf(replaced(forkFiles, ".project/STATE.md", release))).snapshot.path?.state.branch).toBe("release/1.2");
  });

  it("refuses a linked .project and a linked state file without following them", async () => {
    const elsewhere = await FixtureWorkspace.create(forkFiles);
    const linked = await FixtureWorkspace.create([{ path: ".gsd-path/runtime.json", content: "{}\n" }]);
    const linkedState = await FixtureWorkspace.create([{ path: ".project/ROADMAP.md", content: "# Roadmap\n" }]);
    try {
      await linked.createSymlink(".project", `${elsewhere.root}/.project`);
      expect(await resolveWorkspaceRoot(linked.root)).toEqual({ available: false, warning: "containment-refused" });
      await linkedState.createSymlink(".project/STATE.md", `${elsewhere.root}/.project/STATE.md`);
      expect(await resolveWorkspaceRoot(linkedState.root)).toEqual({ available: false, warning: "containment-refused" });
    } finally { await Promise.all([elsewhere.cleanup(), linked.cleanup(), linkedState.cleanup()]); }
  });
});

describe("GSD Path allowlist", () => {
  it("reads only state, roadmap, plan, lookahead state and task files", async () => {
    const { inventory } = await snapshotOf(forkFiles);
    expect(inventory.artifacts.map((artifact) => artifact.key).sort()).toEqual([
      "ROADMAP.md", "STATE.md", "next/STATE.md", "plan/PLAN.md",
      "tasks/T001-pin-runtime-version.md", "tasks/T002-add-deployment-check.md", "tasks/T003-register-invoices.md", "tasks/T004-fix-wave-1-cycle-1.md", "tasks/T005-renamed.md", "tasks/T006-pin-member-base.md",
    ]);
    expect(inventory.watchDirectories).toEqual(["plan", "next", "tasks"]);
    expect(inventory.warnings).toEqual([]);
  });

  it("reads a state file past the per-file cap, up to its own 1 MiB cap", async () => {
    const longLog = Array.from({ length: 4000 }, (_, index) => `- 2026-10-0${index % 9 + 1} — build — wave ${index} review recorded with enough wording to grow the log`).join("\n");
    const { snapshot } = await snapshotOf(replaced(forkFiles, ".project/STATE.md", forkState({}, longLog)));
    expect(snapshot.path?.state.availability).toBe("available");
    expect(snapshot.path?.timeline.logEntries).toBe(4000);
    const { snapshot: oversize } = await snapshotOf(replaced(forkFiles, ".project/STATE.md", forkState({}, "x".repeat(1024 * 1024))));
    expect(oversize).toMatchObject({ availability: "unknown", warnings: ["oversize"], path: { setup: "started", state: { availability: "unavailable" }, warnings: expect.arrayContaining(["state-unavailable"]) } });
    expect(oversize.path?.tasks.counts.total).toBe(6);
  });

  it("refuses linked task files and keeps the rest", async () => {
    const workspace = await FixtureWorkspace.create(forkFiles);
    try {
      await workspace.createSymlink(".project/tasks/T009-linked.md", `${workspace.root}/.project/tasks/T001-pin-runtime-version.md`);
      const path = buildPath(await readAllowedInventory(workspace.root));
      expect(path.warnings).toContain("tasks-unavailable");
      expect(path.tasks.counts.total).toBe(6);
    } finally { await workspace.cleanup(); }
  });
});

describe("GSD Path projections", () => {
  it("projects the fork's state, phase history, roadmap and lookahead as recorded", async () => {
    const { snapshot } = await snapshotOf(forkFiles);
    const path = snapshot.path!;
    expect(path.state).toMatchObject({ availability: "available", project: "acme-orchestrator", milestone: "invoice-evidence", phase: "build", status: "active", branch: "feature/milestone-001", defaultBranch: "main", integration: "pull-request", integrationDefault: "direct", shipped: false });
    // The log spans the program and this milestone; history starts at the latest define, with the inspect just before it.
    expect(path.timeline.entries).toEqual([
      { phase: "inspect", since: "2026-10-04", latest: "2026-10-04", visits: 1, current: false },
      { phase: "define", since: "2026-10-04", latest: "2026-10-04", visits: 1, current: false },
      { phase: "research", since: "2026-10-05", latest: "2026-10-05", visits: 1, current: false },
      { phase: "plan", since: "2026-10-06", latest: "2026-10-08", visits: 2, current: false },
      { phase: "build", since: "2026-10-07", latest: "2026-10-09", visits: 2, current: true },
    ]);
    expect(path.roadmap.milestones.map(({ id, slug, status, depends, current }) => ({ id, slug, status, depends, current }))).toEqual([
      { id: "M001", slug: "invoice-evidence", status: "active", depends: [], current: true },
      { id: "M002", slug: "invoice-validation", status: "pending", depends: ["M001"], current: false },
      { id: "M003", slug: null, status: "abandoned", depends: [], current: false },
    ]);
    expect(path.roadmap.counts).toEqual({ total: 3, shipped: 0, active: 1, pending: 1, abandoned: 1, other: 0 });
    expect(path.next).toEqual({ milestone: "invoice-validation", phase: "research", status: "active" });
    expect(path.warnings).toEqual(["roadmap-malformed", "task-id-conflict"]);
  });

  it("keeps commands, digests and machine paths out of the latest log entry and task titles", async () => {
    const { snapshot } = await snapshotOf(forkFiles);
    const event = snapshot.path!.state.lastEvent!;
    expect(event).toMatchObject({ date: "2026-10-09", phase: "build", shortened: true });
    expect(event.text).toContain("owner ruling on storage");
    expect(event.text).not.toMatch(/dotnet|\/home|a1b2c3d4/);
    const titles = snapshot.path!.tasks.waves.flatMap((wave) => wave.tasks.map((task) => task.title ?? ""));
    expect(titles.join(" ")).not.toMatch(/rm -rf|\/home|\/tmp|&&/);
    expect(JSON.stringify(snapshot)).not.toMatch(/\/home\/ana|verify\.sh|Durable program research/);
  });

  it("joins PLAN.md waves with task files and counts recorded statuses", async () => {
    const tasks = (await snapshotOf(forkFiles)).snapshot.path!.tasks;
    expect(tasks).toMatchObject({ availability: "available", planObserved: true, currentWave: 1, limited: false, unassigned: [] });
    expect(tasks.counts).toEqual({ total: 6, done: 2, inProgress: 1, pending: 2, failed: 0, blocked: 1, other: 0 });
    expect(tasks.waves.map(({ number, name, inPlan, current }) => ({ number, name, inPlan, current }))).toEqual([
      { number: 1, name: "risk burn-down", inPlan: true, current: true },
      { number: 2, name: "walking skeleton", inPlan: true, current: false },
      { number: 3, name: null, inPlan: false, current: false },
    ]);
    expect(tasks.waves[0].goal).toBe("Prove the storage assumptions before product work; if any of this fails, stop before wave 2.");
    // A wrapped goal is read to the end of its paragraph, stopping at the next labelled field.
    expect(tasks.waves[1]).toMatchObject({ goal: "On the web app an authorized user registers one invoice end to end, with the manual-declaration notice.", goalShortened: false });
    const [first, second] = tasks.waves[0].tasks;
    expect(first).toEqual({ id: "T001", title: "Pin the runtime version and add its guard test", status: "done", wave: 1, deps: [], supersedes: [], repo: "web", files: 2, idConflict: false });
    expect(second).toMatchObject({ id: "T002", status: "in-progress", deps: ["T001"], repo: "web", files: 1 });
    expect(tasks.waves[1].tasks).toEqual([
      { id: "T003", title: "Register invoices from the import screen", status: "pending", wave: 2, deps: ["T001", "T002"], supersedes: ["T001"], repo: "web", files: 0, idConflict: false },
      expect.objectContaining({ id: "T005", status: "done", idConflict: true }),
      expect.objectContaining({ id: "T006", repo: null }),
    ]);
    // Quotes keep " #42" in the value; commit hashes and UUIDs are masked.
    expect(tasks.waves[1].tasks[2].title).toBe("Pin member base [omitted] for tenant [omitted] #42");
  });

  it("projects upstream's branch names and single-milestone layout the same way", async () => {
    const path = (await snapshotOf(upstreamFiles)).snapshot.path!;
    expect(path.state).toMatchObject({ branch: "gsd-path/M001", defaultBranch: null, integration: "direct", phase: "build" });
    expect(path.roadmap).toMatchObject({ availability: "absent", milestones: [] });
    expect(path.next).toBeNull();
    expect(path.tasks.waves).toEqual([expect.objectContaining({ number: 1, name: "sync engine", current: true, tasks: [expect.objectContaining({ id: "T001", repo: null, files: 1 }), expect.objectContaining({ id: "T002", status: "pending" })] })]);
    expect(path.timeline.entries.map((entry) => entry.phase)).toEqual(["define", "plan", "build"]);
    expect(path.warnings).toEqual([]);
  });

  it("records a shipped milestone as recorded, and a milestone missing from the roadmap", async () => {
    const path = (await snapshotOf(replaced(forkFiles, ".project/STATE.md", forkState({ phase: "shipped", status: "done", milestone: "other-milestone" })))).snapshot.path!;
    expect(path.state).toMatchObject({ phase: "shipped", status: "done", shipped: true });
    expect(path.warnings).toContain("milestone-not-in-roadmap");
    expect(path.roadmap.milestones.some((milestone) => milestone.current)).toBe(false);
  });

  it("degrades a malformed state, plan or task file to warnings instead of guessing", async () => {
    const files = replaced(replaced(replaced(forkFiles, ".project/STATE.md", "# no frontmatter\n"), ".project/plan/PLAN.md", "## Wave 1 — open fence\n```\nunclosed\n"), ".project/tasks/T006-broken.md", "---\nid: T006\n");
    const path = (await snapshotOf(files)).snapshot.path!;
    expect(path.state.availability).toBe("unavailable");
    expect(path.warnings).toEqual(expect.arrayContaining(["state-malformed", "plan-malformed", "task-malformed"]));
    expect(path.tasks).toMatchObject({ availability: "available", planObserved: false });
    expect(path.tasks.waves.every((wave) => !wave.inPlan)).toBe(true);
  });
});

describe("GSD Path reviews", () => {
  it("reads review, recovery and discussion files within the allowlist", async () => {
    const { inventory } = await snapshotOf([...forkFiles, ...forkReviewFiles]);
    const keys = inventory.artifacts.map((artifact) => artifact.key);
    expect(keys).toEqual(expect.arrayContaining(["discuss/ANSWERS.md", "review/wave-1.cycle1.md", "review/plan-panel-gpt.md", "plan/build-recovery-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c/review/PLAN-PANEL.md"]));
    expect(keys.some((key) => key.includes("not-a-sha") || key.startsWith("build/") || key.startsWith("program/"))).toBe(false);
    expect(inventory.watchDirectories).toEqual(["plan", "next", "tasks", "review", "discuss", "plan/build-recovery-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c", "plan/build-recovery-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c/review"]);
  });

  it("projects the fork's wave cycles, panels and per-family files, superseding only by a settled later cycle", async () => {
    const reviews = (await snapshotOf([...forkFiles, ...forkReviewFiles])).snapshot.path!.reviews;
    expect(reviews).toMatchObject({ availability: "available", limited: false });
    const { waves, planPanel, otherFiles } = reviews.current;
    expect(waves.map(({ wave, cycle, verdict, superseded, tasksReviewed }) => ({ wave, cycle, verdict, superseded, tasksReviewed }))).toEqual([
      { wave: 1, cycle: 1, verdict: "blocked", superseded: true, tasksReviewed: 2 },
      { wave: 1, cycle: 2, verdict: "pass", superseded: false, tasksReviewed: 3 },
      { wave: 1, cycle: 3, verdict: null, superseded: false, tasksReviewed: null },
      { wave: 2, cycle: 1, verdict: null, superseded: false, tasksReviewed: null },
    ]);
    expect(waves[0]).toMatchObject({ depth: "full", lens: null, tasks: [{ id: "T001", verdict: "pass" }, { id: "T002", verdict: "fail" }], panel: { families: ["gpt", "muse"], actionable: 2, warnings: 2, conflicts: 0, familyFiles: ["gpt", "muse"] } });
    expect(waves[3].panel).toMatchObject({ actionable: 0, familyFiles: [] });
    expect(planPanel).toEqual({ families: ["gpt", "muse"], actionable: 0, warnings: 1, conflicts: 0, familyFiles: ["gpt", "muse"] });
    expect(otherFiles).toEqual([]);
    expect(JSON.stringify(reviews)).not.toMatch(/gsd-path-caps|review_findings/);
  });

  it("dates a recovery's set-aside reviews from its log entry", async () => {
    const { recoveries } = (await snapshotOf([...forkFiles, ...forkReviewFiles])).snapshot.path!.reviews;
    expect(recoveries).toEqual([{ base: "0f1e2d3", date: "2026-10-08", kind: "plan", reviews: expect.objectContaining({
      waves: [expect.objectContaining({ wave: 1, cycle: 1, verdict: "pass", superseded: false })],
      planPanel: { families: ["gpt", "muse"], actionable: 1, warnings: 4, conflicts: 0, familyFiles: [] },
    }) }]);
  });

  it("projects upstream's deep-review lenses, final review, gap reviews and unrecognized files", async () => {
    const reviews = (await snapshotOf([...upstreamFiles, ...upstreamReviewFiles])).snapshot.path!.reviews;
    expect(reviews.current.waves.map(({ cycle, lens, verdict, superseded, depth }) => ({ cycle, lens, verdict, superseded, depth }))).toEqual([
      { cycle: 1, lens: "adversarial", verdict: "blocked", superseded: true, depth: "deep" },
      { cycle: 1, lens: "contract", verdict: "pass", superseded: false, depth: "deep" },
      { cycle: 2, lens: "adversarial", verdict: "pass", superseded: false, depth: "deep" },
    ]);
    expect(reviews.current.final).toEqual({ verdict: "blocked", criteria: [
      { id: "SC1", text: "Notes written offline reach the server", verdict: "met" },
      { id: "SC2", text: "A conflict shows a banner", verdict: "not-met" },
    ] });
    expect(reviews.current.gaps).toEqual([{ number: 1, verdict: "pass", risk: "project Verify" }]);
    expect(reviews.current).toMatchObject({ patchFindings: true, otherFiles: ["reviewer-notes.md"], planPanel: null });
    expect(reviews.recoveries).toEqual([]);
  });

  it("reports no review folder as absent and a linked one as unavailable", async () => {
    expect((await snapshotOf(upstreamFiles)).snapshot.path!.reviews).toMatchObject({ availability: "absent", current: { waves: [] } });
    const elsewhere = await FixtureWorkspace.create(upstreamReviewFiles);
    const workspace = await FixtureWorkspace.create(upstreamFiles);
    try {
      await workspace.createSymlink(".project/review", `${elsewhere.root}/.project/review`);
      const path = buildPath(await readAllowedInventory(workspace.root));
      expect(path.reviews.availability).toBe("unavailable");
      expect(path.warnings).toContain("reviews-unavailable");
    } finally { await Promise.all([elsewhere.cleanup(), workspace.cleanup()]); }
  });
});

describe("GSD Path questions", () => {
  it("lists answers still awaiting a follow-up and closes disposed or superseded ones", async () => {
    const questions = (await snapshotOf([...forkFiles, ...forkReviewFiles])).snapshot.path!.questions;
    expect(questions.counts).toEqual({ answers: 5, pending: 1, closed: 2 });
    expect(questions.pending).toEqual([{ id: "A001", date: "2026-10-05", topic: "storage account", question: expect.stringContaining("Which storage account keeps the invoice files"), status: "needs-user", owner: "user", target: ".project/intent/INTENT.md" }]);
    expect(questions.pending[0].question).not.toMatch(/account-key|\/home/);
  });

  it("is absent until a discussion records an answer", async () => {
    expect((await snapshotOf(forkFiles)).snapshot.path!.questions).toEqual({ availability: "absent", pending: [], counts: { answers: 0, pending: 0, closed: 0 }, limited: false });
  });
});
