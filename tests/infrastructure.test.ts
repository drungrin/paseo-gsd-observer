import { access } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { evidenceCases, fixtureFiles, fixtureFingerprint } from "./fixtures/gsd-fixtures";
import { FakeHost } from "./helpers/fake-host";
import { FakeWatcher } from "./helpers/fake-watcher";
import { FixtureWorkspace } from "./helpers/fixture-workspace";

describe("Wave 0 infrastructure", () => {
  it("materializes declarative fixtures only in an isolated temporary workspace and cleans it", async () => {
    const workspace = await FixtureWorkspace.create(fixtureFiles);
    const expected = `${workspace.root}/.planning/ROADMAP.md`;
    await access(expected);
    expect(fixtureFingerprint()).toContain(".planning/ROADMAP.md");
    expect(evidenceCases).toHaveLength(6);
    await workspace.cleanup();
    await expect(access(expected)).rejects.toBeDefined();
  });

  it("uses parsed RPC contracts and only resolves registered workspace identities", async () => {
    const host = new FakeHost();
    host.registerWorkspace("selected", "/fixture/selected");
    const contract = defineRpc({ name: "board.snapshot", input: z.object({ workspaceId: z.string().min(1) }), output: z.object({ id: z.string() }) });
    host.handle(contract, (input) => ({ id: host.resolveWorkspace((input as { workspaceId: string }).workspaceId) }));
    await expect(host.invoke(contract, { workspaceId: "selected" }, "selected")).resolves.toEqual({ id: "/fixture/selected" });
    await expect(host.invoke(contract, { workspaceId: "missing" }, "selected")).rejects.toThrow("unknown workspace");
    await expect(host.invoke(contract, { workspaceId: "" }, "selected")).rejects.toBeDefined();
  });

  it("tracks watcher listeners, errors, and deterministic close", async () => {
    vi.useFakeTimers();
    const watcher = new FakeWatcher();
    const changed = vi.fn();
    const failed = vi.fn();
    watcher.on("change", changed).on("error", failed);
    watcher.emitChange(".planning/ROADMAP.md");
    watcher.emitError(new Error("fixture watcher error"));
    expect(changed).toHaveBeenCalledWith(".planning/ROADMAP.md");
    expect(failed).toHaveBeenCalledOnce();
    expect(watcher.listenerCount("change")).toBe(1);
    await watcher.close();
    expect(watcher.closed).toBe(true);
    expect(watcher.listenerCount("change")).toBe(0);
    vi.useRealTimers();
  });
});
