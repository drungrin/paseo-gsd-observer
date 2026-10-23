import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
import { createBoardController } from "../../index.client";
import { snapshotChanges } from "../../client/board-state";
import type { BoardRequest, BoardResponse, BoardSnapshot } from "../../shared/board-rpc";
import type { BoardPath, PathTask } from "../../shared/path";

const task = (id: string, status: string): PathTask => ({ id, title: null, status, wave: 1, deps: [], supersedes: [], repo: null, files: 0, idConflict: false });
const path = (tasks: PathTask[], overrides: Partial<BoardPath> = {}): BoardPath => ({
  setup: "started",
  state: { availability: "available", project: null, milestone: "m", phase: "build", status: "active", branch: null, defaultBranch: null, integration: null, integrationDefault: null, shipped: false, lastEvent: { date: "2026-10-09", phase: "build", text: "wave 1 dispatched", shortened: false } },
  timeline: { availability: "available", logEntries: 1, entries: [] },
  roadmap: { availability: "absent", counts: { total: 0, shipped: 0, active: 0, pending: 0, abandoned: 0, other: 0 }, milestones: [] },
  next: null,
  tasks: { availability: "available", planObserved: true, currentWave: 1, limited: false, unassigned: [], counts: { total: tasks.length, done: 0, inProgress: 0, pending: 0, failed: 0, blocked: 0, other: 0 },
    waves: [{ number: 1, name: null, goal: null, goalShortened: false, inPlan: true, current: true, tasks }] },
  reviews: { availability: "absent", limited: false, recoveries: [], current: { waves: [], planPanel: null, final: null, gaps: [], patchFindings: false, otherFiles: [] } },
  questions: { availability: "absent", limited: false, pending: [], counts: { answers: 0, pending: 0, closed: 0 } },
  warnings: [],
  ...overrides,
});

const snapshot = (overrides: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [], limited: false, ...overrides,
});

describe("board controller", () => {
  it("does not announce a failed refresh as updated evidence", async () => {
    let current = snapshot();
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async () => ({ kind: "snapshot", snapshot: current }) });
    await controller.dispatch("snapshot");
    current = snapshot({ freshness: "refresh-failed" });
    await controller.dispatch("refresh");
    expect(controller.getState()).toMatchObject({ error: "Could not refresh evidence.", refreshAnnouncement: null, snapshot: { freshness: "refresh-failed" } });
    current = snapshot();
    await controller.dispatch("refresh");
    expect(controller.getState()).toMatchObject({ error: null, refreshAnnouncement: "Evidence updated.", snapshot: { freshness: "current" } });
    controller.dispose();
  });

  it("merges status polls into the last snapshot without replacing its evidence or announcing", async () => {
    let response: BoardResponse = { kind: "snapshot", snapshot: snapshot() };
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async () => response });
    await controller.dispatch("snapshot");
    response = { kind: "status", workspaceId: "selected", observedAt: "2026-09-13T12:05:00.000Z", freshness: "stale", availability: "available", revision: 2, warnings: [] };
    await controller.dispatch("status");
    expect(controller.getState()).toMatchObject({ busy: false, refreshAnnouncement: null, snapshot: { freshness: "stale", revision: 2, observedAt: "2026-09-13T12:05:00.000Z" } });
    controller.dispose();
  });

  it("starts empty for a newly selected workspace and ignores the previous workspace's late response", async () => {
    let resolve: ((value: BoardResponse) => void) | undefined;
    const controller = createBoardController({ workspaceId: "first", callBoardRpc: () => new Promise((done) => { resolve = done; }) });
    const pending = controller.dispatch("refresh");
    controller.setWorkspace("second");
    expect(controller.getState()).toMatchObject({ workspaceId: "second", snapshot: null, busy: false });
    resolve?.({ kind: "snapshot", snapshot: snapshot({ workspaceId: "first" }) });
    await pending;
    expect(controller.getState()).toMatchObject({ workspaceId: "second", snapshot: null });
    controller.dispose();
  });

  it("follows the files: a poll that finds them changed reads them again and names what changed", async () => {
    const calls: BoardRequest["intent"][] = [];
    let files = snapshot({ flavor: "gsd-path", path: path([task("T001", "in-progress"), task("T002", "pending")]) });
    let freshness: BoardSnapshot["freshness"] = "current";
    const controller = createBoardController({ workspaceId: "selected", clock: () => 1_000, callBoardRpc: async (input) => {
      calls.push(input.intent);
      return input.intent === "status" ? { kind: "status", workspaceId: "selected", observedAt: files.observedAt, freshness, availability: "available", revision: files.revision, warnings: [] } : { kind: "snapshot", snapshot: files };
    } });
    await controller.dispatch("snapshot");
    await controller.poll();
    expect(calls).toEqual(["snapshot", "status"]);
    files = snapshot({ flavor: "gsd-path", revision: 3, path: path([task("T001", "done"), task("T002", "pending"), task("T003", "pending")]) });
    freshness = "stale";
    await controller.poll();
    expect(calls).toEqual(["snapshot", "status", "status", "refresh"]);
    expect(controller.getState().changes).toEqual({ at: 1_000, tasks: ["T001", "T003"], summary: ["T001 done", "T003 added"] });
    controller.dispose();
  });

  it("does not render again for a poll that changes nothing, and keeps a read in progress busy", async () => {
    let resolve: ((value: BoardResponse) => void) | undefined;
    const status: BoardResponse = { kind: "status", workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [] };
    let slow = false;
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: (input) => input.intent === "status" ? Promise.resolve(status) : slow ? new Promise((done) => { resolve = done; }) : Promise.resolve({ kind: "snapshot", snapshot: snapshot() }) });
    await controller.dispatch("snapshot");
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.dispatch("status");
    expect(listener).not.toHaveBeenCalled();
    slow = true;
    const reading = controller.dispatch("refresh");
    await controller.dispatch("status");
    expect(controller.getState().busy).toBe(true);
    // A poll while a read is in progress asks nothing.
    await controller.poll();
    resolve?.({ kind: "snapshot", snapshot: snapshot({ revision: 2 }) });
    await reading;
    expect(controller.getState()).toMatchObject({ busy: false, snapshot: { revision: 2 } });
    controller.dispose();
  });
});

