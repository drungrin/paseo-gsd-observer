import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
import { createBoardController } from "../../index.client";
import type { BoardResponse, BoardSnapshot } from "../../shared/board-rpc";

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
});