describe("following the files", () => {
  it("says a poll got no answer without calling it a failed read, and clears it on the next answer", async () => {
    let failing = false;
    const status: BoardResponse = { kind: "status", workspaceId: "selected", observedAt: "2026-09-13T12:00:00.000Z", freshness: "current", availability: "available", revision: 1, warnings: [] };
    const controller = createBoardController({ workspaceId: "selected", callBoardRpc: async (input) => {
      if (input.intent !== "status") return { kind: "snapshot", snapshot: snapshot() };
      if (failing) throw new Error("connection lost");
      return status;
    } });
    await controller.dispatch("snapshot");
    failing = true;
    await controller.poll();
    expect(controller.getState()).toMatchObject({ statusFailed: true, error: null, busy: false });
    failing = false;
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.poll();
    expect(controller.getState()).toMatchObject({ statusFailed: false, error: null });
    expect(listener).toHaveBeenCalled();
    controller.dispose();
  });

  it("reads a workspace again when the server no longer observes it, at most every 30 seconds, without announcing it", async () => {
    let now = 0;
    const calls: BoardRequest["intent"][] = [];
    const controller = createBoardController({ workspaceId: "selected", clock: () => now, callBoardRpc: async (input) => {
      calls.push(input.intent);
      return input.intent === "status" ? { kind: "status", workspaceId: "selected", observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: ["absent"] }
        : { kind: "snapshot", snapshot: snapshot({ freshness: "refresh-failed", availability: "unavailable", warnings: ["absent"] }) };
    } });
    await controller.dispatch("snapshot");
    await controller.poll();
    now = 10_000;
    await controller.poll();
    now = 31_000;
    await controller.poll();
    expect(calls).toEqual(["snapshot", "status", "refresh", "status", "status", "refresh"]);
    expect(controller.getState().refreshAnnouncement).toBeNull();
    controller.dispose();
  });
});

describe("snapshot changes", () => {
  const at = (tasks: PathTask[], overrides: Partial<BoardPath> = {}) => snapshot({ flavor: "gsd-path", path: path(tasks, overrides) });

  it("names changed and added tasks, a new phase, new review cycles, new questions and a new log entry", () => {
    const before = at([task("T001", "pending")]);
    const after = at([task("T001", "in-progress"), task("T002", "pending")], {
      state: { ...path([]).state, phase: "ship", lastEvent: { date: "2026-10-10", phase: "ship", text: "final gate passed", shortened: false } },
      reviews: { ...path([]).reviews, current: { ...path([]).reviews.current, waves: [{ wave: 1, cycle: 1, lens: null, verdict: "blocked", depth: "full", tasksReviewed: 2, tasks: [], superseded: false, panel: null }] } },
      questions: { availability: "available", limited: false, pending: [], counts: { answers: 2, pending: 2, closed: 0 } },
    });
    expect(snapshotChanges(before, after, 5)).toEqual({ at: 5, tasks: ["T001", "T002"], summary: ["phase ship", "T001 in progress", "T002 added", "wave 1 review cycle 1 blocked", "2 new questions", "new log entry"] });
  });

  it("names nothing for the first read, another workspace, or the same evidence", () => {
    const files = at([task("T001", "done")]);
    expect(snapshotChanges(null, files, 1)).toBeNull();
    expect(snapshotChanges(files, { ...files, workspaceId: "other" }, 1)).toBeNull();
    expect(snapshotChanges(files, { ...files, revision: 9 }, 1)).toBeNull();
    expect(snapshotChanges(snapshot(), files, 1)).toBeNull();
  });
});
